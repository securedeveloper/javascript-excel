// Runs in plain Node (no DOM): importing /dom must not touch any global, and
// calling it without a DOM gives a clear ENVIRONMENT_UNSUPPORTED error.
import { describe, expect, it } from "vitest";
import { isExcelError } from "../src/index";

describe("javascript-excel/dom without a DOM", () => {
  it("imports cleanly (SSR-safe)", async () => {
    expect("document" in globalThis).toBe(false);
    const dom = await import("../src/dom");
    expect(typeof dom.fromTable).toBe("function");
  });

  it("download throws ENVIRONMENT_UNSUPPORTED", async () => {
    const { download } = await import("../src/dom");
    let err: unknown;
    try {
      download("x", "x.txt");
    } catch (e) {
      err = e;
    }
    expect(isExcelError(err) && err.code).toBe("ENVIRONMENT_UNSUPPORTED");
  });
});
