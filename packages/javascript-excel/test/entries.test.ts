import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { VERSION } from "../src/index";
import * as csv from "../src/csv";
import * as dom from "../src/dom";
import * as format from "../src/format";
import * as read from "../src/read";
import * as render from "../src/render";
import * as worker from "../src/worker";
import * as importEntry from "../src/import";

describe("entries", () => {
  it("VERSION matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("/worker exports the documented API", () => {
    expect(Object.keys(worker).sort()).toEqual(["createWorkerClient", "exposeWorker"]);
  });

  it("/read exports the documented API", () => {
    expect(Object.keys(read).sort()).toEqual(["DEFAULT_READ_LIMITS", "detectFormat", "read", "readSheetNames"]);
  });

  it("/dom exports the documented API", () => {
    expect(Object.keys(dom).sort()).toEqual(["DOWNLOAD_REVOKE_DELAY_MS", "download", "fromTable"]);
  });

  it("/render exports the documented API", () => {
    expect(Object.keys(render).sort()).toEqual([
      "colAt", "colLeft", "colWidth", "createRenderSheet", "edge", "isColHidden", "isRowHidden", "lastUsedCell", "mergeAt",
      "rangeAsHtml", "rangeAsTsv", "rangeStats", "renderCell", "rowAt", "rowHeight", "rowTop", "sheetExtent", "sheetSettings", "step",
    ]);
  });

  it("/format exports the documented API", () => {
    expect(Object.keys(format).sort()).toEqual(["formatCell", "formatValue"]);
  });

  it("/import exports the documented API", () => {
    expect(Object.keys(importEntry).sort()).toEqual(["applyMapping", "coerceColumns", "detectHeader", "importDataset", "inferColumnTypes", "mapColumns", "parseDate", "parseNumber"]);
  });

  it("/csv exports the documented API", () => {
    expect(Object.keys(csv).sort()).toEqual(["CSV_MIME", "parseCsv", "readCsv", "toCsv", "toCsvBlob"]);
  });
});
