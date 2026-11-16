// Chromium: main-thread cost of sending a workbook to a real Web Worker,
// structured clone vs compact: true (JSE-15). Run:
//   npx vitest run --config vitest.browser.config.ts --dir bench/browser
import { expect, it } from "vitest";
import { createWorkerClient } from "../../src/worker";

const COLORS = ["FF0000", "00AA00", "0000FF", "333333"];
const shapes: Record<string, (k: number) => unknown> = {
  numbers: (k) => k * 1.5,
  "unique strings": (k) => `value ${k}`,
  "styled (shared objects)": (() => {
    const s = COLORS.map((color) => ({ font: { bold: true, color } }));
    return (k: number) => ({ value: k, style: s[k % 4] });
  })(),
  "styled (new object per cell)": (k) => ({ value: k, style: { font: { bold: k % 2 === 0, color: COLORS[k % 4] } } }),
  mixed: (k) => (k % 3 === 0 ? k : k % 3 === 1 ? `row ${k}` : { value: k % 2 === 0, style: { font: { bold: true } } }),
};

it("worker send cost in Chromium", { timeout: 600_000 }, async () => {
  const cells = 600_000;
  const client = createWorkerClient(new Worker(new URL("./excel.worker.ts", import.meta.url), { type: "module" }));
  const lines: string[] = [`${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]}, ${cells} cells, real Web Worker`, "| sheet | send, clone | send, compact | total, clone | total, compact |", "|---|---:|---:|---:|---:|"];
  for (const [shape, gen] of Object.entries(shapes)) {
    const rows = Array.from({ length: cells / 10 }, (_, r) => Array.from({ length: 10 }, (_, c) => gen(r * 10 + c)));
    const wb = { properties: { created: new Date(0), modified: new Date(0) }, sheets: [{ name: "S", rows }] } as never;
    const best = { false: { send: Infinity, total: Infinity, n: 0 }, true: { send: Infinity, total: Infinity, n: 0 } };
    for (const compact of [false, true, false, true]) {
      const t0 = performance.now();
      const p = client.write(wb, { compact });
      const send = performance.now() - t0;
      const bytes = await p;
      const total = performance.now() - t0;
      const b = best[String(compact) as "false" | "true"];
      if (send < b.send) Object.assign(b, { send, total, n: bytes.length });
    }
    expect(best.true.n).toBe(best.false.n);
    lines.push(`| ${shape} | ${best.false.send.toFixed(0)} ms | ${best.true.send.toFixed(0)} ms | ${best.false.total.toFixed(0)} ms | ${best.true.total.toFixed(0)} ms |`);
  }
  client.terminate();
  console.log(lines.join("\n"));
});
