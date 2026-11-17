import { describe, expect, it } from "vitest";
import {
  cellText,
  isExcelError,
  sanitizeSheetName,
  toUint8Array,
  validateSheetName,
  type CellInput,
  type Sheet,
  type Workbook,
  type WriteOptions,
} from "../../src/index";
import { charsToFileWidth, pixelsToChars, textWidth } from "../../src/internal/write/sheet-features";
import { openZip } from "../../src/internal/zip/read";
import { featuresWorkbook } from "./golden-cases";

const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

async function parts(wb: Workbook, opts?: WriteOptions): Promise<Map<string, string>> {
  const zip = openZip(await toUint8Array(wb, opts));
  const out = new Map<string, string>();
  for (const e of zip.entries) out.set(e.name, dec(await zip.read(e)));
  return out;
}
const sheet1 = async (s: Partial<Sheet>, opts?: WriteOptions): Promise<string> =>
  (await parts({ sheets: [{ name: "S", rows: [], ...s }] }, opts)).get("xl/worksheets/sheet1.xml")!;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return isExcelError(e) ? e.code : String(e);
  }
  return "no error";
}
const one = (s: Partial<Sheet>, extra: Partial<Workbook> = {}, opts?: WriteOptions): Promise<string> =>
  codeOf(toUint8Array({ sheets: [{ name: "S", rows: [["x"]], ...s }], ...extra }, opts));

describe("width maths (ECMA-376 §18.3.1.13, MDW 7)", () => {
  it("8.43 characters is Excel's default file width 9.140625", () => {
    expect(charsToFileWidth(8.43)).toBe(9.140625);
    expect(charsToFileWidth(0)).toBe(0);
    expect(charsToFileWidth(255)).toBe(255.7109375);
  });
  it("pixels to characters", () => {
    expect(pixelsToChars(64)).toBe(8.43);
    expect(pixelsToChars(100)).toBe(13.57);
    expect(pixelsToChars(0)).toBe(0);
  });
  it("text width: widest line, East Asian and emoji count two", () => {
    expect([textWidth("abc"), textWidth("漢字"), textWidth("a😀"), textWidth("short\nmuch longer"), textWidth("")]).toEqual([3, 4, 3, 11, 0]);
  });
});

