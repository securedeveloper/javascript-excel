// read(write(x)) == x for everything the writer (JSE-3) and the reader share.
//
// The writer normalises some input (it completes fonts with the workbook
// default font, adds built-in format 14 to bare dates, writes colours as
// ARGB objects), so "== x" is checked in two parts:
// 1. every value, type, formula and every style field given in x comes back
//    (toMatchObject against x in the reader's object form);
// 2. the round trip is a fixpoint: read(write(read(write(x)))) deep-equals
//    read(write(x)), so nothing drifts on a second pass.
import { describe, expect, it } from "vitest";
import type { Cell, CellInput, Style, Workbook } from "../../src/model";
import { read, type ReadOptions } from "../../src/read";
import { toUint8Array, type WriteOptions } from "../../src/write";
import { featuresWorkbook } from "../write/golden-cases";

const FIXED = new Date(Date.UTC(2024, 0, 1));
const props = { created: FIXED, modified: FIXED };

async function roundTrip(wb: Workbook, w?: WriteOptions, r?: ReadOptions): Promise<Workbook<Cell>> {
  const first = (await read(await toUint8Array(wb, w), r)).workbook;
  const second = (await read(await toUint8Array(first as Workbook, w), r)).workbook;
  expect(second).toEqual(first);
  return first;
}

const STYLE_FULL: Style = {
  font: { name: "Arial", size: 14, bold: true, italic: true, underline: "double", strike: true, color: { rgb: "FF336699" }, vertAlign: "superscript", family: 2, charset: 0, scheme: "none", outline: true, shadow: true, condense: true, extend: true },
  fill: { type: "pattern", pattern: "darkTrellis", fgColor: { rgb: "FFFF0000" }, bgColor: { theme: 4, tint: -0.25 } },
  border: {
    left: { style: "thin", color: { rgb: "FF000000" } },
    right: { style: "medium", color: { indexed: 10 } },
    top: { style: "dashDotDot", color: { theme: 1 } },
    bottom: { style: "double", color: { auto: true } },
    diagonal: { style: "hair" },
    diagonalUp: true,
    diagonalDown: true,
  },
  alignment: { horizontal: "centerContinuous", vertical: "distributed", wrapText: true, shrinkToFit: true, indent: 3, rotation: -45, readingOrder: "rtl", justifyLastLine: true },
  numFmt: '#,##0.00 "€";[Red]-#,##0.00 "€"',
  protection: { locked: false, hidden: true },
};

