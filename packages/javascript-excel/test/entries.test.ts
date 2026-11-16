import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { VERSION } from "../src/index";
import * as csv from "../src/csv";
import * as dom from "../src/dom";
import * as read from "../src/read";
import * as worker from "../src/worker";

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

  it("/csv exports the documented API", () => {
    expect(Object.keys(csv).sort()).toEqual(["CSV_MIME", "parseCsv", "readCsv", "toCsv", "toCsvBlob"]);
  });
});
