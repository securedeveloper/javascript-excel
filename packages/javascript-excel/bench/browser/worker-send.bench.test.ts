// Chromium: main-thread cost of sending a workbook to a real Web Worker (JSE-15). Run:
//   npx vitest run --config bench/browser/vitest.config.ts
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
  const lines: string[] = [`${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]}, ${cells} cells, real Web Worker`, "| sheet | send (main thread) | total |", "|---|---:|---:|"];
  for (const [shape, gen] of Object.entries(shapes)) {
    const rows = Array.from({ length: cells / 10 }, (_, r) => Array.from({ length: 10 }, (_, c) => gen(r * 10 + c)));
    const wb = { properties: { created: new Date(0), modified: new Date(0) }, sheets: [{ name: "S", rows }] } as never;
    let best = { send: Infinity, total: Infinity };
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      const p = client.write(wb);
      const send = performance.now() - t0;
      const bytes = await p;
      expect(bytes.length).toBeGreaterThan(0);
      const total = performance.now() - t0;
      if (send < best.send) best = { send, total };
    }
    lines.push(`| ${shape} | ${best.send.toFixed(0)} ms | ${best.total.toFixed(0)} ms |`);
  }
  client.terminate();
  console.log(lines.join("\n"));
});
