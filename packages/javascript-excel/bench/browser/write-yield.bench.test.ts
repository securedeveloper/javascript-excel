// Chromium: how long toBlob blocks the main thread, and how often frames render while it runs (JSE-23). Run:
//   npx vitest run --config bench/browser/vitest.config.ts write-yield
// Longest task (PerformanceObserver 'longtask'), longest gap between animation frames,
// total time and a SHA-256 of the bytes, for 100k and 300k rows of 7 columns.
import { expect, it } from "vitest";
import { fromDataset, toBlob } from "../../src/index";

const keys = ["id", "name", "email", "amount", "joined", "active", "note"];
const data = (n: number): Array<Record<string, unknown>> =>
  Array.from({ length: n }, (_, i) => ({
    id: i, name: `Name ${i}`, email: `user${i}@example.com`, amount: i * 1.25,
    joined: new Date(Date.UTC(2020, 0, 1 + (i % 365))), active: i % 2 === 0, note: `Lorem ipsum dolor sit amet ${i % 97}`,
  }));

function watch(): () => { gap: number; longest: number; tasks: number; frames: number } {
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
    return { gap, longest: Math.max(0, ...tasks), tasks: tasks.length, frames };
  };
}

const settle = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100)));
const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

it("toBlob main-thread blocking in Chromium", { timeout: 600_000 }, async () => {
  const lines = [`${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]}, 7 columns, toBlob, median of 5`, "| rows | total | longest task | longest frame gap | frames | bytes | sha-256 |", "|---:|---:|---:|---:|---:|---:|---|"];
  for (const n of [100_000, 300_000]) {
    const sheet = fromDataset({ columns: keys.map((k) => ({ title: k, path: k })), data: data(n) } as never, { name: "Data" });
    const wb = { properties: { created: new Date(0), modified: new Date(0) }, sheets: [sheet] } as never;
    const runs: Array<{ total: number; gap: number; longest: number; frames: number; size: number; sha: string }> = [];
    for (let i = 0; i < 6; i++) {
      await settle();
      const stop = watch();
      const t0 = performance.now();
      const blob = await toBlob(wb);
      const total = performance.now() - t0;
      await settle();
      const w = stop();
      const sha = hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
      if (i > 0) runs.push({ total, gap: w.gap, longest: w.longest, frames: w.frames, size: blob.size, sha }); // run 0 warms up
    }
    expect(new Set(runs.map((r) => r.sha)).size).toBe(1);
    const med = (f: (r: (typeof runs)[number]) => number): number => runs.map(f).sort((a, b) => a - b)[2]!;
    lines.push(`| ${n.toLocaleString("en")} | ${med((r) => r.total).toFixed(0)} ms | ${med((r) => r.longest).toFixed(0)} ms | ${med((r) => r.gap).toFixed(0)} ms | ${med((r) => r.frames)} | ${runs[0]!.size} | ${runs[0]!.sha.slice(0, 16)} |`);
  }
  console.log(lines.join("\n"));
});
