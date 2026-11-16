import { describe, expect, it } from "vitest";
import { PROGRESS_INTERVAL_MS, throttleProgress } from "../src/internal/progress";
import type { Progress } from "../src/write";

describe("throttleProgress", () => {
  it("delivers the first event, phase and sheet changes and ratio 1; drops the rest within the interval", () => {
    const got: Progress[] = [];
    const p = throttleProgress((e) => got.push(e), 10_000)!;
    p({ phase: "prepare", ratio: 0 });
    p({ phase: "sheets", sheet: "A", ratio: 0.1 });
    p({ phase: "sheets", sheet: "A", ratio: 0.2 }); // dropped
    p({ phase: "sheets", sheet: "B", ratio: 0.5 });
    p({ phase: "sheets", sheet: "B", ratio: 0.4 }); // dropped (and never decreases)
    p({ phase: "zip", ratio: 0.95 });
    p({ phase: "zip", ratio: 1 });
    expect(got).toEqual([
      { phase: "prepare", ratio: 0 },
      { phase: "sheets", sheet: "A", ratio: 0.1 },
      { phase: "sheets", sheet: "B", ratio: 0.5 },
      { phase: "zip", ratio: 0.95 },
      { phase: "zip", ratio: 1 },
    ]);
  });
  it("lets an event through once the interval has passed", async () => {
    const got: number[] = [];
    const p = throttleProgress((e) => got.push(e.ratio), 5)!;
    p({ phase: "parse", ratio: 0.1 });
    p({ phase: "parse", ratio: 0.2 });
    await new Promise((r) => setTimeout(r, 15));
    p({ phase: "parse", ratio: 0.3 });
    expect(got).toEqual([0.1, 0.3]);
  });
  it("no callback, no wrapper; the default interval is 50 ms", () => {
    expect(throttleProgress(undefined)).toBeUndefined();
    expect(PROGRESS_INTERVAL_MS).toBe(50);
  });
});
