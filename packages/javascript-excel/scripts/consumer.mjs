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

// What each subpath must export. A string, number or boolean is checked by
// value and by literal type; FUNCTION means "a function", checked with typeof
// and against a function type.
export const FUNCTION = Symbol("function");
const expected = {
  ".": { VERSION: pkg.version },
  "./read": { ENTRY: "javascript-excel/read" },
  "./csv": { CSV_MIME: "text/csv;charset=utf-8", parseCsv: FUNCTION, readCsv: FUNCTION, toCsv: FUNCTION, toCsvBlob: FUNCTION },
  "./dom": { ENTRY: "javascript-excel/dom" },
  "./worker": { ENTRY: "javascript-excel/worker" },
};

// A string only that subpath's code contains, so the tree-shaking check can
// tell whether a bundle kept it.
export const MARKERS = {
  "./read": "javascript-excel/read",
  "./csv": "CSV_STRAY_QUOTE",
  "./dom": "javascript-excel/dom",
  "./worker": "javascript-excel/worker",
};

const missing = SUBPATHS.filter((s) => !(s in expected));
if (missing.length) throw new Error(`no expectation for subpath ${missing.join(", ")}`);

export const CHECKS = SUBPATHS.flatMap((sub) =>
  Object.entries(expected[sub]).map(([name, value]) => ({ spec: specifier(sub), name, value })),
);

/** JS expression that is true when `expr` matches the expectation. */
export const runtimeCheck = (expr, value) =>
  value === FUNCTION ? `typeof ${expr} === "function"` : `${expr} === ${JSON.stringify(value)}`;

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
 * Model types under `exactOptionalPropertyTypes` (runTsc turns it on): every
 * optional model property is declared `prop?: T | undefined`, so a consumer
 * may pass an explicit `undefined`, as conditional object literals do.
 */
const MODEL_FIXTURE = `
import type { Cell, Font, Style, Workbook } from ${JSON.stringify(pkg.name)};
import { toBlob, toUint8Array } from ${JSON.stringify(pkg.name)};
const maybe = (on: boolean): true | undefined => (on ? true : undefined);
const font: Font = { bold: maybe(false), size: undefined, color: undefined, underline: undefined };
const style: Style = { font, fill: undefined, numFmt: undefined, protection: { locked: undefined } };
const cell: Cell = { value: 1, formula: undefined, style, hyperlink: { target: "https://example.com", tooltip: undefined } };
const wb: Workbook = {
  sheets: [{
    name: "S",
    rows: [[cell, undefined, "x"]],
    view: { freeze: { rows: 1, cols: undefined }, zoom: undefined },
    print: { fitTo: { width: 1, height: undefined }, margins: { left: undefined } },
    state: undefined,
  }],
  activeSheet: undefined,
  properties: { title: undefined, custom: undefined },
  calc: { fullCalcOnLoad: undefined },
};
void wb;
// The writer's declarations: BlobOf resolves to the DOM Blob, and a DOM AbortSignal fits AbortSignalLike.
// (No async/await: TS 5.x bundler mode defaults to an ES5 target without the Promise constructor.)
function write(w: Workbook): [Promise<Blob>, Promise<Uint8Array>] {
  return [toBlob(w), toUint8Array(w, { signal: new AbortController().signal, sharedStrings: undefined })];
}
void write;
`;

/**
 * CSV API usage: option and result types resolve, the result is typed, and a
 * Blob-or-structural return type is usable without DOM types.
 */
const CSV_FIXTURE = `
import { parseCsv, readCsv, toCsv, toCsvBlob, type CsvParseResult, type CsvWriteOptions } from ${JSON.stringify(`${pkg.name}/csv`)};
const parsed: CsvParseResult = parseCsv("a,b\\r\\n1,2\\r\\n", { delimiter: "auto", inferTypes: true, mode: undefined });
const first: string | number | boolean | Date | object | undefined = parsed.rows[0]?.[0];
const opts: CsvWriteOptions = { delimiter: ";", bom: undefined, escapeFormulas: true, dates: (d: Date) => d.toISOString() };
const text: string = toCsv([["x", 1, true, null, undefined, { value: 2, formula: "A1*2" }]], opts);
const size: number = toCsvBlob([["x"]]).size;
const later: Promise<CsvParseResult> = readCsv(text, { encoding: "utf-8", signal: undefined });
void first; void size; void later;
`;

/**
 * The TypeScript consumer fixture. Each export is assigned to its literal
 * type, so a missing declaration (`any`, TS7016 under --strict) or a wrong
 * type fails the check. The same source is written as .mts (node16/nodenext
 * ESM), .cts (node16/nodenext CJS) and .ts (bundler).
 */
export function writeTypeFixture(app) {
  const typed =
    CHECKS.map(
      ({ spec, name, value }, i) =>
        `import { ${name} as v${i} } from ${JSON.stringify(spec)};\n` +
        `const t${i}: ${value === FUNCTION ? "(...args: never[]) => unknown" : JSON.stringify(value)} = v${i};\nvoid t${i};`,
    ).join("\n") +
    "\n" +
    MODEL_FIXTURE +
    CSV_FIXTURE;
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
  return run(process.execPath, [tsc, "--strict", "--exactOptionalPropertyTypes", "--noEmit", "--pretty", "false", ...mode.args], app);
}
