// Workbooks shared by the golden-file tests (openpyxl) and the LibreOffice check.
import type { Workbook } from "../../src/index";

export const LONG_TEXT: string = "x".repeat(32_767);

/** Every value type, including the text edge cases of ST_Xstring. */
export function valuesWorkbook(): Workbook {
  return {
    properties: { created: new Date(0), modified: new Date(0) },
    sheets: [
      {
        name: "Values",
        rows: [
          ["plain", "été 漢字 😀", "=1+1", "  padded  ", "line1\r\nline2", "_x0041_ literal", "ctrl\u0001char", "", LONG_TEXT],
          [0, -0, 42, -3.5, 0.1 + 0.2, 1e21, 1e-7, Number.MAX_SAFE_INTEGER, 123456789.125],
          [true, false],
          [
            new Date(2024, 0, 15),
            new Date(2024, 0, 15, 10, 30, 15, 500),
            new Date(1900, 0, 1),
            new Date(1900, 1, 28),
            new Date(1900, 2, 1),
            new Date(9999, 11, 31),
          ],
          [{ error: "#NULL!" }, { error: "#DIV/0!" }, { error: "#VALUE!" }, { error: "#REF!" }, { error: "#NAME?" }, { error: "#NUM!" }, { error: "#N/A" }],
          [
            { formula: "SUM(B2:C2)", value: 42 },
            { formula: '=A1&"!"', value: "plain!" },
            { formula: "B2>0", value: false },
            { formula: "1/0", value: { error: "#DIV/0!" } },
            { formula: "TODAY()", value: new Date(2024, 0, 15) },
            { formula: "NOW()" },
            { formula: "B2:B3*2", arrayRef: "G6:G7", value: 0 },
          ],
          [{ value: null, style: { fill: "FFEE00" } }, { style: { font: { bold: true } } }, { value: "typed", type: "string" }],
          [{ richText: [{ text: "Bold ", font: { bold: true } }, { text: "red", font: { color: "FF0000", italic: true } }, { text: " plain" }] }],
        ],
      },
    ],
  };
}

/** One cell per style feature, with explicit RGB colours so other readers can compare them. */
export function stylesWorkbook(): Workbook {
  return {
    properties: { created: new Date(0), modified: new Date(0) },
    sheets: [
      {
        name: "Styles",
        rows: [
          [
            { value: "font", style: { font: { name: "Arial", size: 14, bold: true, italic: true, color: "C00000" } } },
            { value: "double underline", style: { font: { underline: "double" } } },
            { value: "strike", style: { font: { strike: true } } },
            { value: "superscript", style: { font: { vertAlign: "superscript" } } },
            { value: "solid", style: { fill: "FFFF00" } },
            { value: "pattern", style: { fill: { pattern: "darkGrid", fgColor: "FF0000", bgColor: "0000FF" } } },
            {
              value: "borders",
              style: {
                border: {
                  left: { style: "thin", color: "FF0000" },
                  right: { style: "medium", color: "00B050" },
                  top: { style: "double", color: "0070C0" },
                  bottom: { style: "dashed", color: "7030A0" },
                },
              },
            },
            { value: "aligned", style: { alignment: { horizontal: "center", vertical: "top", wrapText: true } } },
            { value: "up 45", style: { alignment: { rotation: 45 } } },
            { value: "down 45", style: { alignment: { rotation: -45 } } },
            { value: "stacked", style: { alignment: { rotation: "vertical" } } },
            { value: "indent", style: { alignment: { horizontal: "left", indent: 2 } } },
            { value: 1234.5678, style: { numFmt: "0.000" } },
            { value: 1234.5678, style: { numFmt: "#,##0.00" } },
            { value: 0.256, style: { numFmt: 10 } },
            { value: new Date(2024, 0, 15), style: { numFmt: "yyyy-mm-dd" } },
          ],
        ],
      },
    ],
  };
}

/** Every sheet feature: widths, heights, outline, merges, filter, views, links, names, print. */
export function featuresWorkbook(): Workbook {
  const data = Array.from({ length: 8 }, (_, i) => [`Item ${i + 1}`, i * 10, i * 2.5, `note ${"x".repeat(i)}`, "hidden col", i, "", "zero"]);
  return {
    properties: { created: new Date(0), modified: new Date(0) },
    activeSheet: 0,
    definedNames: [
      { name: "TaxRate", ref: "'Report'!$B$2" },
      { name: "LocalName", ref: "=Second!$A$1", sheet: 1, hidden: true, comment: "local to Second" },
    ],
    sheets: [
      {
        name: "Report",
        tabColor: "FF0000",
        defaultColWidth: 10,
        defaultRowHeight: 18,
        rows: [
          ["Name", "Qty", "Price", "Notes — 漢字 wide", "Hidden", "Grouped", "", "Zero"],
          [
            { value: "site", hyperlink: "https://example.com/a?b=1&c=2" },
            { value: "mail", hyperlink: { target: "mailto:someone@example.com", tooltip: "Write to us" } },
            { value: "jump", hyperlink: { location: "'Second'!A1", tooltip: "go" } },
            { value: "same site", hyperlink: "https://example.com/a?b=1&c=2" },
          ],
          ...data,
          ["merged across", undefined, undefined, undefined, undefined, "merged block"],
        ],
        colProps: [
          { width: 20 },
          { width: { wch: 12 } },
          { width: { wpx: 100 } },
          { width: "auto" },
          { hidden: true },
          { outlineLevel: 1, style: { font: { bold: true } } },
          undefined,
          { width: 0 },
        ],
        rowProps: [{ height: 30, style: { fill: "DDEBF7" } }, undefined, undefined, { hidden: true }, { outlineLevel: 2, collapsed: true }, ...Array<undefined>(9), { height: 25 }],
        merges: ["A11:D11", "F11:G12"],
        autoFilter: "A1:D10",
        view: { freeze: { rows: 1, cols: 1 }, zoom: 120, showGridLines: false },
        print: {
          orientation: "landscape",
          paperSize: 9,
          fitTo: { width: 1 },
          margins: { left: 0.5, top: 1 },
          center: { horizontal: true },
          gridLines: true,
          headings: true,
          printArea: "A1:D20",
          printTitles: { rows: "1:1", cols: "A:A" },
          header: { odd: "&CReport" },
          footer: { odd: "&RPage &P of &N", first: "&CFirst page" },
        },
      },
      {
        name: "Second",
        defaultStyle: { font: { italic: true } },
        colProps: [{ style: { font: { bold: true } } }],
        view: { rightToLeft: true },
        rows: [["RTL sheet"], [undefined, "plain"]],
      },
      { name: "Frozen rows", view: { freeze: { rows: 2 }, activeCell: "B5", selection: "B5:C6" }, rows: [["a"], ["b"], ["c"]] },
      { name: "Frozen cols", view: { freeze: { cols: 2 } }, rows: [["a", "b", "c"]] },
    ],
  };
}
