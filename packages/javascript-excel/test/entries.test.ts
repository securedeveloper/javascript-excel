import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { VERSION } from "../src/index";
import { ENTRY as CSV } from "../src/csv";
import { ENTRY as DOM } from "../src/dom";
import { ENTRY as READ } from "../src/read";
import { ENTRY as WORKER } from "../src/worker";

describe("placeholder entries", () => {
  it("VERSION matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("each subpath module names itself", () => {
    expect([READ, CSV, DOM, WORKER]).toEqual([
      "javascript-excel/read",
      "javascript-excel/csv",
      "javascript-excel/dom",
      "javascript-excel/worker",
    ]);
  });
});
