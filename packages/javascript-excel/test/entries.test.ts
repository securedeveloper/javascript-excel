import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { VERSION } from "../src/index";
import * as csv from "../src/csv";
import { ENTRY as DOM } from "../src/dom";
import { ENTRY as READ } from "../src/read";
import { ENTRY as WORKER } from "../src/worker";

describe("entries", () => {
  it("VERSION matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("each placeholder subpath module names itself", () => {
    expect([READ, DOM, WORKER]).toEqual(["javascript-excel/read", "javascript-excel/dom", "javascript-excel/worker"]);
  });

  it("/csv exports the documented API", () => {
    expect(Object.keys(csv).sort()).toEqual(["CSV_MIME", "parseCsv", "readCsv", "toCsv", "toCsvBlob"]);
  });
});
