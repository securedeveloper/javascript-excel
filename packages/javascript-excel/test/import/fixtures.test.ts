// Header detection on react-data-import's generated fixtures (copied into
// test/fixtures/import, see the README there).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importDataset } from "../../src/import";

const file = (path: string) => new Uint8Array(readFileSync(new URL(`../fixtures/import/${path}`, import.meta.url)));
const formatOf = (path: string) => (path.endsWith(".csv") ? "csv" : "xlsx") as "csv" | "xlsx";

describe("header detection on react-data-import's fixtures", () => {
  it.each([
    ["csv/title-row.csv", [3]],
    ["csv/blank-rows-before-header.csv", [3]],
    ["csv/blank-delimited-rows-before-header.csv", [2]],
    ["xlsx/title-row-merged.xlsx", [2]],
    ["xlsx/title-rows-unmerged.xlsx", [2]],
    ["xlsx/blank-rows-before-header.xlsx", [3]],
    ["xlsx/offset-table.xlsx", [1]],
    ["xlsx/header-groups.xlsx", [0, 1]],
    ["xlsx/title-and-header-groups.xlsx", [1, 2]],
  ])("%s: header rows %j, high confidence (unchanged)", async (path, rows) => {
    const r = await importDataset(file(path), { format: formatOf(path) });
    expect(r.meta.header).toEqual({ rows, detected: true, confidence: "high" });
  });

  it("csv/two-header-rows.csv: a two-row header without merges is detected and flattened", async () => {
    const r = await importDataset(file("csv/two-header-rows.csv"), { format: "csv" });
    expect(r.meta.header).toEqual({ rows: [0, 1], detected: true, confidence: "high" });
    expect(r.columns.map((c) => c.key)).toEqual(["Region", "Sales / Q1", "Sales / Q2"]);
    expect(r.data.map((row) => ({ ...row }))).toEqual([
      { Region: "North", "Sales / Q1": 10, "Sales / Q2": 20 },
      { Region: "South", "Sales / Q1": 30, "Sales / Q2": 40 },
    ]);
    const explicit = await importDataset(file("csv/two-header-rows.csv"), { format: "csv", header: { rows: 2 } });
    expect(explicit.columns).toEqual(r.columns);
    expect(explicit.data).toEqual(r.data);
  });
});