describe("worksheet XML", () => {
  it("places every element in CT_Worksheet order", async () => {
    const x = (await parts(featuresWorkbook())).get("xl/worksheets/sheet1.xml")!;
    const order = ["<sheetPr>", "<dimension", "<sheetViews>", "<sheetFormatPr", "<cols>", "<sheetData>", "<autoFilter", "<mergeCells", "<hyperlinks>", "<printOptions", "<pageMargins", "<pageSetup", "<headerFooter"];
    const at = order.map((tag) => x.indexOf(tag));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(x).toContain('<sheetPr><tabColor rgb="FFFF0000"/><pageSetUpPr fitToPage="1"/></sheetPr>');
  });

  it("columns: exact attributes, and identical neighbours share one <col>", async () => {
    const x = await sheet1({ colProps: [{ width: 10 }, { width: 10 }, { hidden: true }, { width: 0 }, undefined, { outlineLevel: 3, collapsed: true }] });
    expect(x).toContain(
      '<cols><col min="1" max="2" width="10.7109375" customWidth="1"/><col min="3" max="3" width="9.140625" hidden="1"/><col min="4" max="4" width="0" hidden="1" customWidth="1"/><col min="6" max="6" width="9.140625" outlineLevel="3" collapsed="1"/></cols>',
    );
    expect(x).toContain('outlineLevelCol="3"');
  });

  it("no <cols> without column properties or a sheet default style", async () => {
    expect(await sheet1({})).not.toContain("<cols>");
  });

  it("a sheet default style covers every column through XFD", async () => {
    expect(await sheet1({ defaultStyle: { font: { bold: true } } })).toContain('<cols><col min="1" max="16384" width="9.140625" style="1"/></cols>');
  });

  it("rows: style, height, hidden, outline; property-only rows are written", async () => {
    const x = await sheet1({ rows: [["a"]], rowProps: [{ style: { font: { italic: true } }, height: 22.5 }, undefined, { hidden: true, outlineLevel: 1 }] });
    expect(x).toContain('<row r="1" s="1" customFormat="1" ht="22.5" customHeight="1"><c r="A1" s="1" t="s"><v>0</v></c></row>');
    expect(x).toContain('<row r="3" hidden="1" outlineLevel="1"/>');
  });

  it("a zero row height hides the row, as Excel does", async () => {
    expect(await sheet1({ rowProps: [{ height: 0 }] })).toContain('<row r="1" ht="0" customHeight="1" hidden="1"/>');
  });

  it("freeze panes: rows, columns and both", async () => {
    expect(await sheet1({ view: { freeze: { rows: 1 } } })).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>');
    expect(await sheet1({ view: { freeze: { cols: 2 } } })).toContain('<pane xSplit="2" topLeftCell="C1" activePane="topRight" state="frozen"/>');
    expect(await sheet1({ view: { freeze: { rows: 3, cols: 1 } } })).toContain('<pane xSplit="1" ySplit="3" topLeftCell="B4" activePane="bottomRight" state="frozen"/>');
    expect(await sheet1({ view: { freeze: { rows: 0, cols: 0 } } })).not.toContain("<pane");
  });

  it("view flags and selection without panes", async () => {
    const x = await sheet1({ view: { rightToLeft: true, showGridLines: false, showRowColHeaders: false, zoom: 85, activeCell: "C3", selection: "C3:D4" } });
    expect(x).toContain('<sheetView tabSelected="1" showGridLines="0" showRowColHeaders="0" rightToLeft="1" zoomScale="85" zoomScaleNormal="85" workbookViewId="0"><selection activeCell="C3" sqref="C3:D4"/></sheetView>');
  });

  it("merges skip one-cell ranges and normalise reversed ranges", async () => {
    expect(await sheet1({ merges: ["C3:A1", "E5"] })).toContain('<mergeCells count="1"><mergeCell ref="A1:C3"/></mergeCells>');
  });

  it("page margins are always written; pageSetup and headerFooter only when set", async () => {
    const x = await sheet1({});
    expect(x).toContain('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
    expect(x).not.toContain("<pageSetup");
    expect(x).not.toContain("<headerFooter");
    const fit = await sheet1({ print: { fitTo: { height: 2 }, scale: 80 } });
    expect(fit).toContain('<pageSetup scale="80" fitToWidth="0" fitToHeight="2"/>');
    const hf = await sheet1({ print: { header: { even: "&L<even> & more" } } });
    expect(hf).toContain('<headerFooter differentOddEven="1"><evenHeader>&amp;L&lt;even&gt; &amp; more</evenHeader></headerFooter>');
  });

  it("default sizes and outline levels in sheetFormatPr", async () => {
    expect(await sheet1({})).toContain('<sheetFormatPr defaultRowHeight="15"/>');
    expect(await sheet1({ defaultColWidth: 12, defaultRowHeight: 20, rowProps: [{ outlineLevel: 4 }] })).toContain(
      '<sheetFormatPr defaultColWidth="12.7109375" defaultRowHeight="20" customHeight="1" outlineLevelRow="4"/>',
    );
  });
});

describe("hyperlinks", () => {
  const link = (hyperlink: unknown): CellInput => ({ value: "x", hyperlink } as CellInput);

  it("external targets go to the sheet's relationships, deduplicated", async () => {
    const p = await parts({ sheets: [{ name: "S", rows: [[link("https://a.example/?q=1&r=2"), link("https://a.example/?q=1&r=2"), link({ target: "mailto:x@example.com", tooltip: 'say "hi"' })]] }] });
    const x = p.get("xl/worksheets/sheet1.xml")!;
    expect(x).toContain('<hyperlinks><hyperlink ref="A1" r:id="rId1"/><hyperlink ref="B1" r:id="rId1"/><hyperlink ref="C1" r:id="rId2" tooltip="say &quot;hi&quot;"/></hyperlinks>');
    const rels = p.get("xl/worksheets/_rels/sheet1.xml.rels")!;
    expect(rels).toContain('Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://a.example/?q=1&amp;r=2" TargetMode="External"');
    expect(rels.match(/<Relationship /g)).toHaveLength(2);
  });

  it("internal locations need no relationship", async () => {
    const p = await parts({ sheets: [{ name: "S", rows: [[link({ location: "'Other sheet'!B2" })]] }] });
    expect(p.get("xl/worksheets/sheet1.xml")).toContain('<hyperlink ref="A1" location="&apos;Other sheet&apos;!B2"/>'.replace(/&apos;/g, "'"));
    expect(p.has("xl/worksheets/_rels/sheet1.xml.rels")).toBe(false);
  });

  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["data:text/html,<b>x</b>"],
    ["vbscript:msgbox"],
    ["file:///etc/passwd"],
    ["C:\\Windows\\system.ini"],
    ["relative/path.xlsx"],
    ["https://ok.example/\u0000bad"],
    [""],
  ])("rejects %j by default", async (target) => {
    expect(await codeOf(toUint8Array({ sheets: [{ name: "S", rows: [[link(target)]] }] }))).toBe("INVALID_HYPERLINK");
  });

  it("hyperlinkSchemes opts other schemes in (case-insensitive, trailing colon allowed)", async () => {
    const wb = (): Workbook => ({ sheets: [{ name: "S", rows: [[link("ftp://files.example/x"), link("FILE:///tmp/x")]] }] });
    expect(await codeOf(toUint8Array(wb(), { hyperlinkSchemes: ["https", "ftp:", "File"] }))).toBe("no error");
    expect(await codeOf(toUint8Array(wb(), { hyperlinkSchemes: ["https"] }))).toBe("INVALID_HYPERLINK");
    expect(await codeOf(toUint8Array(wb(), { hyperlinkSchemes: ["not a scheme"] }))).toBe("INVALID_HYPERLINK");
  });

  it("errors name the cell", async () => {
    const err = await toUint8Array({ sheets: [{ name: "S", rows: [[1, link("javascript:x")]] }] }).catch((e: unknown) => e);
    expect(isExcelError(err) && err.details).toMatchObject({ sheet: "S", ref: "B1" });
  });
});

