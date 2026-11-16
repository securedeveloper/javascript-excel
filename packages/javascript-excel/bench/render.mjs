// Benchmarks for javascript-excel/render (docs/api.md §5.7.5), the metrics
// react-xlsx-viewer's design names: what the render model costs on top of
// the read workbook, and how long the per-window work takes.
//
//   npm run build && node --expose-gc bench/render.mjs [--sizes 100000,1000000] [--json out.json]
//
// Per size (10 columns, numbers with 8 shared cell styles, written then read
// with dates: 'serial', as a viewer reads):
//   create      createRenderSheet: time, and memory retained by the handle (JS heap + ArrayBuffers, after GC)
//   window      renderCell over a 50 x 20 window, cold (first draw) and warm (cached)
//   scroll      200 consecutive windows, 10 rows apart (a scripted scroll), per window
//   edge        Ctrl+Down from the top of a full column (the longest scan)
//   copy        rangeAsTsv + rangeAsHtml over 10,000 cells
import { writeFileSync } from "node:fs";
import os from "node:os";
import { toUint8Array } from "../dist/index.js";
import { read } from "../dist/read.js";
import { createRenderSheet, edge, rangeAsHtml, rangeAsTsv, renderCell } from "../dist/render.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const sizes = opt("--sizes", "100000,1000000").split(",").map(Number);
if (typeof globalThis.gc !== "function") throw new Error("run with node --expose-gc");
const heap = () => {
  globalThis.gc();
  globalThis.gc();
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers; // the offset tables are Float64Arrays, outside the JS heap
};
const ms = (t0) => Math.round((performance.now() - t0) * 100) / 100;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const STYLES = Array.from({ length: 8 }, (_, i) => ({
  font: { bold: i % 2 === 0, color: { theme: 4 + (i % 6) } },
  fill: i % 3 === 0 ? "FFF2CC" : undefined,
  border: i % 4 === 0 ? { bottom: { style: "thin" } } : undefined,
  numFmt: i % 2 ? "#,##0.00" : "0",
}));

const results = [];
for (const cells of sizes) {
  const rowsN = Math.ceil(cells / 10);
  const rows = Array.from({ length: rowsN }, (_, r) => Array.from({ length: 10 }, (_, c) => ({ value: r * 10 + c + 0.5, style: STYLES[(r + c) % 8] })));
  const { workbook } = await read(await toUint8Array({ sheets: [{ name: "S", rows, merges: ["A1:B2"], view: { freeze: { rows: 1 } } }] }), { dates: "serial" });

  const before = heap();
  const t0 = performance.now();
  let s = createRenderSheet(workbook, 0);
  const createMs = ms(t0);
  const createMB = Math.round(((heap() - before) / 2 ** 20) * 100) / 100;

  const drawWindow = (top) => {
    for (let r = top; r < top + 50; r++) for (let c = 0; c < 20; c++) renderCell(s, r, c);
  };
  s = createRenderSheet(workbook, 0);
  let t = performance.now();
  drawWindow(1000);
  const coldMs = ms(t);
  t = performance.now();
  drawWindow(1000);
  const warmMs = ms(t);

  s = createRenderSheet(workbook, 0);
  const per = [];
  for (let i = 0; i < 200; i++) {
    t = performance.now();
    drawWindow(i * 10);
    per.push(performance.now() - t);
  }
  const scrollP50 = Math.round(median(per) * 100) / 100;
  const scrollMax = Math.round(Math.max(...per) * 100) / 100;

  t = performance.now();
  const end = edge(s, { row: 0, col: 0 }, "down");
  const edgeMs = ms(t);
  if (end.row !== rowsN - 1) throw new Error(`edge went to row ${end.row}, expected ${rowsN - 1}`);

  const range = { start: { row: 0, col: 0 }, end: { row: 999, col: 9 } };
  t = performance.now();
  const tsv = rangeAsTsv(s, range);
  const html = rangeAsHtml(s, range);
  const copyMs = ms(t);
  if (!tsv || !html) throw new Error("empty copy");

  const r = { cells, rows: rowsN, createMs, createMB, coldMs, warmMs, scrollP50, scrollMax, edgeMs, copyMs };
  results.push(r);
  console.error(JSON.stringify(r));
}

const env = { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model ?? "unknown", runner: process.env.RUNNER_NAME ? `GitHub Actions ${process.env.ImageOS ?? ""}`.trim() : "local" };
const table = [
  `Node ${env.node}, ${env.platform}, ${env.cpu}, ${env.runner}.`,
  "",
  "| cells | create (ms) | create memory (MB) | window cold (ms) | window warm (ms) | scroll window p50 / max (ms) | Ctrl+Down full column (ms) | copy 10k cells (ms) |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...results.map((r) => `| ${r.cells.toLocaleString("en-US")} | ${r.createMs} | ${r.createMB} | ${r.coldMs} | ${r.warmMs} | ${r.scrollP50} / ${r.scrollMax} | ${r.edgeMs} | ${r.copyMs} |`),
].join("\n");
console.log(table);
const json = opt("--json", undefined);
if (json) writeFileSync(json, JSON.stringify({ env, results }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Render model\n\n${table}\n`, { flag: "a" });
