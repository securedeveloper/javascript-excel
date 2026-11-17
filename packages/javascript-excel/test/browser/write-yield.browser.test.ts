// Real Chromium: a large write on the main thread returns to the event loop, so the
// page keeps rendering frames and handling events while it runs (JSE-23).
import { describe, expect, it } from "vitest";
import { toBlob, toUint8Array } from "../../src/index";

function bigWorkbook(rows: number): never {
  const data = Array.from({ length: rows }, (_, i) => [i, `Name ${i}`, `user${i}@example.com`, i * 1.25, new Date(Date.UTC(2020, 0, 1 + (i % 365))), i % 2 === 0, `Lorem ipsum ${i % 97}`]);
  return { properties: { created: new Date(0), modified: new Date(0) }, sheets: [{ name: "Data", rows: data }] } as never;
}

describe("writer yields to the browser", () => {
  it("animation frames and timers run while a large toBlob is in flight", { timeout: 60_000 }, async () => {
    const wb = bigWorkbook(60_000);
    let frames = 0;
    let timers = 0;
    let pending = true;
    const tick = (): void => {
      if (!pending) return;
      frames++;
      requestAnimationFrame(tick);
    };
    const timer = (): void => {
      if (!pending) return;
      timers++;
      setTimeout(timer, 0);
    };
    // Wait for a frame first, so the counters only see the write.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    requestAnimationFrame(tick);
    setTimeout(timer, 0);
    const blob = await toBlob(wb);
    pending = false;
    expect(blob.size).toBeGreaterThan(1_000_000);
    // Before JSE-23 the whole write was one task: no frame and no timer ran until it resolved.
    expect(frames).toBeGreaterThanOrEqual(3);
    expect(timers).toBeGreaterThanOrEqual(3);
  });

  it("an abort from a timer stops a write in flight", { timeout: 60_000 }, async () => {
    const wb = bigWorkbook(60_000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    // Before JSE-23 the timer could only fire after the write had finished.
    await expect(toUint8Array(wb, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
