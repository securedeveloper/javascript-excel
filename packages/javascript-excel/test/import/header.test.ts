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
