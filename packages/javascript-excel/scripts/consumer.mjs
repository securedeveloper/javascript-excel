// Shared helpers for the packed-tarball checks (smoke-pack.mjs and
// consumer-ts.mjs): pack the package, install the tarball into a throwaway
// consumer, and write the TypeScript consumer fixture.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

export const SUBPATHS = Object.keys(pkg.exports).filter((k) => k !== "./package.json");
const specifier = (sub) => (sub === "." ? pkg.name : `${pkg.name}/${sub.slice(2)}`);

// What each subpath must export, by value and by literal type.
const expected = {
  ".": { VERSION: pkg.version },
  "./read": { ENTRY: "javascript-excel/read" },
  "./csv": { ENTRY: "javascript-excel/csv" },
  "./dom": { ENTRY: "javascript-excel/dom" },
  "./worker": { ENTRY: "javascript-excel/worker" },
};
const missing = SUBPATHS.filter((s) => !(s in expected));
if (missing.length) throw new Error(`no expectation for subpath ${missing.join(", ")}`);

export const CHECKS = SUBPATHS.flatMap((sub) =>
  Object.entries(expected[sub]).map(([name, value]) => ({ spec: specifier(sub), name, value })),
);

export const run = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    throw err;
  }
};
export const step = (msg) => console.log(`\n== ${msg}`);

/** `npm pack` the package into `work` and install the tarball into `work/consumer`. */
export function packAndInstall(work) {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], pkgDir))[0];
  const tarball = join(work, packed.filename);
  const app = join(work, "consumer");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball], app);
  const installed = JSON.parse(
    readFileSync(join(app, "node_modules", pkg.name, "package.json"), "utf8"),
  );
  return { packed, app, installed };
}

/**
 * The TypeScript consumer fixture. Each export is assigned to its literal
 * type, so a missing declaration (`any`, TS7016 under --strict) or a wrong
 * type fails the check. The same source is written as .mts (node16/nodenext
 * ESM), .cts (node16/nodenext CJS) and .ts (bundler).
 */
export function writeTypeFixture(app) {
  const typed = CHECKS.map(
    ({ spec, name, value }, i) =>
      `import { ${name} as v${i} } from ${JSON.stringify(spec)};\n` +
      `const t${i}: ${JSON.stringify(value)} = v${i};\nvoid t${i};`,
  ).join("\n");
  writeFileSync(join(app, "esm.mts"), typed);
  writeFileSync(join(app, "cjs.cts"), typed);
  writeFileSync(join(app, "bundler.ts"), typed);
}

/** Module resolution modes a consumer must be able to use (see docs/api.md). */
export const TS_MODES = [
  { label: "node16", args: ["--module", "node16", "--moduleResolution", "node16", "esm.mts", "cjs.cts"] },
  { label: "nodenext", args: ["--module", "nodenext", "--moduleResolution", "nodenext", "esm.mts", "cjs.cts"] },
  { label: "bundler", args: ["--module", "esnext", "--moduleResolution", "bundler", "bundler.ts"] },
];

/** Path to the `tsc` binary of the TypeScript package installed at `tsDir`. */
export function tscBin(tsPkgJsonPath) {
  // TypeScript 7 no longer exports `bin/tsc` through its exports map, so use
  // the package's own `bin` field.
  const tsPkg = JSON.parse(readFileSync(tsPkgJsonPath, "utf8"));
  return { tsc: join(dirname(tsPkgJsonPath), tsPkg.bin.tsc), version: tsPkg.version };
}

/** Type-check the fixture in `app` with `tsc` under one resolution mode. */
export function runTsc(tsc, app, mode) {
  return run(process.execPath, [tsc, "--strict", "--noEmit", "--pretty", "false", ...mode.args], app);
}
