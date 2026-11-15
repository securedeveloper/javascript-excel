// Packed-tarball smoke test.
//
// Packs the package exactly as `npm publish` would, installs the tarball into a
// throwaway consumer project, then checks that every subpath in the exports
// map works for ESM `import`, CJS `require`, TypeScript type resolution
// (node16 ESM, node16 CJS and bundler), and that a bundler drops entries the
// consumer does not use.
//
// Run `npm run build` first.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const require = createRequire(join(pkgDir, "package.json"));

const SUBPATHS = Object.keys(pkg.exports).filter((k) => k !== "./package.json");
const specifier = (sub) => (sub === "." ? pkg.name : `${pkg.name}/${sub.slice(2)}`);
const expected = {
  ".": { VERSION: pkg.version },
  "./read": { ENTRY: "javascript-excel/read" },
  "./csv": { ENTRY: "javascript-excel/csv" },
  "./dom": { ENTRY: "javascript-excel/dom" },
  "./worker": { ENTRY: "javascript-excel/worker" },
};

const missing = SUBPATHS.filter((s) => !(s in expected));
if (missing.length) throw new Error(`smoke test has no expectation for ${missing.join(", ")}`);

const run = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    throw err;
  }
};
const step = (msg) => console.log(`\n== ${msg}`);

const work = mkdtempSync(join(tmpdir(), "jse-smoke-"));
try {
  step("npm pack");
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], pkgDir))[0];
  const tarball = join(work, packed.filename);
  const files = packed.files.map((f) => f.path).sort();
  console.log(`${packed.filename}: ${files.length} files`);
  for (const f of files) console.log(`  ${f}`);
  const stray = files.filter((f) => !/^(dist\/|package\.json$|README\.md$|LICENSE$)/.test(f));
  if (stray.length) throw new Error(`unexpected files in tarball: ${stray.join(", ")}`);

  step("install tarball into a fresh consumer");
  const app = join(work, "consumer");
  run("mkdir", ["-p", app], work);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball], app);
  const installed = JSON.parse(
    readFileSync(join(app, "node_modules", pkg.name, "package.json"), "utf8"),
  );
  const deps = Object.keys(installed.dependencies ?? {});
  if (deps.length) throw new Error(`expected zero runtime dependencies, found ${deps.join(", ")}`);
  if (installed.sideEffects !== false) throw new Error(`expected "sideEffects": false`);
  console.log("ok zero runtime dependencies, sideEffects: false");

  const checks = SUBPATHS.flatMap((sub) =>
    Object.entries(expected[sub]).map(([name, value]) => ({ spec: specifier(sub), name, value })),
  );

  step("ESM import of every subpath");
  writeFileSync(
    join(app, "esm.mjs"),
    checks
      .map(
        ({ spec, name, value }, i) =>
          `import * as m${i} from ${JSON.stringify(spec)};\n` +
          `if (m${i}.${name} !== ${JSON.stringify(value)}) throw new Error(${JSON.stringify(`${spec} ${name}`)});\n` +
          `console.log("ok import", ${JSON.stringify(spec)});`,
      )
      .join("\n"),
  );
  process.stdout.write(run(process.execPath, ["esm.mjs"], app));

  step("CJS require of every subpath");
  writeFileSync(
    join(app, "cjs.cjs"),
    checks
      .map(
        ({ spec, name, value }) =>
          `if (require(${JSON.stringify(spec)}).${name} !== ${JSON.stringify(value)}) throw new Error(${JSON.stringify(`${spec} ${name}`)});\n` +
          `console.log("ok require", ${JSON.stringify(spec)});`,
      )
      .join("\n"),
  );
  process.stdout.write(run(process.execPath, ["cjs.cjs"], app));

  step("TypeScript resolves types (node16 ESM, node16 CJS, bundler)");
  // Each binding is assigned to its literal type, so an `any` (missing types)
  // or a wrong type fails the check.
  const typed = checks
    .map(
      ({ spec, name, value }, i) =>
        `import { ${name} as v${i} } from ${JSON.stringify(spec)};\n` +
        `const t${i}: ${JSON.stringify(value)} = v${i};\nvoid t${i};`,
    )
    .join("\n");
  writeFileSync(join(app, "esm.mts"), typed);
  writeFileSync(join(app, "cjs.cts"), typed);
  writeFileSync(join(app, "bundler.ts"), typed);
  const tsc = require.resolve("typescript/bin/tsc");
  const strict = ["--strict", "--noEmit"];
  for (const [label, args] of [
    ["node16", ["--module", "node16", "--moduleResolution", "node16", "esm.mts", "cjs.cts"]],
    ["bundler", ["--module", "esnext", "--moduleResolution", "bundler", "bundler.ts"]],
  ]) {
    run(process.execPath, [tsc, ...strict, ...args], app);
    console.log(`ok tsc ${label}`);
  }

  step("tree-shaking: unused entries are dropped");
  writeFileSync(
    join(app, "shake.js"),
    `import { VERSION } from "javascript-excel";\nimport "javascript-excel/read";\nconsole.log(VERSION);\n`,
  );
  const vite = await import(pathToFileURL(require.resolve("vite")).href);
  const result = await vite.build({
    root: app,
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: { entry: join(app, "shake.js"), formats: ["es"], fileName: "shake" },
    },
  });
  const code = [result]
    .flat()
    .flatMap((r) => r.output)
    .filter((o) => o.type === "chunk")
    .map((o) => o.code)
    .join("\n");
  if (!code.includes(pkg.version)) throw new Error("bundle is missing VERSION");
  for (const sub of SUBPATHS.filter((s) => s !== ".")) {
    if (code.includes(`javascript-excel/${sub.slice(2)}`)) {
      throw new Error(`bundle still contains ${sub} although it is unused`);
    }
  }
  console.log(`ok bundle keeps VERSION and drops ${SUBPATHS.length - 1} unused entries`);

  console.log("\nsmoke test passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
