// Main-thread cost of sending a workbook to the worker: structured clone (default)
// vs `compact: true` (JSE-15). Runs a real worker thread (node:worker_threads).
//
//   npm run build && node bench/worker.mjs [--cells 600000] [--json out.json]
//
// "send" is the time client.write() blocks the calling thread before it returns
// its promise (encoding + postMessage, where structured clone happens);
// "total" is until the bytes are back.
import { writeFileSync } from "node:fs";
import os from "node:os";
import { Worker } from "node:worker_threads";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const CELLS = Number(opt("--cells", "600000"));
const dist = new URL("../dist/", import.meta.url);
const { createWorkerClient } = await import(new URL("worker.js", dist));

const workerFile = new URL("./worker-thread.mjs", import.meta.url);
const t = new Worker(workerFile, { workerData: { dist: new URL("worker.js", dist).href } });
const client = createWorkerClient({
  postMessage: (m, tr) => t.postMessage(m, tr),
  addEventListener: (type, l) => t.on(type, (d) => l(type === "message" ? { data: d } : d)),
  terminate: () => t.terminate(),
});

const COLORS = ["FF0000", "00AA00", "0000FF", "333333"];
const shapes = {
  numbers: (k) => k * 1.5,
  "unique strings": (k) => `value ${k}`,
  "styled (shared objects)": (() => {
    const s = COLORS.map((color) => ({ font: { bold: true, color } }));
    return (k) => ({ value: k, style: s[k % 4] });
  })(),
  "styled (new object per cell)": (k) => ({ value: k, style: { font: { bold: k % 2 === 0, color: COLORS[k % 4] } } }),
  mixed: (k) => (k % 3 === 0 ? k : k % 3 === 1 ? `row ${k}` : { value: k % 2 === 0, style: { font: { bold: true } } }),
};

const results = [];
for (const [shape, gen] of Object.entries(shapes)) {
  const rows = Array.from({ length: CELLS / 10 }, (_, r) => Array.from({ length: 10 }, (_, c) => gen(r * 10 + c)));
  const wb = { properties: { created: new Date(0), modified: new Date(0) }, sheets: [{ name: "S", rows }] };
  for (const compact of [false, true, false, true]) {
    global.gc?.();
    const t0 = performance.now();
    const p = client.write(wb, { compact });
    const send = performance.now() - t0;
    const bytes = await p;
    const total = performance.now() - t0;
    results.push({ shape, compact, send: Math.round(send), total: Math.round(total), bytes: bytes.length });
  }
}
await client.terminate();
// Keep the better of the two runs of each pair (the first warms up the worker).
const best = new Map();
for (const r of results) {
  const k = `${r.shape}|${r.compact}`;
  if (!best.has(k) || best.get(k).send > r.send) best.set(k, r);
}
const rowsOut = [...new Set(results.map((r) => r.shape))].map((shape) => {
  const a = best.get(`${shape}|false`);
  const b = best.get(`${shape}|true`);
  if (a.bytes !== b.bytes) throw new Error(`${shape}: compact and clone produced different files`);
  return { shape, cloneSend: a.send, compactSend: b.send, cloneTotal: a.total, compactTotal: b.total };
});
const env = `Node ${process.version}, ${os.platform()} ${os.arch()}, ${os.cpus()[0]?.model} (${os.cpus().length} cores)`;
const table = [
  `${env}, ${CELLS.toLocaleString("en-US")} cells, real worker thread.`,
  "",
  "| sheet | send, clone | send, compact | total, clone | total, compact |",
  "|---|---:|---:|---:|---:|",
  ...rowsOut.map((r) => `| ${r.shape} | ${r.cloneSend} ms | ${r.compactSend} ms | ${r.cloneTotal} ms | ${r.compactTotal} ms |`),
].join("\n");
console.log(table);
const json = opt("--json");
if (json) writeFileSync(json, JSON.stringify({ env, cells: CELLS, rows: rowsOut }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Worker send cost\n\n${table}\n`, { flag: "a" });