describe("read(write(x))", () => {
  it("values and types", async () => {
    const values: CellInput[] = [
      "text",
      "",
      "  spaces kept  ",
      "line1\nline2\r\nline3",
      "tab\tand control \u0001 char",
      "_x0041_ looks like an escape",
      "=not a formula",
      "café 漢字 😀",
      "x".repeat(32_767),
      0,
      -0.5,
      1e-300,
      123456789012345,
      Number.MAX_SAFE_INTEGER,
      true,
      false,
      { error: "#DIV/0!" },
      { error: "#N/A" },
      { error: "#NAME?" },
      { error: "#NULL!" },
      { error: "#NUM!" },
      { error: "#REF!" },
      { error: "#VALUE!" },
      { richText: [{ text: "plain " }, { text: "bold", font: { bold: true, color: { rgb: "FFFF0000" } } }, { text: " sub", font: { vertAlign: "subscript" } }] },
    ];
    const wb = await roundTrip({ properties: props, sheets: [{ name: "V", rows: values.map((v) => [v]) }] });
    const got = wb.sheets[0]!.rows.map((r) => r![0]!);
    values.forEach((v, i) => {
      if (typeof v === "object" && v !== null && "richText" in v) {
        expect(got[i]!.type).toBe("richText");
        expect(got[i]!.value).toMatchObject(v);
      } else expect(got[i]!.value, `row ${i + 1}`).toEqual(v);
    });
    expect(got.map((c) => c.type)).toEqual([...Array(9).fill("string"), ...Array(5).fill("number"), "boolean", "boolean", ...Array(7).fill("error"), "richText"]);
  });

  it("dates in both zones and both date systems", async () => {
    const dates = [new Date(Date.UTC(1900, 0, 1)), new Date(Date.UTC(1900, 1, 28)), new Date(Date.UTC(1900, 2, 1)), new Date(Date.UTC(2024, 1, 29, 23, 59, 59, 999)), new Date(Date.UTC(9999, 11, 31))];
    for (const date1904 of [false, true]) {
      const input = date1904 ? [new Date(Date.UTC(1904, 0, 1)), ...dates.slice(3)] : dates;
      const wb = await roundTrip({ properties: props, date1904, sheets: [{ name: "D", rows: [input] }] }, { dateZone: "utc" }, { dateZone: "utc" });
      expect(wb.date1904 ?? false).toBe(date1904);
      expect(wb.sheets[0]!.rows[0]!.map((c) => c!.value)).toEqual(input);
      expect(wb.sheets[0]!.rows[0]!.every((c) => c!.type === "date" && c!.style?.numFmt === 14)).toBe(true);
    }
    const local = [new Date(2024, 2, 31, 2, 30), new Date(2024, 9, 27, 12, 0, 0, 5)];
    const wb = await roundTrip({ properties: props, sheets: [{ name: "L", rows: [local] }] });
    expect(wb.sheets[0]!.rows[0]!.map((c) => c!.value)).toEqual(local);
    // dates: 'serial' gives the stored number back.
    const serial = (await read(await toUint8Array({ properties: props, sheets: [{ name: "S", rows: [[new Date(Date.UTC(2024, 0, 15, 12))]] }] }, { dateZone: "utc" }), { dates: "serial" })).workbook;
    expect(serial.sheets[0]!.rows[0]![0]).toMatchObject({ type: "number", value: 45306.5 });
  });

  it("formulas: cached values of every type, none, array formulas", async () => {
    const rows: CellInput[][] = [
      [{ formula: "1+1", value: 2 }, { formula: '"a"&"b"', value: "ab" }, { formula: "TRUE", value: true }, { formula: "1/0", value: { error: "#DIV/0!" } }, { formula: "=A1*2" }],
      [{ formula: "A1:A2*2", arrayRef: "A2:A3", value: 4 }],
    ];
    const wb = await roundTrip({ properties: props, sheets: [{ name: "F", rows }] });
    expect(wb.sheets[0]!.rows[0]).toEqual([
      { type: "number", value: 2, formula: "1+1" },
      { type: "string", value: "ab", formula: '"a"&"b"' },
      { type: "boolean", value: true, formula: "TRUE" },
      { type: "error", value: { error: "#DIV/0!" }, formula: "1/0" },
      { type: "empty", formula: "A1*2" },
    ]);
    expect(wb.sheets[0]!.rows[1]![0]).toEqual({ type: "number", value: 4, formula: "A1:A2*2", arrayRef: "A2:A3" });
    expect(wb.calc).toEqual({ fullCalcOnLoad: true });
  });

  it("styles: every field, shared frozen objects, styled empty cells, row and column styles", async () => {
    const plain: Style = { numFmt: 10 };
    const gradient: Style = { fill: { type: "gradient", gradient: "linear", degree: 90, stops: [{ position: 0, color: { rgb: "FFFFFFFF" } }, { position: 1, color: { theme: 4 } }] } };
    const builtin: Style = { numFmt: 22, alignment: { rotation: "vertical" } };
    const wb = await roundTrip({
      properties: props,
      sheets: [
        {
          name: "St",
          rows: [
            [{ value: "full", style: STYLE_FULL }, { value: "same", style: STYLE_FULL }, { style: plain }],
            [{ value: 1, style: gradient }, { value: 2, style: builtin }],
          ],
        },
      ],
    });
    const [r0, r1] = wb.sheets[0]!.rows;
    expect(r0![0]!.style).toMatchObject(STYLE_FULL);
    expect(r0![1]!.style).toBe(r0![0]!.style); // Q8
    expect(Object.isFrozen(r0![0]!.style!.border!.left)).toBe(true);
    expect(r0![2]).toEqual({ type: "empty", style: plain });
    expect(r1![0]!.style).toMatchObject(gradient);
    expect(r1![1]!.style).toMatchObject(builtin);
  });

  it("sheet features (JSE-4's featuresWorkbook): names, layout, merges, views, print, hyperlinks", async () => {
    const wb = await roundTrip(featuresWorkbook());
    expect(wb.definedNames).toEqual([
      { name: "TaxRate", ref: "'Report'!$B$2" },
      { name: "LocalName", ref: "Second!$A$1", sheet: 1, hidden: true, comment: "local to Second" },
    ]);
    const [report, second, frozenRows, frozenCols] = wb.sheets;
    expect(report).toMatchObject({
      tabColor: { rgb: "FFFF0000" },
      defaultColWidth: 10,
      defaultRowHeight: 18,
      merges: ["A11:D11", "F11:G12"],
      autoFilter: "A1:D10",
      view: { freeze: { rows: 1, cols: 1 }, zoom: 120, showGridLines: false },
      print: {
        orientation: "landscape",
        paperSize: 9,
        fitTo: { width: 1, height: 0 },
        margins: { left: 0.5, top: 1 },
        center: { horizontal: true },
        gridLines: true,
        headings: true,
        printArea: "A1:D20",
        printTitles: { rows: "1:1", cols: "A:A" },
        header: { odd: "&CReport" },
        footer: { odd: "&RPage &P of &N", first: "&CFirst page" },
      },
    });
    const cols = report!.colProps!;
    expect(cols[0]!.width).toBeCloseTo(20, 0);
    expect(cols[1]!.width).toBeCloseTo(12, 0);
    expect(typeof cols[2]!.width).toBe("number"); // 100 px, converted to characters by the writer
    expect(typeof cols[3]!.width).toBe("number"); // "auto", measured by the writer
    expect(cols[4]).toMatchObject({ hidden: true });
    expect(cols[5]).toMatchObject({ outlineLevel: 1, style: { font: { bold: true } } });
    const rows = report!.rowProps!;
    expect(rows[0]).toMatchObject({ height: 30, style: { fill: { pattern: "solid", fgColor: { rgb: "FFDDEBF7" } } } });
    expect(rows[3]).toMatchObject({ hidden: true });
    expect(rows[4]).toMatchObject({ outlineLevel: 2, collapsed: true });
    expect(rows[14]).toMatchObject({ height: 25 });
    const links = report!.rows[1]!.map((c) => c!.hyperlink);
    expect(links).toEqual([
      { target: "https://example.com/a?b=1&c=2" },
      { target: "mailto:someone@example.com", tooltip: "Write to us" },
      { location: "'Second'!A1", tooltip: "go" },
      { target: "https://example.com/a?b=1&c=2" },
    ]);
    expect(second!.view).toEqual({ rightToLeft: true });
    expect(second!.colProps![0]).toMatchObject({ style: { font: { bold: true, italic: true } } });
    expect(frozenRows!.view).toEqual({ freeze: { rows: 2 }, activeCell: "B5", selection: "B5:C6" });
    // The writer puts the selection in the pane right of the split, so the active cell reads back as C1.
    expect(frozenCols!.view).toEqual({ freeze: { cols: 2 }, activeCell: "C1" });
  });

  it("workbook structure: sheet order, visibility, active sheet, properties", async () => {
    const wb = await roundTrip({
      activeSheet: 2,
      properties: { ...props, title: "Title", subject: "Subj", creator: "Me", keywords: "k1 k2", description: "Desc", lastModifiedBy: "You", category: "Cat", company: "Co", manager: "Boss", custom: [{ name: "Text", value: "v" }, { name: "Num", value: 1.5 }, { name: "Flag", value: true }, { name: "When", value: FIXED }] },
      sheets: [
        { name: "Sheet A", rows: [["a"]] },
        { name: "B", state: "hidden", rows: [] },
        { name: "C", rows: [[1]] },
        { name: "D", state: "veryHidden", rows: [] },
      ],
    });
    expect(wb.sheets.map((s) => [s.name, s.state])).toEqual([["Sheet A", undefined], ["B", "hidden"], ["C", undefined], ["D", "veryHidden"]]);
    expect(wb.activeSheet).toBe(2);
    expect(wb.properties).toMatchObject({ title: "Title", subject: "Subj", creator: "Me", keywords: "k1 k2", description: "Desc", lastModifiedBy: "You", category: "Cat", company: "Co", manager: "Boss", created: FIXED, modified: FIXED });
    expect(wb.properties!.custom).toEqual([{ name: "Text", value: "v" }, { name: "Num", value: 1.5 }, { name: "Flag", value: true }, { name: "When", value: FIXED }]);
  });

  it("large sparse sheet: positions and dimension", { timeout: 60_000 }, async () => {
    const rows: CellInput[][] = [];
    rows[0] = ["first"];
    rows[99_999] = [];
    rows[99_999]![16_383] = "XFD100000";
    const wb = await roundTrip({ properties: props, sheets: [{ name: "Big", rows }] });
    const s = wb.sheets[0]!;
    expect(s.rows[99_999]![16_383]).toEqual({ type: "string", value: "XFD100000" });
    expect(s.dimension).toBe("A1:XFD100000");
  });

  it("random workbooks: values survive and the round trip is a fixpoint", { timeout: 60_000 }, async () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
    const gen = (): CellInput => {
      const k = rnd();
      if (k < 0.25) return pick(["a", "b c", "é", "<&>\"'", "  ", "_x005F_", "1e3"]);
      if (k < 0.5) return Math.round((rnd() - 0.5) * 1e6) / 100;
      if (k < 0.6) return rnd() < 0.5;
      if (k < 0.7) return new Date(Date.UTC(1990 + Math.floor(rnd() * 40), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 28)));
      if (k < 0.8) return { error: pick(["#N/A", "#REF!", "#VALUE!"] as const) };
      if (k < 0.9) return { value: Math.floor(rnd() * 100), style: { font: { bold: rnd() < 0.5, italic: rnd() < 0.5 }, numFmt: pick([0, 2, 10, "0.000"]) } };
      return undefined;
    };
    for (let n = 0; n < 20; n++) {
      const rows = Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => Array.from({ length: 1 + Math.floor(rnd() * 8) }, gen));
      const wb = await roundTrip({ properties: props, sheets: [{ name: `R${n}`, rows }] }, { dateZone: "utc" }, { dateZone: "utc" });
      rows.forEach((row, r) =>
        row.forEach((v, c) => {
          const got = wb.sheets[0]!.rows[r]?.[c];
          if (v === undefined) return expect(got).toBeUndefined();
          const want = typeof v === "object" && v !== null && "value" in v ? v.value : v;
          expect(got?.value, `R${n} ${r},${c}`).toEqual(want);
        }),
      );
    }
  });
});
