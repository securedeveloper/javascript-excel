// Real Chromium: a large read on the main thread returns to the event loop, so the
// page keeps rendering frames and handling events while it runs (JSE-24).
import { beforeAll, describe, expect, it } from "vitest";
import { toUint8Array } from "../../src/index";
import { read } from "../../src/read";

let bytes: Uint8Array;
beforeAll(async () => {
  const rows = Array.from({ length: 60_000 }, (_, i) => [i, `Name ${i}`, `user${i}@example.com`, i * 1.25, new Date(Date.UTC(2020, 0, 1 + (i % 365))), i % 2 === 0, `Lorem ipsum ${i % 97}`]);
  bytes = await toUint8Array({ properties: { created: new Date(0), modified: new Date(0) }, sheets: [{ name: "Data", rows }] } as never);
}, 60_000);

describe("reader yields to the browser", () => {
  it("animation frames and timers run while a large read is in flight", { timeout: 60_000 }, async () => {
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
    // Wait for a frame first, so the counters only see the read.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    requestAnimationFrame(tick);
    setTimeout(timer, 0);
    const { workbook } = await read(bytes);
    pending = false;
    expect(workbook.sheets[0]!.rows.length).toBe(60_000);
    // Before JSE-24 the whole read was one task: no frame and no timer ran until it resolved.
    expect(frames).toBeGreaterThanOrEqual(3);
    expect(timers).toBeGreaterThanOrEqual(3);
  });

  it("an abort from a timer stops a read in flight", { timeout: 60_000 }, async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    // Before JSE-24 the timer could only fire after the read had finished.
    await expect(read(bytes, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
