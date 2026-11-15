// Consumer TypeScript matrix.
//
// Packs the package, installs the tarball into a throwaway consumer, and
// type-checks the consumer fixture (see consumer.mjs) with several TypeScript
// versions under node16, nodenext and bundler module resolution. With
// `skipLibCheck` off (the default), each compiler also checks the published
// .d.ts files themselves.
//
//   node scripts/consumer-ts.mjs 5.0 5.4 7.0     check these versions, fail on any error
//   node scripts/consumer-ts.mjs --probe 4.7 4.9  report a pass/fail table, never fail
//
// Versions are npm ranges for the `typescript` package, so `5.0` means the
// latest 5.0.x. With no versions, the supported matrix below is used.
// Run `npm run build` first.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TS_MODES, packAndInstall, run, runTsc, step, tscBin, writeTypeFixture } from "./consumer.mjs";

// Supported consumer TypeScript versions: every minor from the floor up. The
// first entry is the documented floor (README: "types tested with TypeScript
// 5.0–7"); keep the two in sync. 5.0 is the first release with
// `moduleResolution: bundler` (4.7 added node16/nodenext).
const SUPPORTED = ["5.0", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "6.0", "7.0"];

const args = process.argv.slice(2);
const probe = args.includes("--probe");
const versions = args.filter((a) => a !== "--probe");
const matrix = versions.length ? versions : SUPPORTED;

const work = mkdtempSync(join(tmpdir(), "jse-consumer-ts-"));
try {
  step("npm pack + install tarball into a fresh consumer");
  const { packed, app } = packAndInstall(work);
  writeTypeFixture(app);
  console.log(`installed ${packed.filename}`);

  const results = [];
  for (const range of matrix) {
    step(`TypeScript ${range}`);
    // Each compiler gets its own folder, so versions never share node_modules
    // with each other or with the consumer.
    const tsDir = join(work, "ts", range.replace(/[^\w.-]/g, "_"));
    mkdirSync(tsDir, { recursive: true });
    writeFileSync(join(tsDir, "package.json"), JSON.stringify({ name: "ts", private: true }));
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", `typescript@${range}`], tsDir);
    const { tsc, version } = tscBin(join(tsDir, "node_modules", "typescript", "package.json"));
    for (const mode of TS_MODES) {
      let ok = true;
      let detail = "";
      try {
        runTsc(tsc, app, mode);
      } catch (err) {
        ok = false;
        detail = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim().split("\n")[0] ?? "";
      }
      results.push({ range, version, mode: mode.label, ok, detail });
      console.log(`${ok ? "ok  " : "FAIL"} tsc ${version} ${mode.label}${ok ? "" : `: ${detail}`}`);
    }
  }

  step("summary");
  const modes = TS_MODES.map((m) => m.label);
  const table = [
    `| TypeScript | ${modes.join(" | ")} |`,
    `|---|${modes.map(() => "---").join("|")}|`,
    ...matrix.map((range) => {
      const row = results.filter((r) => r.range === range);
      return `| ${row[0]?.version ?? range} | ${row.map((r) => (r.ok ? "pass" : "fail")).join(" | ")} |`;
    }),
  ].join("\n");
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Consumer TypeScript matrix\n\n${table}\n`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length && !probe) {
    throw new Error(`${failed.length} consumer type check(s) failed`);
  }
  console.log(probe ? "\nprobe finished" : "\nconsumer TypeScript matrix passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
