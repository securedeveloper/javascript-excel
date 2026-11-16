import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { VERSION } from "../src/index";
import * as csv from "../src/csv";
import { ENTRY as DOM } from "../src/dom";
import * as read from "../src/read";
import { ENTRY as WORKER } from "../src/worker";

describe("entries", () => {
  it("VERSION matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("each placeholder subpath module names itself", () => {
    expect([DOM, WORKER]).toEqual(["javascript-excel/dom", "javascript-excel/worker"]);
  });

  it("/read exports the documented API", () => {
    expect(Object.keys(read).sort()).toEqual(["DEFAULT_READ_LIMITS", "detectFormat", "read", "readSheetNames"]);
  });

  it("/csv exports the documented API", () => {
    expect(Object.keys(csv).sort()).toEqual(["CSV_MIME", "parseCsv", "readCsv", "toCsv", "toCsvBlob"]);
  });
});
