// Type-level tests for the model (docs/api.md §3). They run under `npm run typecheck`
// (the @ts-expect-error lines must stay errors) and at runtime check that the model
// is plain, structured-cloneable data.
import { describe, expect, it } from "vitest";
import type { BorderStyle, Cell, CellInput, Color, PatternType, Sheet, Style, Workbook } from "../src/index";

const style: Style = {
  font: { name: "Calibri", size: 11, bold: true, color: "FFFFFF", underline: "double", vertAlign: "superscript" },
  fill: { pattern: "solid", fgColor: { theme: 4, tint: -0.25 } },
  border: { top: { style: "double", color: { rgb: "FF000000" } }, diagonal: { style: "hair" }, diagonalUp: true },
  alignment: { horizontal: "centerContinuous", rotation: -45, readingOrder: "rtl", indent: 2 },
  numFmt: 14,
};

// docs/api.md §10.4, written as a typed literal.
const workbook: Workbook = {
  sheets: [
    {
      name: "Report",
      rows: [
        ["Item", "Qty", "Price", "Line total"],
        ["Pens", 10, 1.5, { formula: "B2*C2", value: 15 }],
        ["Pads", 4, 3.25, { formula: "B3*C3", value: 13, style }],
        [new Date(Date.UTC(2024, 0, 15)), true, { error: "#N/A" }, { richText: [{ text: "a" }, { text: "b", font: { italic: true } }] }],
      ],
      colProps: [{ width: 20 }, { width: { wch: 8.43 } }, { width: { wpx: 64 } }],
      rowProps: [{ height: 20, style: { font: { bold: true } } }],
      merges: ["A6:B6"],
      autoFilter: "A1:D1",
      view: { freeze: { rows: 1 }, rightToLeft: false, zoom: 120 },
      print: { orientation: "landscape", fitTo: { width: 1, height: 0 }, printTitles: { rows: "1:1" } },
      tabColor: "#FF0000",
    },
  ],
  properties: { creator: "test", created: new Date(0), custom: [{ name: "x", value: 1 }] },
  definedNames: [{ name: "TaxRate", ref: "Report!$B$2" }],
  calc: { fullCalcOnLoad: "auto" },
};

const readBack: Workbook<Cell> = {
  sheets: [{ name: "S", rows: [[{ type: "number", value: 1 }, undefined, { type: "empty", style }]], dimension: "A1:C1" }],
  theme: { colors: ["FF000000"] },
};

// Reader output is valid writer input.
const asInput: Workbook<CellInput> = readBack;

// Negative cases: these must not compile.
// @ts-expect-error not an ST_BorderStyle value
const badBorder: BorderStyle = "dash";
// @ts-expect-error not an ST_PatternType value
const badPattern: PatternType = "checker";
// @ts-expect-error auto must be true
const badColor: Color = { auto: false };
// @ts-expect-error error codes are the seven ECMA-376 values
const badError: CellInput = { error: "#SPILL!" };
// @ts-expect-error rows hold cells, not numbers keyed by ref
const badSheet: Sheet = { name: "x", rows: { A1: 1 } };

describe("model", () => {
  it("is plain data that survives structuredClone", () => {
    const clone = structuredClone(workbook);
    expect(clone).toEqual(workbook);
    expect(clone.sheets[0]!.rows[3]![0]).toBeInstanceOf(Date);
    expect(structuredClone(asInput)).toEqual(readBack);
  });

  it("keeps the negative-case fixtures referenced", () => {
    expect([badBorder, badPattern, badColor, badError, badSheet]).toHaveLength(5);
  });
});
