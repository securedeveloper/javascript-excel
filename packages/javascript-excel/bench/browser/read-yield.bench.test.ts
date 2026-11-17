// Chromium: how long read() and readCsv() block the main thread, and how often frames
// render while they run (JSE-24). Run:
//   npx vitest run --config bench/browser/vitest.config.ts read-yield
// Longest task (PerformanceObserver 'longtask'), longest gap between animation frames,
// total time, and a SHA-256 of the result model, for 100k and 300k rows of 7 columns.
import { expect, it } from "vitest";
import { readCsv, toCsv } from "../../src/csv";
import { toUint8Array } from "../../src/index";
import { read } from "../../src/read";

const rowsOf = (n: number): unknown[][] =>
  Array.from({ length: n }, (_, i) => [i, `Name ${i}`, `user${i}@example.com`, i * 1.25, new Date(Date.UTC(2020, 0, 1 + (i % 365))), i % 2 === 0, `Lorem ipsum dolor sit amet ${i % 97}`]);

function watch(): () => { gap: number; longest: number; frames: number } {
  let last = performance.now();
  let gap = 0;
  let frames = 0;
  let run = true;
  const tasks: number[] = [];
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) tasks.push(e.duration); });
  po.observe({ type: "longtask" });
  const tick = (t: number): void => {
    gap = Math.max(gap, t - last);
    last = t;
    frames++;
    if (run) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    run = false;
    for (const e of po.takeRecords()) tasks.push(e.duration);
    po.disconnect();
    return { gap, longest: Math.max(0, ...tasks), frames };
  };
}

const settle = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100)));
const sha = async (v: unknown): Promise<string> => {
  const json = JSON.stringify(v, function (k, x) { const raw = (this as Record<string, unknown>)[k]; return raw instanceof Date ? `D:${raw.getTime()}` : x; });
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
};

it("read and readCsv main-thread blocking in Chromium", { timeout: 900_000 }, async () => {
  const lines = [`${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]}, 7 columns, median of 5`, "| call | rows | total | longest task | longest frame gap | frames | model sha-256 |", "|---|---:|---:|---:|---:|---:|---|"];
  for (const n of [100_000, 300_000]) {
    const sheet = { name: "Data", rows: rowsOf(n) };
    const xlsx = await toUint8Array({ properties: { created: new Date(0), modified: new Date(0) }, sheets: [sheet] } as never);
    const csv = toCsv(sheet as never);
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["read", async () => (await read(xlsx)).workbook],
      ["readCsv", async () => (await readCsv(csv)).rows],
    ];
    for (const [name, run] of cases) {
      const runs: Array<{ total: number; gap: number; longest: number; frames: number; hash: string }> = [];
      for (let i = 0; i < 6; i++) {
        await settle();
        const stop = watch();
        const t0 = performance.now();
        const model = await run();
        const total = performance.now() - t0;
        await settle();
        const w = stop();
        const hash = i === 1 || i === 5 ? await sha(model) : "";
        if (i > 0) runs.push({ total, gap: w.gap, longest: w.longest, frames: w.frames, hash }); // run 0 warms up
      }
      const hashes = runs.map((r) => r.hash).filter(Boolean);
      expect(new Set(hashes).size).toBe(1);
      const med = (f: (r: (typeof runs)[number]) => number): number => runs.map(f).sort((a, b) => a - b)[2]!;
      lines.push(`| ${name} | ${n.toLocaleString("en")} | ${med((r) => r.total).toFixed(0)} ms | ${med((r) => r.longest).toFixed(0)} ms | ${med((r) => r.gap).toFixed(0)} ms | ${med((r) => r.frames)} | ${hashes[0]} |`);
    }
  }
  console.log(lines.join("\n"));
});