describe("defined names", () => {
  it("writes user names and the built-ins the sheets imply", async () => {
    const wbx = (await parts(featuresWorkbook())).get("xl/workbook.xml")!;
    expect(wbx).toContain('<definedName name="TaxRate">&apos;Report&apos;!$B$2</definedName>'.replace(/&apos;/g, "'"));
    expect(wbx).toContain('<definedName name="LocalName" comment="local to Second" localSheetId="1" hidden="1">Second!$A$1</definedName>');
    expect(wbx).toContain(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Report'!$A$1:$D$10</definedName>`);
    expect(wbx).toContain(`<definedName name="_xlnm.Print_Area" localSheetId="0">'Report'!$A$1:$D$20</definedName>`);
    expect(wbx).toContain(`<definedName name="_xlnm.Print_Titles" localSheetId="0">'Report'!$A:$A,'Report'!$1:$1</definedName>`);
    expect(wbx.indexOf("<definedNames>")).toBeGreaterThan(wbx.indexOf("</sheets>"));
  });

  it("quotes sheet names with apostrophes in generated references", async () => {
    const wbx = (await parts({ sheets: [{ name: "It's", rows: [["a"]], autoFilter: "A1:B2" }] })).get("xl/workbook.xml")!;
    expect(wbx).toContain(`'It''s'!$A$1:$B$2`);
  });

  it.each([
    ["1abc", "starts with a digit"],
    ["has space", "contains a space"],
    ["A1", "is a cell reference"],
    ["xfd1048576", "is a cell reference"],
    ["R1C1", "is an R1C1 reference"],
    ["r", "is R on its own"],
    ["C", "is C on its own"],
    ["_xlnm.Print_Area", "is reserved"],
    ["x".repeat(256), "is too long"],
  ])("rejects %j (%s)", async (name) => {
    expect(await codeOf(toUint8Array({ definedNames: [{ name, ref: "S!$A$1" }], sheets: [{ name: "S", rows: [] }] }))).toBe("INVALID_DEFINED_NAME");
  });

  it("accepts names Excel accepts", async () => {
    const names = ["Tax_Rate", "_private", "\\back", "Total.2024", "Étage", "XFE1", "A1B", "RC1x"];
    expect(await codeOf(toUint8Array({ definedNames: names.map((name) => ({ name, ref: "S!$A$1" })), sheets: [{ name: "S", rows: [] }] }))).toBe("no error");
  });

  it("names are unique per scope, case-insensitively", async () => {
    const sheets = [{ name: "S", rows: [] }, { name: "T", rows: [] }];
    expect(await codeOf(toUint8Array({ sheets, definedNames: [{ name: "Rate", ref: "1" }, { name: "RATE", ref: "2" }] }))).toBe("INVALID_DEFINED_NAME");
    expect(await codeOf(toUint8Array({ sheets, definedNames: [{ name: "Rate", ref: "1" }, { name: "rate", ref: "2", sheet: 1 }] }))).toBe("no error");
    expect(await codeOf(toUint8Array({ sheets, definedNames: [{ name: "Rate", ref: "1", sheet: 2 }] }))).toBe("INVALID_DEFINED_NAME");
    expect(await codeOf(toUint8Array({ sheets, definedNames: [{ name: "Rate", ref: "=" }] }))).toBe("INVALID_DEFINED_NAME");
  });
});

describe("validation of sheet features", () => {
  it.each<[string, Partial<Sheet>, string]>([
    ["overlapping merges", { merges: ["A1:B2", "B2:C3"] }, "OVERLAPPING_MERGE"],
    ["bad merge ref", { merges: ["A1:"] }, "INVALID_REF"],
    ["bad autoFilter", { autoFilter: "nope" }, "INVALID_REF"],
    ["width too large", { colProps: [{ width: 256 }] }, "INVALID_SHEET_PROPERTY"],
    ["negative wch", { colProps: [{ width: { wch: -1 } }] }, "INVALID_SHEET_PROPERTY"],
    ["unknown width form", { colProps: [{ width: "wide" as unknown as number }] }, "INVALID_SHEET_PROPERTY"],
    ["too many colProps", { colProps: Array<undefined>(16_385) }, "OUT_OF_BOUNDS"],
    ["row height too large", { rowProps: [{ height: 410 }] }, "INVALID_SHEET_PROPERTY"],
    ["outline level 8", { rowProps: [{ outlineLevel: 8 }] }, "INVALID_SHEET_PROPERTY"],
    ["non-boolean hidden", { colProps: [{ hidden: 1 as unknown as boolean }] }, "INVALID_SHEET_PROPERTY"],
    ["zoom 5", { view: { zoom: 5 } }, "INVALID_SHEET_PROPERTY"],
    ["fractional freeze", { view: { freeze: { rows: 1.5 } } }, "INVALID_SHEET_PROPERTY"],
    ["bad activeCell", { view: { activeCell: "A0" } }, "INVALID_REF"],
    ["bad orientation", { print: { orientation: "sideways" as "portrait" } }, "INVALID_SHEET_PROPERTY"],
    ["scale 500", { print: { scale: 500 } }, "INVALID_SHEET_PROPERTY"],
    ["negative margin", { print: { margins: { left: -1 } } }, "INVALID_SHEET_PROPERTY"],
    ["bad print area", { print: { printArea: "A1:" } }, "INVALID_REF"],
    ["bad title rows", { print: { printTitles: { rows: "A:B" } } }, "INVALID_REF"],
    ["bad title cols", { print: { printTitles: { cols: "1:2" } } }, "INVALID_REF"],
    ["bad tab colour", { tabColor: "red" }, "INVALID_STYLE"],
    ["default row height", { defaultRowHeight: -1 }, "INVALID_SHEET_PROPERTY"],
    ["bad state", { state: "gone" as "hidden" }, "INVALID_SHEET_PROPERTY"],
  ])("%s → %s", async (_name, s, expected) => {
    expect(await one(s)).toBe(expected);
  });

  it("errors name the sheet and the property path", async () => {
    const err = await toUint8Array({ sheets: [{ name: "S", rows: [], colProps: [undefined, { width: 999 }] }] }).catch((e: unknown) => e);
    expect(isExcelError(err) && err.details).toMatchObject({ sheet: "S", path: "colProps[1].width", value: 999 });
  });
});

describe("cellText", () => {
  it("gives the plain text of every value kind", () => {
    expect(
      [
        "s",
        12.5,
        true,
        false,
        null,
        undefined,
        { error: "#N/A" },
        { richText: [{ text: "a" }, { text: "b" }] },
        { value: 3, style: {} },
        { formula: "1+1", value: 2 },
        { formula: "NOW()" },
      ].map((c) => cellText(c as CellInput)),
    ).toEqual(["s", "12.5", "TRUE", "FALSE", "", "", "#N/A", "ab", "3", "2", ""]);
    expect(cellText(new Date(2024, 0, 15))).toBe("2024-01-15");
    expect(cellText(new Date(Date.UTC(2024, 0, 15, 6, 30)), { dateZone: "utc" })).toBe("2024-01-15T06:30:00");
  });
});

describe("sheet names (§4.6)", () => {
  it("validateSheetName gives the reason", () => {
    expect(["ok", "", "x".repeat(32), "a/b", "'a", "History", "x".repeat(31)].map(validateSheetName)).toEqual([
      null,
      "empty",
      "too-long",
      "forbidden-char",
      "apostrophe",
      "reserved",
      null,
    ]);
  });

  it("rejects History in any case: Excel for Mac refuses it as a reserved word", () => {
    expect(["History", "history", "HISTORY", "hIsToRy"].map(validateSheetName)).toEqual(["reserved", "reserved", "reserved", "reserved"]);
    expect(["Histories", "History 2", " History"].map(validateSheetName)).toEqual([null, null, null]);
  });
  it("sanitizeSheetName always returns a valid name", () => {
    const cases = ["Q1/Q2 [draft]: *final?*", "'quoted'", "", "history", "x".repeat(40), `${"x".repeat(30)}😀`, "'''"];
    const out = cases.map(sanitizeSheetName);
    expect(out[0]).toBe("Q1_Q2 _draft__ _final__");
    expect(out[1]).toBe("quoted");
    expect([out[2], out[3], out[6]]).toEqual(["Sheet", "Sheet", "Sheet"]);
    expect(out[4]).toHaveLength(31);
    expect(out[5]).toBe(`${"x".repeat(30)}😀`); // 31 code points: already valid
    for (const name of out) expect(validateSheetName(name)).toBeNull();
  });

  it("counts code points, as Excel does: 30 x's and an emoji fit, 31 x's and an emoji don't", () => {
    expect(validateSheetName(`${"x".repeat(30)}😀`)).toBeNull(); // 31 code points, 32 UTF-16 units
    expect(validateSheetName(`${"x".repeat(31)}😀`)).toBe("too-long");
    expect(validateSheetName("😀".repeat(31))).toBeNull();
    expect(validateSheetName("😀".repeat(32))).toBe("too-long");
  });

  it("sanitizeSheetName cuts to 31 code points without splitting a surrogate pair", () => {
    expect(sanitizeSheetName(`${"x".repeat(31)}😀`)).toBe("x".repeat(31));
    expect(sanitizeSheetName(`${"x".repeat(30)}😀😀`)).toBe(`${"x".repeat(30)}😀`);
    expect(sanitizeSheetName("😀".repeat(40))).toBe("😀".repeat(31));
    expect(sanitizeSheetName(`${"x".repeat(30)}'y`)).toBe("x".repeat(30)); // the cut leaves a trailing apostrophe, which goes
    for (const name of ["History", "HISTORY", "history"]) expect(sanitizeSheetName(name)).toBe("Sheet");
  });

  it("the writer accepts a 31-code-point name with an emoji", async () => {
    const name = `${"x".repeat(30)}😀`;
    const bytes = await toUint8Array({ sheets: [{ name, rows: [["a"]] }] });
    expect(bytes.length).toBeGreaterThan(0);
    await expect(toUint8Array({ sheets: [{ name: `${name}x`, rows: [] }] })).rejects.toMatchObject({ code: "INVALID_SHEET_NAME" });
  });
});
