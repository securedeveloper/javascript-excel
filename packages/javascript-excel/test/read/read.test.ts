/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeZip } from "../../src/internal/zip/write";
import type { Cell, Sheet } from "../../src/model";
import { readImpl } from "../../src/internal/read/reader";
import { DEFAULT_READ_LIMITS, detectFormat, read, readSheetNames, type ReadOptions } from "../../src/read";
import { build, NS, numFmtStyles } from "./build";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/read/${name}`, import.meta.url)));
const sheet0 = async (bytes: Uint8Array, o?: ReadOptions) => (await read(bytes, { dateZone: "utc", ...o })).workbook.sheets[0]!;
const at = (s: Sheet<Cell>, ref: string): Cell | undefined => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let c = 0;
  for (const ch of m[1]!) c = c * 26 + ch.charCodeAt(0) - 64;
  return s.rows[Number(m[2]) - 1]?.[c - 1];
};
const codes = (w: Array<{ code: string }>) => w.map((x) => x.code);

async function errorOf(p: Promise<unknown>): Promise<{ code?: string; name?: string; details?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string };
  }
  throw new Error("expected a rejection");
}

describe("openpyxl fixtures", () => {
  it("values, types, dates, formulas, errors, rich text", async () => {
    const r = await read(fixture("openpyxl-features.xlsx"), { dateZone: "utc" });
    expect(r.warnings).toEqual([]);
    const s = r.workbook.sheets[0]!;
    expect(s.name).toBe("Values");
    expect(s.rows[0]!.map((c) => c?.value)).toEqual([
      "text",
      42,
      3.5,
      true,
      new Date(Date.UTC(2024, 0, 15)),
      new Date(Date.UTC(2024, 0, 15, 10, 30)),
      undefined,
      { error: "#N/A" },
    ]);
    expect(s.rows[0]!.map((c) => c?.type)).toEqual(["string", "number", "number", "boolean", "date", "date", "empty", "error"]);
    expect(at(s, "G1")).toEqual({ type: "empty", formula: "B1*2" });
    expect(at(s, "A4")).toEqual({ type: "empty", formula: "SUM(B1:C1)" });
    expect(at(s, "A2")!.value).toBe("  leading and trailing  ");
    expect(at(s, "C2")!.value).toBe("line1\nline2");
    expect(at(s, "D2")!.value).toBe("café 漢字 😀");
    // openpyxl writes "_x0041_" unescaped, so it reads as "A", exactly as Excel shows it.
    expect(at(s, "E2")!.value).toBe("A literal");
    expect(at(s, "A3")).toEqual({
      type: "richText",
      value: { richText: [{ text: "plain " }, { text: "bold red", font: { bold: true, color: { rgb: "FFFF0000" } } }, { text: " end" }] },
    });
    expect(at(s, "B3")).toEqual({ type: "number", value: 0.5, style: { numFmt: 10 } });
    expect(at(s, "C3")).toEqual({ type: "number", value: 1234.5, style: { numFmt: 4 } });
    // [h]:mm:ss (built-in 46) is a duration, not a date.
    expect(at(s, "D3")).toEqual({ type: "number", value: 1.5, style: { numFmt: 46 } });
    expect(s.dimension).toBe("A1:H4");
  });

  it("styles, layout, view, print, hyperlinks, sheet list, names, properties", async () => {
    const { workbook: wb } = await read(fixture("openpyxl-features.xlsx"), { dateZone: "utc" });
    expect(wb.sheets.map((s) => [s.name, s.state])).toEqual([
      ["Values", undefined],
      ["Styles", undefined],
      ["Hidden", "hidden"],
    ]);
    expect(wb.activeSheet).toBe(1);
    const s = wb.sheets[1]!;
    const a1 = at(s, "A1")!;
    expect(a1.style).toEqual({
      font: { name: "Arial", size: 14, bold: true, italic: true, underline: "double", strike: true, color: { rgb: "FF336699" } },
      fill: { type: "pattern", pattern: "solid", fgColor: { rgb: "FFFFFF00" } },
      border: { left: { style: "thin", color: { rgb: "FF000000" } }, bottom: { style: "double", color: { rgb: "FFFF0000" } } },
      alignment: { horizontal: "center", vertical: "top", wrapText: true, rotation: 45 },
      protection: { locked: false, hidden: false },
    });
    // Q8: one frozen Style object per xf, shared by every cell that uses it.
    expect(at(s, "B1")!.style).toBe(a1.style);
    expect(Object.isFrozen(a1.style)).toBe(true);
    expect(Object.isFrozen(a1.style!.font)).toBe(true);
    expect(at(s, "A2")!.style).toEqual({ fill: { type: "pattern", pattern: "darkGrid", fgColor: { rgb: "FF00FF00" }, bgColor: { rgb: "FF0000FF" } } });
    expect(at(s, "A3")!.style!.alignment).toEqual({ horizontal: "left", indent: 2, rotation: -45 });
    expect(s.merges).toEqual(["C1:D2"]);
    // openpyxl stores width 30 as given; Excel shows that as 29.29 characters, which the model uses.
    expect(s.colProps?.[0]).toEqual({ width: 29.29 });
    expect(s.colProps?.[2]).toMatchObject({ hidden: true });
    expect(s.rowProps?.[1]).toEqual({ height: 40 });
    expect(s.view).toEqual({ zoom: 150, freeze: { rows: 1, cols: 1 } });
    expect(s.tabColor).toEqual({ rgb: "FF00B050" });
    expect(s.autoFilter).toBe("A1:B3");
    expect(at(s, "A5")!.hyperlink).toEqual({ target: "https://example.com/path?q=1" });
    expect(at(s, "B5")!.hyperlink).toEqual({ location: "'Values'!A1", tooltip: "go" });
    expect(s.print).toMatchObject({
      gridLines: true,
      orientation: "landscape",
      paperSize: 9,
      fitTo: { width: 1, height: 0 },
      header: { odd: "&CPage &P" },
      printArea: "A1:D10",
      printTitles: { rows: "1:1" },
    });
    expect(wb.definedNames).toEqual([{ name: "TaxRate", ref: "Values!$B$1" }]);
    expect(wb.properties).toMatchObject({ title: "Fixture", creator: "fixture-generator", created: new Date(Date.UTC(2024, 0, 15, 10, 30)) });
    expect(wb.theme?.colors).toHaveLength(12);
    expect(wb.theme?.minorFont).toBe("Calibri");
  });

  it("1904 date system", async () => {
    const { workbook } = await read(fixture("openpyxl-1904.xlsx"), { dateZone: "utc" });
    expect(workbook.date1904).toBe(true);
    const s = workbook.sheets[0]!;
    expect(at(s, "A1")!.value).toEqual(new Date(Date.UTC(2024, 0, 15)));
    expect(at(s, "A2")!.value).toEqual(new Date(Date.UTC(1904, 0, 1)));
  });

  it("readSheetNames and detectFormat", async () => {
    const bytes = fixture("openpyxl-features.xlsx");
    expect(await readSheetNames(bytes)).toEqual([
      { name: "Values", index: 0, state: "visible" },
      { name: "Styles", index: 1, state: "visible" },
      { name: "Hidden", index: 2, state: "hidden" },
    ]);
    expect(await detectFormat(bytes)).toBe("xlsx");
  });

  it("options: sheets, styles: false, formulas: false, dates: 'serial', richText: 'plain'", async () => {
    const bytes = fixture("openpyxl-features.xlsx");
    const { workbook } = await read(bytes, { sheets: ["styles", 2], styles: false, formulas: false, dates: "serial", richText: "plain" });
    expect(workbook.sheets.map((s) => s.rows.length)).toEqual([0, 5, 1]);
    expect(at(workbook.sheets[1]!, "A1")).toEqual({ type: "string", value: "styled" });
    const all = await read(bytes, { styles: false, formulas: false, dates: "serial", richText: "plain" });
    const v = all.workbook.sheets[0]!;
    expect(at(v, "E1")).toEqual({ type: "number", value: 45306 });
    expect(at(v, "G1")).toBeUndefined(); // formula without cached value and without style
    expect(at(v, "A3")).toEqual({ type: "string", value: "plain bold red end" });
    // styles: false still detects dates from the number format.
    expect(at((await read(bytes, { styles: false, dateZone: "utc" })).workbook.sheets[0]!, "E1")).toEqual({ type: "date", value: new Date(Date.UTC(2024, 0, 15)) });
  });

  it("accepts Uint8Array, ArrayBuffer, Buffer and Blob", async () => {
    const bytes = fixture("openpyxl-1904.xlsx");
    for (const input of [bytes, bytes.slice().buffer, Buffer.from(bytes), new Blob([bytes])]) {
      expect((await read(input as Uint8Array)).workbook.sheets[0]!.name).toBe("Mac");
    }
  });
});

describe("LibreOffice fixtures (written by LibreOffice 26.2, see libreoffice-version.txt)", () => {
  it("the openpyxl feature workbook as saved by LibreOffice reads to the same content", async () => {
    const opts = { dateZone: "utc", richText: "plain" } as const;
    const lo = await read(fixture("libreoffice-features.xlsx"), opts);
    const original = await read(fixture("openpyxl-features.xlsx"), opts);
    expect(lo.workbook.sheets.map((s) => [s.name, s.state])).toEqual([["Values", undefined], ["Styles", undefined], ["Hidden", "hidden"]]);
    const a = original.workbook.sheets[0]!;
    const b = lo.workbook.sheets[0]!;
    for (const [r, row] of a.rows.entries()) {
      for (const [c, cell] of (row ?? []).entries()) {
        if (!cell) continue;
        const got = b.rows[r]?.[c];
        if (cell.formula !== undefined) expect(got?.formula, `${r},${c}`).toBe(cell.formula);
        else expect(got?.value, `${r},${c}`).toEqual(cell.value);
      }
    }
    // LibreOffice stores recalculated results, writes TRUE as the formula TRUE(), and escapes '-' in date codes.
    expect(at(b, "G1")).toMatchObject({ type: "number", value: 84, formula: "B1*2" });
    expect(at(b, "A4")).toMatchObject({ type: "number", value: 45.5, formula: "SUM(B1:C1)" });
    expect(at(b, "D1")).toMatchObject({ type: "boolean", value: true, formula: "TRUE()" });
    expect(at(b, "E1")!.style!.numFmt).toBe("yyyy\\-mm\\-dd");
    const st = lo.workbook.sheets[1]!;
    expect(st.merges).toEqual(["C1:D2"]);
    expect(st.view?.freeze).toEqual({ rows: 1, cols: 1 });
    expect(st.colProps?.[2]?.hidden).toBe(true);
    expect(st.rowProps?.[1]?.height).toBe(39.75); // LibreOffice rounds 40 pt to its 1/100 mm grid
    expect(at(st, "A1")!.style).toMatchObject({
      font: { name: "Arial", size: 14, bold: true, italic: true, strike: true, color: { rgb: "FF336699" } },
      fill: { type: "pattern", pattern: "solid", fgColor: { rgb: "FFFFFF00" } },
      border: { left: { style: "thin" }, bottom: { style: "double" } },
      alignment: { horizontal: "center", vertical: "top", wrapText: true, rotation: 45 },
    });
    expect(at(st, "B1")!.style).toBe(at(st, "A1")!.style);
    expect(at(st, "A5")!.hyperlink).toEqual({ target: "https://example.com/path?q=1" });
    expect(lo.workbook.activeSheet).toBe(1);
    expect(lo.warnings.filter((w) => w.code !== "UNSUPPORTED_PART")).toEqual([]);
  });

  it("fill-down formulas, running sums and dates as saved by LibreOffice", async () => {
    const { workbook, warnings } = await read(fixture("libreoffice-filldown.xlsx"), { dateZone: "utc" });
    const s = workbook.sheets[0]!;
    expect(s.rows[0]!.map((c) => c!.value)).toEqual(["n", "double", "running", "date"]);
    for (let i = 1; i <= 50; i++) {
      const r = i + 1;
      expect(s.rows[i]![0]).toEqual({ type: "number", value: i });
      expect(s.rows[i]![1]).toEqual({ type: "number", value: i * 2, formula: `A${r}*2` });
      expect(s.rows[i]![2]).toEqual({ type: "number", value: (i * (i + 1)) / 2, formula: `SUM($A$2:A${r})` });
      expect(s.rows[i]![3]!.value).toEqual(new Date(Date.UTC(2024, 0, Math.min(i, 31))));
    }
    expect(s.rows[51]![0]).toEqual({ type: "number", value: 1275, formula: "SUM(A2:A51)" });
    expect(s.view?.freeze).toEqual({ rows: 1 });
    expect(warnings).toEqual([]);
  });
});

describe("cells (hand-built parts)", () => {
  it("shared, inline, rich and formula strings; booleans; errors; ISO dates", async () => {
    const s = await sheet0(
      await build({
        sharedStrings: '<si><t>zero</t></si><si><r><t>a</t></r><r><rPr><i/><sz val="9"/></rPr><t>b</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si><si><t>_x005F_x0041_</t></si>',
        sheets: [
          '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c>' +
            '<c r="D1" t="inlineStr"><is><t>inline</t></is></c><c r="E1" t="inlineStr"><is><r><rPr><b/></rPr><t>x</t></r></is></c>' +
            '<c r="F1" t="str"><f>"a"&amp;"b"</f><v>ab</v></c><c r="G1" t="b"><v>0</v></c><c r="H1" t="e"><v>#DIV/0!</v></c>' +
            '<c r="I1" t="d"><v>2024-01-15T10:30:00Z</v></c><c r="J1" t="e"><v>#SPILL!</v></c></row></sheetData>',
        ],
      }),
    );
    expect(s.rows[0]).toEqual([
      { type: "string", value: "zero" },
      { type: "richText", value: { richText: [{ text: "a" }, { text: "b", font: { italic: true, size: 9 } }] } },
      { type: "string", value: "_x0041_" },
      { type: "string", value: "inline" },
      { type: "richText", value: { richText: [{ text: "x", font: { bold: true } }] } },
      { type: "string", value: "ab", formula: '"a"&"b"' },
      { type: "boolean", value: false },
      { type: "error", value: { error: "#DIV/0!" } },
      { type: "date", value: new Date(Date.UTC(2024, 0, 15, 10, 30)) },
      { type: "error", value: { error: "#SPILL!" } },
    ]);
  });

  it("cells and rows without r are placed by position", async () => {
    const s = await sheet0(await build({ sheets: ["<sheetData><row><c><v>1</v></c><c><v>2</v></c></row><row/><row><c r=\"C3\"><v>3</v></c><c><v>4</v></c></row></sheetData>"] }));
    expect(s.rows[0]!.map((c) => c?.value)).toEqual([1, 2]);
    expect(s.rows[2]!.map((c) => c?.value)).toEqual([undefined, undefined, 3, 4]);
    expect(s.dimension).toBe("A1:D3");
  });

  it("shared formulas are expanded (Q6); unresolvable ones keep the cached value with a warning", async () => {
    const r = await read(
      await build({
        sheets: [
          '<sheetData><row r="1"><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2+$A$1</f><v>2</v></c></row>' +
            '<row r="2"><c r="B2"><f t="shared" si="0"/><v>4</v></c></row><row r="3"><c r="B3"><f t="shared" si="0"/><v>6</v></c></row>' +
            '<row r="4"><c r="C4"><f t="shared" si="9"/><v>7</v></c></row>' +
            '<row r="5"><c r="D5"><f t="array" ref="D5:D6">A1:A2*2</f><v>2</v></c><c r="E5"><f t="dataTable" ref="E5:E6" dt2D="0" dtr="0" r1="A1"/><v>9</v></c></row></sheetData>',
        ],
      }),
    );
    const s = r.workbook.sheets[0]!;
    expect([at(s, "B1"), at(s, "B2"), at(s, "B3")]).toEqual([
      { type: "number", value: 2, formula: "A1*2+$A$1" },
      { type: "number", value: 4, formula: "A2*2+$A$1" },
      { type: "number", value: 6, formula: "A3*2+$A$1" },
    ]);
    expect(at(s, "C4")).toEqual({ type: "number", value: 7 });
    expect(at(s, "D5")).toEqual({ type: "number", value: 2, formula: "A1:A2*2", arrayRef: "D5:D6" });
    expect(at(s, "E5")).toEqual({ type: "number", value: 9 });
    expect(r.warnings).toMatchObject([{ code: "SHARED_FORMULA_UNRESOLVED", ref: "C4", sheet: "Sheet1" }]);
  });

  it("date detection: built-in and custom formats, 1900 leap bug, invalid serials", async () => {
    const r = await read(
      await build({
        styles: numFmtStyles({ 164: "dd/mm/yyyy hh:mm", 165: "[h]:mm" }, [0, 14, 164, 165, 22]),
        sheets: ['<sheetData><row r="1"><c r="A1" s="1"><v>45306</v></c><c r="B1" s="2"><v>45306.5</v></c><c r="C1" s="3"><v>1.25</v></c><c r="D1" s="1"><v>60</v></c><c r="E1" s="1"><v>-3</v></c><c r="F1" s="4"><v>61.75</v></c></row></sheetData>'],
      }),
      { dateZone: "utc" },
    );
    const s = r.workbook.sheets[0]!;
    expect(s.rows[0]!.map((c) => c?.value)).toEqual([
      new Date(Date.UTC(2024, 0, 15)),
      new Date(Date.UTC(2024, 0, 15, 12)),
      1.25,
      60,
      -3,
      new Date(Date.UTC(1900, 2, 1, 18)),
    ]);
    expect(s.rows[0]!.map((c) => c?.style?.numFmt)).toEqual([14, "dd/mm/yyyy hh:mm", "[h]:mm", 14, 14, 22]);
    expect(codes(r.warnings)).toEqual(["INVALID_DATE_SERIAL", "INVALID_DATE_SERIAL"]);
  });

  it("damaged cells: bad shared string index, bad ref, out of bounds, duplicates", async () => {
    const r = await read(
      await build({
        sharedStrings: ["only"],
        sheets: [
          '<sheetData><row r="1"><c r="A1" t="s"><v>5</v></c><c r="1A"><v>1</v></c><c r="XFE1"><v>1</v></c><c r="B1"><v>1</v></c><c r="B1"><v>2</v></c></row>' +
            '<row r="1048577"><c r="A1048577"><v>1</v></c></row></sheetData>',
        ],
      }),
    );
    const s = r.workbook.sheets[0]!;
    expect(s.rows[0]).toEqual([undefined, { type: "number", value: 2 }]);
    expect(codes(r.warnings)).toEqual(["INVALID_SHARED_STRING", "INVALID_CELL_REF", "CELL_OUT_OF_BOUNDS", "DUPLICATE_CELL", "CELL_OUT_OF_BOUNDS", "CELL_OUT_OF_BOUNDS"]);
    expect(r.warnings[0]).toMatchObject({ ref: "A1", sheet: "Sheet1", part: "xl/worksheets/sheet1.xml" });
  });

  it("styled empty cells are kept; unstyled empty cells are holes", async () => {
    const s = await sheet0(
      await build({
        styles: numFmtStyles({}, [0, 10]),
        sheets: ['<sheetData><row r="1"><c r="A1"/><c r="B1" s="1"/><c r="C1" s="0"><v></v></c></row></sheetData>'],
      }),
    );
    expect(s.rows[0]).toEqual([undefined, { type: "empty", style: { numFmt: 10 } }]);
  });

  it("hyperlinks: external via relationships, internal, range reduced to its top-left cell", async () => {
    const r = await read(
      await build({
        sheets: ['<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData><hyperlinks><hyperlink ref="A1" r:id="rL1" tooltip="t"/><hyperlink ref="B2:C3" location="Sheet1!A1"/></hyperlinks>'],
        sheetRels: { 0: [["rL1", "hyperlink", "https://example.com/?a=1&b=2", true]] },
      }),
    );
    const s = r.workbook.sheets[0]!;
    expect(at(s, "A1")).toEqual({ type: "string", value: "x", hyperlink: { target: "https://example.com/?a=1&b=2", tooltip: "t" } });
    expect(at(s, "B2")).toEqual({ type: "empty", hyperlink: { location: "Sheet1!A1" } });
    expect(codes(r.warnings)).toEqual(["HYPERLINK_RANGE_REDUCED"]);
  });

  it("split panes are ignored with a warning; frozen panes read", async () => {
    const r = await read(
      await build({
        sheets: [
          '<sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0"><pane xSplit="2000" ySplit="1000" topLeftCell="C3"/></sheetView></sheetViews><sheetData/>',
          '<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="B5" sqref="B5:C6"/></sheetView></sheetViews><sheetData/>',
        ],
      }),
    );
    expect(r.workbook.sheets[0]!.view).toEqual({ rightToLeft: true, showGridLines: false });
    expect(r.workbook.sheets[1]!.view).toEqual({ freeze: { rows: 2 }, activeCell: "B5", selection: "B5:C6" });
    expect(codes(r.warnings)).toEqual(["SPLIT_PANE_IGNORED"]);
  });
});

describe("packages", () => {
  it("prefixed SpreadsheetML elements (x:) read like default-namespace ones", async () => {
    const s = await sheet0(
      await build({
        sheets: ['<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1"><x:v>7</x:v></x:c></x:row></x:sheetData></x:worksheet>'],
      }),
    );
    expect(at(s, "A1")).toEqual({ type: "number", value: 7 });
  });

  it("ISO/IEC 29500 Strict namespaces and relationship types (Q9)", async () => {
    const strictMain = "http://purl.oclc.org/ooxml/spreadsheetml/main";
    const strictRel = "http://purl.oclc.org/ooxml/officeDocument/relationships";
    const bytes = await writeZip([
      { name: "[Content_Types].xml", data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>' },
      { name: "_rels/.rels", data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${strictRel}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<workbook xmlns="${strictMain}" xmlns:r="${strictRel}" conformance="strict"><workbookPr dateCompatibility="false"/><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${strictRel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${strictRel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
      { name: "xl/sharedStrings.xml", data: `<sst xmlns="${strictMain}"><si><t>strict</t></si></sst>` },
      { name: "xl/worksheets/sheet1.xml", data: `<worksheet xmlns="${strictMain}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="d"><v>2024-01-15</v></c></row></sheetData></worksheet>` },
    ]);
    const s = await sheet0(bytes);
    expect(s.rows[0]).toEqual([
      { type: "string", value: "strict" },
      { type: "date", value: new Date(Date.UTC(2024, 0, 15)) },
    ]);
  });

  it("part names are matched case-insensitively and targets may be absolute", async () => {
    const bytes = await build({
      sheets: ['<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>'],
      override: {
        "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rS1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/XL/Worksheets/SHEET1.XML"/></Relationships>',
      },
    });
    expect(at(await sheet0(bytes), "A1")!.value).toBe(1);
  });

  it("UTF-16 encoded parts", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-16"?><worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ü16</t></is></c></row></sheetData></worksheet>`;
    const le = Buffer.from(xml, "utf16le");
    const bytes = await build({ sheets: ["<sheetData/>"], override: { "xl/worksheets/sheet1.xml": new Uint8Array([0xff, 0xfe, ...le]) } });
    expect(at(await sheet0(bytes), "A1")!.value).toBe("ü16");
  });

  it("optional parts: missing styles and broken theme are warnings; unsupported parts are reported once per kind", async () => {
    const r = await read(
      await build({
        sheets: ['<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>', "<sheetData/>"],
        workbookRels: [
          ["rX1", "styles", "missing-styles.xml"],
          ["rX2", "theme", "theme/theme1.xml"],
          ["rX3", "vbaProject", "vbaProject.bin"],
        ],
        parts: { "xl/theme/theme1.xml": "<a:theme><broken>" },
        sheetRels: { 0: [["rD", "drawing", "../drawings/drawing1.xml"]], 1: [["rD", "drawing", "../drawings/drawing2.xml"], ["rC", "comments", "../comments1.xml"]] },
      }),
    );
    expect(codes(r.warnings)).toEqual(["UNSUPPORTED_PART", "MISSING_PART", "BROKEN_OPTIONAL_PART", "UNSUPPORTED_PART", "UNSUPPORTED_PART"]);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/VBA macros.*drawings.*comments/);
    expect(at(r.workbook.sheets[0]!, "A1")!.value).toBe(1);
  });

  it("chart sheets are not listed as worksheets; names local to them are dropped", async () => {
    const bytes = await build({
      sheets: ["<sheetData/>"],
      workbookExtra: '<definedNames><definedName name="Local" localSheetId="1">Chart1!A1</definedName><definedName name="L0" localSheetId="0">Sheet1!$A$1</definedName></definedNames>',
      override: {
        "xl/workbook.xml": `<workbook ${NS}><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Sheet1" sheetId="1" r:id="rS1"/><sheet name="Chart1" sheetId="2" r:id="rC1"/></sheets><definedNames><definedName name="Local" localSheetId="1">Chart1!A1</definedName><definedName name="L0" localSheetId="0">Sheet1!$A$1</definedName></definedNames></workbook>`,
        "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rS1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet1.xml"/></Relationships>',
      },
    });
    const r = await read(bytes);
    expect(r.workbook.sheets.map((s) => s.name)).toEqual(["Sheet1"]);
    expect(r.workbook.definedNames).toEqual([{ name: "L0", ref: "Sheet1!$A$1", sheet: 0 }]);
    expect(codes(r.warnings)).toEqual(["UNSUPPORTED_PART"]);
    expect(await readSheetNames(bytes)).toEqual([{ name: "Sheet1", index: 0, state: "visible" }]);
  });
});

