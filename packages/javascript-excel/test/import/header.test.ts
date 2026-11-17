import { describe, expect, it } from "vitest";
import { fromDataset } from "../../src/dataset";
import { detectHeader } from "../../src/import";
import type { CellInput, Sheet } from "../../src/model";

const sheet = (rows: CellInput[][], merges?: string[]): Sheet => ({ name: "S", rows, ...(merges ? { merges } : {}) });

describe("detectHeader", () => {
  it("finds a plain header", () => {
    expect(detectHeader(sheet([["Name", "Age"], ["Ada", 36], ["Grace", 45]]))).toEqual({ rows: [0], confidence: "high" });
  });

  it("skips title rows and blank rows", () => {
    const s = sheet([["Sales report 2024"], [], ["Region", "Q1", "Q2"], ["North", 10, 20], ["South", 5, 7]]);
    expect(detectHeader(s)).toEqual({ rows: [2], confidence: "high" });
  });

  it("skips a title merged across the table", () => {
    const s = sheet([["Report", null, null], ["A", "B", "C"], [1, 2, 3]], ["A1:C1"]);
    expect(detectHeader(s)).toEqual({ rows: [1], confidence: "high" });
  });

  it("treats numbers written as text (CSV) as data, not as a header", () => {
    const s = sheet([["id", "amount"], ["1", "10.5"], ["2", "3"]]);
    expect(detectHeader(s)).toEqual({ rows: [0], confidence: "high" });
  });

  it("uses the locale to tell numbers from text", () => {
    const s = sheet([["Name", "Betrag"], ["Ada", "1.234,50"]]);
    expect(detectHeader(s, { locale: { decimal: ",", group: "." } }).confidence).toBe("high");
  });

  it("gives low confidence for an all-text table", () => {
    expect(detectHeader(sheet([["Name", "City"], ["Ada", "London"], ["Grace", "Arlington"]]))).toEqual({ rows: [0], confidence: "low" });
  });

  it("reads react-data-export's header groups as a two-row header", () => {
    const s = fromDataset({
      columns: [
        { title: "Name", key: "name" },
        { title: "Q1", children: [{ title: "Jan", key: "jan" }, { title: "Feb", key: "feb" }] },
      ],
      data: [{ name: "Ada", jan: 1, feb: 2 }],
    });
    expect(detectHeader(s)).toEqual({ rows: [0, 1], confidence: "high" });
  });

  it("finds a group row above a header whose first cell isn't merged", () => {
    const s = sheet([[null, "Q1", null], ["Name", "Jan", "Feb"], ["Ada", 1, 2]], ["B1:C1"]);
    expect(detectHeader(s)).toEqual({ rows: [0, 1], confidence: "high" });
  });

  it("reads two stacked text rows over typed data as a two-row header (CSV has no merges)", () => {
    // Every text cell of the second row sits on a column of numbers, so it can't be a data row.
    expect(detectHeader(sheet([["Region", "Sales", "Sales"], ["", "Q1", "Q2"], ["North", "10", "20"], ["South", "30", "40"]]))).toEqual({ rows: [0, 1], confidence: "high" });
    // A units row.
    expect(detectHeader(sheet([["Temp", "Pressure"], ["°C", "hPa"], ["20", "1013"]]))).toEqual({ rows: [0, 1], confidence: "high" });
  });

  it("reads a group row over its columns as a two-row header when neither row fills the table", () => {
    // toCsv of react-data-export's header groups: "Name,Q1," over ",Jan,Feb".
    const s = sheet([["Name", "Q1", ""], ["", "Jan", "Feb"], ["Ada", "1", "2"], ["Bob", "3", "4"]]);
    expect(detectHeader(s)).toEqual({ rows: [0, 1], confidence: "high" });
  });

  it("keeps a first data row with text in text columns as data", () => {
    expect(detectHeader(sheet([["Name", "City", "Amount"], ["Bob", "Paris", ""], ["Ada", "Oslo", "10"]]))).toEqual({ rows: [0], confidence: "high" });
  });

  it("gives low confidence when the row under the header is all text and only partly fits a header", () => {
    // "n/a" in a numeric column could be a sub-header or a data value; "Ada" is clearly data.
    expect(detectHeader(sheet([["Name", "Amount"], ["Ada", "n/a"], ["Bob", "10"]]))).toEqual({ rows: [0], confidence: "low" });
    // A second header row whose first cell sits on a text column.
    expect(detectHeader(sheet([["Region", "Sales", "Sales"], ["Area", "Q1", "Q2"], ["North", "10", "20"]]))).toEqual({ rows: [0], confidence: "low" });
  });

  it("respects range and maxScan", () => {
    const s = sheet([["x"], ["y"], ["Name", "Age"], ["Ada", 1]]);
    expect(detectHeader(s, { range: "A3:B4" })).toEqual({ rows: [2], confidence: "high" });
    expect(detectHeader(sheet([[1, 2], [3, 4], ["a", "b"], [5, 6]]), { maxScan: 2 })).toEqual({ rows: [0], confidence: "low" });
    expect(() => detectHeader(s, { maxScan: 0 })).toThrow(TypeError);
  });

  it("falls back to the first row of an empty or numeric sheet", () => {
    expect(detectHeader(sheet([]))).toEqual({ rows: [0], confidence: "low" });
    expect(detectHeader(sheet([[1, 2], [3, 4]]))).toEqual({ rows: [0], confidence: "low" });
  });
});
