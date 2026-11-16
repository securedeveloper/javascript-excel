// Benchmarks for the xlsx writer and reader (and CSV) at 10k / 100k / 1M cells.
//
//   npm run build && node --expose-gc bench/run.mjs [--sizes 10000,100000,1000000] [--json out.json]
//
// Each case runs in a fresh child process, so heap peaks don't leak between
// cases. Reported per case: wall time (median of the runs), peak RSS and peak
// heap during the operation (sampled every 5 ms), output or input size, and
// the longest stretch the event loop was blocked (from a 1 ms timer probe).
// Shapes:
//   plain   numbers only (10 columns)
//   strings repeated text: 100 distinct strings, so the shared strings table stays small
//   unique  unique text in every cell (shared strings table as large as the sheet)
//   styled  numbers with 8 rotating cell styles (font, fill, border, number format)
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};

if (args[0] === "--case") {
  await runCase(JSON.parse(args[1]));
} else {
  const sizes = opt("--sizes", "10000,100000,1000000").split(",").map(Number);
  const shapes = opt("--shapes", "plain,strings,unique,styled").split(",");
  const ops = opt("--ops", "write,read,csv-write,csv-read").split(",");
  const results = [];
  for (const cells of sizes) {
    for (const shape of shapes) {
      for (const op of ops) {
        if (op.startsWith("csv") && shape === "styled") continue;
        const runs = cells >= 1_000_000 ? 3 : 5;
        const out = execFileSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), "--case", JSON.stringify({ cells, shape, op, runs })], {
          encoding: "utf8",
          maxBuffer: 1 << 26,
        });
        const r = JSON.parse(out.trim().split("\n").at(-1));
        results.push(r);
        console.error(`${op.padEnd(9)} ${shape.padEnd(7)} ${String(cells).padStart(8)} cells  ${String(r.ms).padStart(6)} ms  heap ${r.heapMB} MB  rss ${r.rssMB} MB  block ${r.blockMs} ms  ${r.bytesMB} MB`);
      }
    }
  }
  const env = { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model ?? "unknown", cpus: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), runner: process.env.RUNNER_NAME ? `GitHub Actions ${process.env.ImageOS ?? ""} ${process.env.RUNNER_ARCH ?? ""}`.trim() : "local" };
  const table = [
    `Node ${env.node}, ${env.platform}, ${env.cpu} (${env.cpus} cores, ${env.memGB} GB), ${env.runner}.`,
    "",
    "| operation | shape | cells | time (ms) | peak heap (MB) | peak RSS (MB) | longest block (ms) | file (MB) |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    ...results.map((r) => `| ${r.op} | ${r.shape} | ${r.cells.toLocaleString("en-US")} | ${r.ms} | ${r.heapMB} | ${r.rssMB} | ${r.blockMs} | ${r.bytesMB} |`),
  ].join("\n");
  console.log(table);
  const json = opt("--json", undefined);
  if (json) writeFileSync(json, JSON.stringify({ env, results }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Benchmarks\n\n${table}\n`, { flag: "a" });
}

function rows(cells, shape) {
  const cols = 10;
  const n = Math.ceil(cells / cols);
  const styles = Array.from({ length: 8 }, (_, i) => ({
    font: { bold: i % 2 === 0, color: ["FF0000", "00AA00", "0000FF", "333333"][i % 4] },
    fill: i % 3 === 0 ? "FFF2CC" : undefined,
    border: i % 4 === 0 ? { bottom: { style: "thin" } } : undefined,
    numFmt: ["0.00", "#,##0", "0%", "yyyy-mm-dd"][i % 4],
  }));
  const out = new Array(n);
  for (let r = 0; r < n; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (shape === "plain") row[c] = k * 1.5;
      else if (shape === "strings") row[c] = `label ${k % 100}`;
      else if (shape === "unique") row[c] = `value ${k}`;
      else row[c] = { value: k, style: styles[k % 8] };
    }
    out[r] = row;
  }
  return out;
}

async function runCase({ cells, shape, op, runs }) {
  const dist = new URL("../dist/", import.meta.url);
  const core = await import(new URL("index.js", dist));
  const { read } = await import(new URL("read.js", dist));
  const csv = await import(new URL("csv.js", dist));
  const data = rows(cells, shape);
  const wb = { properties: { created: new Date(0), modified: new Date(0) }, sheets: [{ name: "Bench", rows: data }] };
  let input;
  if (op === "read") input = await core.toUint8Array(wb);
  else if (op === "csv-read") input = csv.toCsv(data);
  const once = async () => {
    if (op === "write") return (await core.toUint8Array(wb)).length;
    if (op === "read") return (await read(input)).workbook.sheets.length && input.length;
    if (op === "csv-write") return csv.toCsv(data).length;
    return (await csv.readCsv(input)).rows.length && input.length;
  };
  const times = [];
  let peakHeap = 0;
  let peakRss = 0;
  let block = 0;
  let size = 0;
  for (let i = 0; i < runs; i++) {
    global.gc?.();
    const baseHeap = process.memoryUsage().heapUsed;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    let last = performance.now();
    const probe = setInterval(() => {
      const now = performance.now();
      if (now - last > block) block = now - last;
      last = now;
      const m = process.memoryUsage();
      if (m.heapUsed - baseHeap > peakHeap) peakHeap = m.heapUsed - baseHeap;
      if (m.rss > peakRss) peakRss = m.rss;
    }, 1);
    const t0 = performance.now();
    size = await once();
    times.push(performance.now() - t0);
    const end = performance.now();
    if (end - last > block) block = end - last;
    clearInterval(probe);
    const m = process.memoryUsage();
    if (m.heapUsed - baseHeap > peakHeap) peakHeap = m.heapUsed - baseHeap;
    if (m.rss > peakRss) peakRss = m.rss;
  }
  times.sort((a, b) => a - b);
  const mb = (b) => Math.round((b / 2 ** 20) * 10) / 10;
  console.log(JSON.stringify({ op, shape, cells, runs, ms: Math.round(times[Math.floor(times.length / 2)]), heapMB: mb(peakHeap), rssMB: mb(peakRss), blockMs: Math.round(block), bytesMB: mb(size) }));
}