describe("formats that are rejected", () => {
  it("legacy .xls and encrypted workbooks (CFB): UNSUPPORTED_FORMAT 'cfb'", async () => {
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(504)]);
    expect(await errorOf(read(cfb))).toMatchObject({ name: "FormatError", code: "UNSUPPORTED_FORMAT", details: { format: "cfb" } });
    expect(await detectFormat(cfb)).toBe("cfb");
  });
  it(".ods: UNSUPPORTED_FORMAT 'ods'", async () => {
    const ods = await writeZip([{ name: "mimetype", data: "application/vnd.oasis.opendocument.spreadsheet", compression: "store" }, { name: "content.xml", data: "<x/>" }]);
    expect(await errorOf(read(ods))).toMatchObject({ code: "UNSUPPORTED_FORMAT", details: { format: "ods" } });
    expect(await detectFormat(ods)).toBe("ods");
  });
  it(".xlsb: UNSUPPORTED_FORMAT 'xlsb'", async () => {
    const xlsb = await writeZip([
      { name: "[Content_Types].xml", data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.bin" ContentType="application/vnd.ms-excel.sheet.binary.macroEnabled.main"/></Types>' },
      { name: "_rels/.rels", data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.bin"/></Relationships>' },
      { name: "xl/workbook.bin", data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(await errorOf(read(xlsb))).toMatchObject({ code: "UNSUPPORTED_FORMAT", details: { format: "xlsb" } });
    expect(await detectFormat(xlsb)).toBe("xlsb");
  });
  it("other input: UNSUPPORTED_FORMAT 'unknown'; a zip without a workbook: NOT_XLSX", async () => {
    expect(await errorOf(read(new TextEncoder().encode("a,b\n1,2")))).toMatchObject({ code: "UNSUPPORTED_FORMAT", details: { format: "unknown" } });
    const zip = await writeZip([{ name: "readme.txt", data: "hi" }]);
    expect(await errorOf(read(zip))).toMatchObject({ code: "NOT_XLSX" });
    expect(await detectFormat(zip)).toBe("zip");
    expect(await detectFormat(new Uint8Array([1, 2, 3]))).toBe("unknown");
  });
  it.each([
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml", false],
    ["xltx", "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml", false],
    ["xlsm", "application/vnd.ms-excel.sheet.macroEnabled.main+xml", true],
    ["xltm", "application/vnd.ms-excel.template.macroEnabled.main+xml", true],
  ] as const)("%s is detected and read; macro-enabled formats warn that macros are ignored", async (format, contentType, macros) => {
    const bytes = await build({
      sheets: ['<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>'],
      workbookRels: macros ? [["rV", "vbaProject", "vbaProject.bin"]] : [],
      parts: macros ? { "xl/vbaProject.bin": new Uint8Array([1, 2, 3]) } : {},
      override: {
        "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${contentType}"/></Types>`,
      },
    });
    expect(await detectFormat(bytes)).toBe(format);
    const r = await read(bytes);
    expect(at(r.workbook.sheets[0]!, "A1")!.value).toBe(1);
    expect(r.warnings.filter((w) => w.code === "UNSUPPORTED_PART").map((w) => w.message)).toEqual(macros ? [expect.stringMatching(/VBA macros are not read or run/)] : []);
  });
  it("a workbook part without a known content type is read as SpreadsheetML", async () => {
    const bytes = await build({ sheets: ['<sheetData><row r="1"><c r="A1"><v>5</v></c></row></sheetData>'], override: { "[Content_Types].xml": null } });
    expect(at(await sheet0(bytes), "A1")!.value).toBe(5);
  });
});

describe("parts the model does not represent", () => {
  it("are kept byte for byte with the internal retainParts option, and dropped otherwise", async () => {
    const drawing = new TextEncoder().encode("<xdr:wsDr/>");
    const vba = new Uint8Array([0xd0, 0xcf, 1, 2, 3]);
    const bytes = await build({
      sheets: ['<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><drawing r:id="rD"/>'],
      sheetRels: { 0: [["rD", "drawing", "../drawings/drawing1.xml"]] },
      parts: { "xl/drawings/drawing1.xml": drawing, "xl/vbaProject.bin": vba, "customXml/item1.xml": "<x/>" },
    });
    const r = await readImpl(bytes, {}, { retainParts: true });
    expect([...r.parts!.keys()].sort()).toEqual(["customXml/item1.xml", "xl/drawings/drawing1.xml", "xl/vbaProject.bin"]);
    expect(r.parts!.get("xl/drawings/drawing1.xml")).toEqual(drawing);
    expect(r.parts!.get("xl/vbaProject.bin")).toEqual(vba);
    expect(at(r.workbook.sheets[0]!, "A1")!.value).toBe(1);
    expect("parts" in (await read(bytes))).toBe(false);
  });
});

describe("hostile input (§8)", () => {
  it("DOCTYPE in any part: XML_DTD_FORBIDDEN, with the part name", async () => {
    const bytes = await build({ sheets: ['<?xml version="1.0"?><!DOCTYPE w [<!ENTITY x "y">]><worksheet><sheetData/></worksheet>'] });
    expect(await errorOf(read(bytes))).toMatchObject({ code: "XML_DTD_FORBIDDEN", details: { part: "xl/worksheets/sheet1.xml" } });
  });
  it("undefined entities: XML_MALFORMED", async () => {
    const bytes = await build({ sheets: ['<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;</t></is></c></row></sheetData>'] });
    expect(await errorOf(read(bytes))).toMatchObject({ code: "XML_MALFORMED" });
  });
  it("deep nesting: LIMIT_EXCEEDED maxXmlDepth", async () => {
    const bytes = await build({ sheets: [`<extLst>${"<ext>".repeat(200)}${"</ext>".repeat(200)}</extLst><sheetData/>`] });
    expect(await errorOf(read(bytes))).toMatchObject({ name: "LimitError", details: { limit: "maxXmlDepth", part: "xl/worksheets/sheet1.xml" } });
  });
  it("zip bomb: inflation stops at maxEntryBytes and maxTotalBytes, counted on inflated bytes", { timeout: 60_000 }, async () => {
    const big = `<sheetData>${"<row/>".repeat(2_000_000)}</sheetData>`; // 12 MB, compresses ~1000:1
    const bytes = await build({ sheets: [big] });
    expect(bytes.length).toBeLessThan(100_000);
    expect(await errorOf(read(bytes, { limits: { maxEntryBytes: 4_000_000 } }))).toMatchObject({ details: { limit: "maxEntryBytes" } });
    expect(await errorOf(read(bytes, { limits: { maxTotalBytes: 4_000_000 } }))).toMatchObject({ details: { limit: "maxTotalBytes" } });
    expect(await errorOf(read(bytes, { limits: { maxRatio: 100 } }))).toMatchObject({ details: { limit: "maxRatio" } });
    expect((await read(bytes)).workbook.sheets).toHaveLength(1);
  });
  it("maxInputBytes, maxEntries, maxCells, maxSharedStrings, maxWarnings", { timeout: 60_000 }, async () => {
    const bytes = await build({ sharedStrings: ["a", "b", "c"], sheets: ['<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c></row></sheetData>'] });
    expect(await errorOf(read(bytes, { limits: { maxInputBytes: 100 } }))).toMatchObject({ details: { limit: "maxInputBytes" } });
    expect(await errorOf(read(bytes, { limits: { maxEntries: 3 } }))).toMatchObject({ details: { limit: "maxEntries" } });
    expect(await errorOf(read(bytes, { limits: { maxCells: 2 } }))).toMatchObject({ details: { limit: "maxCells" } });
    expect(await errorOf(read(bytes, { limits: { maxSharedStrings: 2 } }))).toMatchObject({ details: { limit: "maxSharedStrings" } });
    const noisy = await build({ sheets: [`<sheetData><row r="1">${'<c r="1A"/>'.repeat(50)}</row></sheetData>`] });
    const seen: string[] = [];
    const r = await read(noisy, { limits: { maxWarnings: 10 }, onWarning: (w) => seen.push(w.code) });
    expect(r.warnings).toHaveLength(11);
    expect(r.warnings.at(-1)!.code).toBe("WARNINGS_TRUNCATED");
    expect(seen).toEqual(codes(r.warnings));
    await expect(read(bytes, { limits: { maxCells: -1 } })).rejects.toThrow(TypeError);
  });
  it("file-supplied names never become object keys (prototype pollution)", async () => {
    const bytes = await build({
      sheets: [{ name: "__proto__", xml: '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData>' }],
      workbookExtra: '<definedNames><definedName name="__proto__">1</definedName><definedName name="constructor">2</definedName></definedNames>',
      parts: {
        "docProps/custom.xml": '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="__proto__"><vt:lpwstr>polluted</vt:lpwstr></property></Properties>',
      },
      override: {
        "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>',
      },
    });
    const { workbook } = await read(bytes);
    expect(workbook.sheets[0]!.name).toBe("__proto__");
    expect(workbook.definedNames!.map((d) => d.name)).toEqual(["__proto__", "constructor"]);
    expect(workbook.properties!.custom).toEqual([{ name: "__proto__", value: "polluted" }]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(workbook)).toBe(Object.prototype);
  });
  it("relationship targets cannot escape the package: '../..' stays inside", async () => {
    const bytes = await build({
      sheets: ["<sheetData/>"],
      override: {
        "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rS1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../../../../xl/worksheets/sheet1.xml"/></Relationships>',
      },
    });
    expect((await read(bytes)).workbook.sheets[0]!.rows).toEqual([]);
  });
  it("corrupt zip and CRC mismatch are FormatErrors", async () => {
    const bytes = await build({ sheets: ['<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>'] });
    expect(await errorOf(read(bytes.subarray(0, bytes.length - 10)))).toMatchObject({ name: "FormatError" });
  });
  it("never throws anything but documented errors on mutated input", { timeout: 60_000 }, async () => {
    const base = fixture("openpyxl-1904.xlsx");
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 150; n++) {
      const b = base.slice();
      for (let k = 0; k < 4; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
      try {
        await read(b);
      } catch (e) {
        expect((e as { code?: string }).code, String(e)).toMatch(/^(ZIP_|XML_|UNSUPPORTED_FORMAT|NOT_XLSX|LIMIT_EXCEEDED)/);
      }
    }
  });
});

describe("async behaviour", () => {
  it("abort rejects with signal.reason", { timeout: 60_000 }, async () => {
    const ac = new AbortController();
    const reason = new Error("stop");
    ac.abort(reason);
    await expect(read(fixture("openpyxl-1904.xlsx"), { signal: ac.signal })).rejects.toBe(reason);
    const ac2 = new AbortController();
    const p = read(await build({ sheets: [`<sheetData>${'<row><c><v>1</v></c></row>'.repeat(300_000)}</sheetData>`] }), { signal: ac2.signal });
    setTimeout(() => ac2.abort(), 1);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
  it("progress ratios never decrease and end at 1", async () => {
    const ratios: number[] = [];
    await read(fixture("openpyxl-features.xlsx"), { onProgress: (p) => ratios.push(p.ratio) });
    expect(ratios.length).toBeGreaterThan(3);
    expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);
    expect(ratios.at(-1)).toBe(1);
  });
  it("DEFAULT_READ_LIMITS is frozen", () => {
    expect(Object.isFrozen(DEFAULT_READ_LIMITS)).toBe(true);
  });
});
