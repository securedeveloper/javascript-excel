// Packed-tarball smoke test.
//
// Packs the package exactly as `npm publish` would, installs the tarball into a
// throwaway consumer project, then checks that every subpath in the exports
// map works for ESM `import`, CJS `require`, TypeScript type resolution
// (node16, nodenext and bundler), and that a bundler drops entries the
// consumer does not use.
//
// Run `npm run build` first.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CHECKS as checks,
  MARKERS,
  runtimeCheck,
  SUBPATHS,
  TS_MODES,
  packAndInstall,
  pkg,
  pkgDir,
  run,
  runTsc,
  step,
  tscBin,
  writeTypeFixture,
} from "./consumer.mjs";

const require = createRequire(join(pkgDir, "package.json"));

const work = mkdtempSync(join(tmpdir(), "jse-smoke-"));
try {
  step("npm pack + install tarball into a fresh consumer");
  const { packed, app, installed } = packAndInstall(work);
  const files = packed.files.map((f) => f.path).sort();
  console.log(`${packed.filename}: ${files.length} files`);
  for (const f of files) console.log(`  ${f}`);
  const stray = files.filter((f) => !/^(dist\/|package\.json$|README\.md$|LICENSE$)/.test(f));
  if (stray.length) throw new Error(`unexpected files in tarball: ${stray.join(", ")}`);

  const deps = Object.keys(installed.dependencies ?? {});
  if (deps.length) throw new Error(`expected zero runtime dependencies, found ${deps.join(", ")}`);
  if (installed.sideEffects !== false) throw new Error(`expected "sideEffects": false`);
  console.log("ok zero runtime dependencies, sideEffects: false");

  step("ESM import of every subpath");
  writeFileSync(
    join(app, "esm.mjs"),
    checks
      .map(
        ({ spec, name, value }, i) =>
          `import * as m${i} from ${JSON.stringify(spec)};\n` +
          `if (!(${runtimeCheck(`m${i}.${name}`, value)})) throw new Error(${JSON.stringify(`${spec} ${name}`)});\n` +
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
          `if (!(${runtimeCheck(`require(${JSON.stringify(spec)}).${name}`, value)})) throw new Error(${JSON.stringify(`${spec} ${name}`)});\n` +
          `console.log("ok require", ${JSON.stringify(spec)});`,
      )
      .join("\n"),
  );
  process.stdout.write(run(process.execPath, ["cjs.cjs"], app));

  step("TypeScript resolves types (node16, nodenext, bundler) with the workspace compiler");
  writeTypeFixture(app);
  const { tsc, version } = tscBin(require.resolve("typescript/package.json"));
  console.log(`using tsc ${version}`);
  for (const mode of TS_MODES) {
    runTsc(tsc, app, mode);
    console.log(`ok tsc ${mode.label}`);
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
    if (code.includes(MARKERS[sub])) {
      throw new Error(`bundle still contains ${sub} although it is unused`);
    }
  }
  console.log(`ok bundle keeps VERSION and drops ${SUBPATHS.length - 1} unused entries`);

  step("worker: a client-only bundle ships no engine; a real thread round-trips");
  writeFileSync(join(app, "client.js"), `import { createWorkerClient } from "javascript-excel/worker";\nconsole.log(createWorkerClient);\n`);
  const clientBuild = await vite.build({
    root: app,
    configFile: false,
    logLevel: "silent",
    build: { write: false, minify: false, lib: { entry: join(app, "client.js"), formats: ["es"], fileName: "client" } },
  });
  const clientCode = [clientBuild].flat().flatMap((r) => r.output).filter((o) => o.type === "chunk").map((o) => o.code).join("\n");
  for (const [what, marker] of [["reader", MARKERS["./read"]], ["CSV", MARKERS["./csv"]], ["writer", "is not a sheet index"]]) {
    if (clientCode.includes(marker)) throw new Error(`a createWorkerClient-only bundle contains the ${what}`);
  }
  console.log(`ok createWorkerClient-only bundle: ${(clientCode.length / 1024).toFixed(1)} KiB, no writer, reader or CSV code`);
  writeFileSync(
    join(app, "excel.worker.mjs"),
    `import { parentPort } from "node:worker_threads";\nimport { exposeWorker } from "javascript-excel/worker";\nexposeWorker({ postMessage: (m, t) => parentPort.postMessage(m, t), addEventListener: (type, l) => parentPort.on(type, (data) => l({ data })) });\n`,
  );
  writeFileSync(
    join(app, "main.mjs"),
    [
      `import { Worker } from "node:worker_threads";`,
      `import { createWorkerClient } from "javascript-excel/worker";`,
      `const t = new Worker(new URL("./excel.worker.mjs", import.meta.url));`,
      `const client = createWorkerClient({ postMessage: (m, tr) => t.postMessage(m, tr), addEventListener: (type, l) => t.on(type, (d) => l(type === "message" ? { data: d } : d)), terminate: () => t.terminate() });`,
      `const bytes = await client.write({ sheets: [{ name: "S", rows: [["a", 1], [true, new Date(0)]] }] });`,
      `const { workbook } = await client.read(bytes);`,
      `if (workbook.sheets[0].rows[0][0].value !== "a" || workbook.sheets[0].rows[0][1].value !== 1) throw new Error("worker round trip failed");`,
      `console.log("ok worker thread round trip:", bytes.length, "bytes");`,
      `client.terminate();`,
    ].join("\n"),
  );
  process.stdout.write(run(process.execPath, ["main.mjs"], app));

  console.log("\nsmoke test passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
