// Conformance corpus tooling (JSE-9).
//
//   node scripts/conformance.mjs artifact   build conformance-corpus/ (files, CHECKLIST.md,
//                                           manifest.json) and conformance-corpus.zip
//   node scripts/conformance.mjs doc        regenerate ../../docs/conformance.md
//
// The corpus is TypeScript (test/conformance/corpus.ts), so this runs Vitest
// on test/conformance/build.test.ts, which writes the files.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
// Vitest may be hoisted to the workspace root, so resolve its CLI rather than guess the path.
const vitestCli = join(dirname(createRequire(join(pkgDir, "package.json")).resolve("vitest/package.json")), "vitest.mjs");
const vitest = (env) =>
  execFileSync(process.execPath, [vitestCli, "run", "test/conformance/build.test.ts"], {
    cwd: pkgDir,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });

if (mode === "doc") {
  vitest({ JSE_CONFORMANCE_DOC: resolve(pkgDir, "..", "..", "docs", "conformance.md") });
} else if (mode === "artifact") {
  const outDir = join(pkgDir, "conformance-corpus");
  const zip = join(pkgDir, "conformance-corpus.zip");
  rmSync(outDir, { recursive: true, force: true });
  rmSync(zip, { force: true });
  vitest({ JSE_CONFORMANCE_OUT: outDir });
  // -X: no extra file attributes, so the archive does not depend on the machine.
  execFileSync("zip", ["-q", "-r", "-X", zip, "conformance-corpus"], { cwd: pkgDir, stdio: "inherit" });
  if (!existsSync(zip)) throw new Error("zip was not created");
  console.log(`wrote ${outDir} and ${zip}`);
} else {
  console.error("usage: node scripts/conformance.mjs artifact|doc");
  process.exit(2);
}
