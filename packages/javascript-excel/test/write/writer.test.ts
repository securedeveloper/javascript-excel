/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { isExcelError, toBlob, toUint8Array, XLSX_MIME, type CellInput, type Progress, type Style, type Workbook } from "../../src/index";
import { openZip } from "../../src/internal/zip/read";

const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const FIXED = new Date(Date.UTC(2024, 0, 15, 10, 30, 0));

async function parts(wb: Workbook, opts?: Parameters<typeof toUint8Array>[1]): Promise<Map<string, string>> {
  const zip = openZip(await toUint8Array(wb, opts));
  const out = new Map<string, string>();
  for (const e of zip.entries) out.set(e.name, dec(await zip.read(e)));
  return out;
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return isExcelError(e) ? e.code : e;
  }
  return "no error";
}

const one = (rows: CellInput[][], extra: Partial<Workbook> = {}): Workbook => ({ sheets: [{ name: "S", rows }], ...extra });

describe("package structure", () => {
  it("writes the minimal OOXML parts, content types first", async () => {
    const p = await parts(one([["a", 1]]));
    expect([...p.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "docProps/app.xml",
      "xl/worksheets/sheet1.xml",
      "xl/sharedStrings.xml",
      "xl/styles.xml",
      "xl/theme/theme1.xml",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
    ]);
    const ct = p.get("[Content_Types].xml")!;
    for (const part of ["/xl/workbook.xml", "/xl/worksheets/sheet1.xml", "/xl/styles.xml", "/xl/sharedStrings.xml", "/xl/theme/theme1.xml", "/docProps/core.xml", "/docProps/app.xml"]) {
      expect(ct).toContain(`PartName="${part}"`);
    }
    expect(p.get("docProps/app.xml")).toContain("<Application>javascript-excel</Application>");
  });

  it("omits sharedStrings with inline strings, and adds custom.xml only when needed", async () => {
    const p = await parts(one([["a"]]), { sharedStrings: false });
    expect(p.has("xl/sharedStrings.xml")).toBe(false);
    expect(p.get("[Content_Types].xml")).not.toContain("sharedStrings");
    expect(p.get("xl/_rels/workbook.xml.rels")).not.toContain("sharedStrings");
    expect(p.get("xl/worksheets/sheet1.xml")).toContain('t="inlineStr"><is><t>a</t></is>');
    const withCustom = await parts(one([["a"]], { properties: { custom: [{ name: "k", value: "v" }] } }));
    expect(withCustom.get("docProps/custom.xml")).toContain('fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="k"');
    expect(withCustom.get("_rels/.rels")).toContain("custom-properties");
  });

  it("styles.xml reserves fills 0/1 and the default xf, and lists numFmts first", async () => {
    const s = (await parts(one([[{ value: 1, style: { numFmt: "0.000", fill: "FF0000" } }]]))).get("xl/styles.xml")!;
    expect(s.indexOf("<numFmts")).toBeLessThan(s.indexOf("<fonts"));
    expect(s).toContain('<numFmt numFmtId="164" formatCode="0.000"/>');
    expect(s).toMatch(/<fills count="3"><fill><patternFill patternType="none"\/><\/fill><fill><patternFill patternType="gray125"\/><\/fill>/);
    expect(s).toContain('<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    expect(s).toContain('<cellStyle name="Normal" xfId="0" builtinId="0"/>');
  });

  it("sheet XML: dimension, cell types, styled empty cells, active tab", async () => {
    const x = (await parts({ activeSheet: 1, sheets: [{ name: "A", rows: [] }, { name: "B", rows: [undefined, [undefined, "s", 2, true, { error: "#N/A" }, { value: null, style: { font: { bold: true } } }]] }] })).get("xl/worksheets/sheet2.xml")!;
    expect(x).toContain('<dimension ref="B2:F2"/>');
    expect(x).toContain('tabSelected="1"');
    expect(x).toContain('<row r="2"><c r="B2" t="s"><v>0</v></c><c r="C2"><v>2</v></c><c r="D2" t="b"><v>1</v></c><c r="E2" t="e"><v>#N/A</v></c><c r="F2" s="1"/></row>');
  });

  it("an empty sheet has dimension A1", async () => {
    const x = (await parts(one([]))).get("xl/worksheets/sheet1.xml")!;
    expect(x).toContain('<dimension ref="A1"/>');
    expect(x).toContain("<sheetData></sheetData>");
  });

  it("1904 dates: 1904-01-01 is serial 0", async () => {
    const p = await parts(one([[new Date(1904, 0, 1)]], { date1904: true }));
    expect(p.get("xl/workbook.xml")).toContain('<workbookPr date1904="1"/>');
    expect(p.get("xl/worksheets/sheet1.xml")).toContain('<c r="A1" s="1"><v>0</v></c>');
  });

  it("formulas: leading = stripped, cached value types, array formulas, fullCalcOnLoad", async () => {
    const p = await parts(one([[{ formula: "=1+1", value: 2 }, { formula: "A1&\"x\"", value: "2x" }, { formula: "TRUE()", value: true }, { formula: "1/0", value: { error: "#DIV/0!" } }, { formula: "A1*2", arrayRef: "E1:E2", value: 4 }]]));
    const x = p.get("xl/worksheets/sheet1.xml")!;
    expect(x).toContain('<c r="A1"><f>1+1</f><v>2</v></c>');
    expect(x).toContain('<c r="B1" t="str"><f>A1&amp;"x"</f><v>2x</v></c>');
    expect(x).toContain('<c r="C1" t="b"><f>TRUE()</f><v>1</v></c>');
    expect(x).toContain('<c r="D1" t="e"><f>1/0</f><v>#DIV/0!</v></c>');
    expect(x).toContain('<c r="E1"><f t="array" ref="E1:E2">A1*2</f><v>4</v></c>');
    expect(p.get("xl/workbook.xml")).not.toContain("calcPr");
    const missing = await parts(one([[{ formula: "NOW()" }]]));
    expect(missing.get("xl/workbook.xml")).toContain('<calcPr fullCalcOnLoad="1"/>');
    const off = await parts(one([[{ formula: "NOW()" }]], { calc: { fullCalcOnLoad: false } }));
    expect(off.get("xl/workbook.xml")).not.toContain("calcPr");
    const forced = await parts(one([[1]], { calc: { fullCalcOnLoad: true } }));
    expect(forced.get("xl/workbook.xml")).toContain('<calcPr fullCalcOnLoad="1"/>');
  });

  it("deduplicates shared strings and counts references", async () => {
    const sst = (await parts(one([["a", "b", "a"], ["a", { richText: [{ text: "a" }] }]]))).get("xl/sharedStrings.xml")!;
    expect(sst).toContain('count="5" uniqueCount="3"');
  });

  it("a different default font drops the theme scheme and family", async () => {
    const s = (await parts(one([[1]], { defaultFont: { name: "Arial" } }))).get("xl/styles.xml")!;
    expect(s).toContain('<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Arial"/></font></fonts>');
  });
});

describe("determinism, progress, abort, Blob", () => {
  const wb = (): Workbook => ({ properties: { created: FIXED, modified: FIXED }, sheets: [{ name: "S", rows: [["x", 1, new Date(2024, 0, 1)]] }] });

  it("same model and dates give identical bytes", async () => {
    const a = await toUint8Array(wb());
    const b = await toUint8Array(wb());
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    expect(openZip(a).entries[0]!.modified.toISOString()).toBe("2024-01-15T10:30:00.000Z");
  });

  it("store compression writes method 0 entries", async () => {
    const zip = openZip(await toUint8Array(wb(), { compression: "store" }));
    expect(zip.entries.every((e) => e.method === 0)).toBe(true);
  });

  it("reports non-decreasing progress ending at 1", async () => {
    const seen: Progress[] = [];
    const rows = Array.from({ length: 5000 }, (_, i) => [i]);
    await toUint8Array({ sheets: [{ name: "A", rows }, { name: "B", rows }] }, { onProgress: (p) => seen.push(p) });
    const ratios = seen.map((p) => p.ratio);
    expect(ratios[0]).toBe(0);
    expect(ratios.at(-1)).toBe(1);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]!).toBeGreaterThanOrEqual(ratios[i - 1]!);
    expect(new Set(seen.map((p) => p.phase))).toEqual(new Set(["prepare", "sheets", "styles", "zip"]));
    expect(seen.some((p) => p.phase === "sheets" && p.sheet === "B")).toBe(true);
  });

  it("rejects with signal.reason when aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("stop"));
    await expect(toUint8Array(wb(), { signal: ac.signal })).rejects.toThrow("stop");
    const later = new AbortController();
    const rows = Array.from({ length: 50_000 }, (_, i) => [`row ${i}`, i]);
    const p = toUint8Array({ sheets: [{ name: "S", rows }] }, { signal: later.signal, onProgress: (pr) => pr.phase === "sheets" && pr.ratio > 0.2 && later.abort(new Error("mid-way")) });
    await expect(p).rejects.toThrow("mid-way");
  });

  it("toBlob returns a Blob with the xlsx MIME type", async () => {
    const blob = await toBlob(wb());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(XLSX_MIME);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(await toUint8Array(wb()));
  });
});

describe("validation", () => {
  const cases: Array<[string, Workbook, string]> = [
    ["no sheets", { sheets: [] }, "NO_SHEETS"],
    ["empty name", { sheets: [{ name: "", rows: [] }] }, "INVALID_SHEET_NAME"],
    ["long name", { sheets: [{ name: "x".repeat(32), rows: [] }] }, "INVALID_SHEET_NAME"],
    ...["\\", "/", "?", "*", "[", "]", ":"].map((ch): [string, Workbook, string] => [`name with ${ch}`, { sheets: [{ name: `a${ch}b`, rows: [] }] }, "INVALID_SHEET_NAME"]),
    ["leading apostrophe", { sheets: [{ name: "'a", rows: [] }] }, "INVALID_SHEET_NAME"],
    ["reserved History", { sheets: [{ name: "history", rows: [] }] }, "INVALID_SHEET_NAME"],
    ["duplicate names, case-insensitive", { sheets: [{ name: "Data", rows: [] }, { name: "DATA", rows: [] }] }, "DUPLICATE_SHEET_NAME"],
    ["active sheet out of range", { activeSheet: 1, sheets: [{ name: "a", rows: [] }] }, "INVALID_ACTIVE_SHEET"],
    ["active sheet hidden", { sheets: [{ name: "a", state: "hidden", rows: [] }, { name: "b", rows: [] }] }, "INVALID_ACTIVE_SHEET"],
    ["NaN", one([[Number.NaN]]), "INVALID_NUMBER"],
    ["Infinity", one([[Number.POSITIVE_INFINITY]]), "INVALID_NUMBER"],
    ["invalid Date", one([[new Date(Number.NaN)]]), "INVALID_DATE"],
    ["date before 1900", one([[new Date(1899, 0, 1)]]), "INVALID_DATE"],
    ["string too long", one([["x".repeat(32_768)]]), "STRING_TOO_LONG"],
    ["rich text too long", one([[{ richText: [{ text: "x".repeat(20_000) }, { text: "y".repeat(20_000) }] }]]), "STRING_TOO_LONG"],
    ["unknown error code", one([[{ error: "#SPILL!" } as unknown as CellInput]]), "INVALID_CELL"],
    ["type mismatch", one([[{ value: 1, type: "string" }]]), "INVALID_CELL"],
    ["empty formula", one([[{ formula: "=" }]]), "INVALID_CELL"],
    ["rich text as cached value", one([[{ formula: "A1", value: { richText: [{ text: "a" }] } }]]), "INVALID_CELL"],
    ["arrayRef without formula", one([[{ value: 1, arrayRef: "A1:A2" }]]), "INVALID_CELL"],
    ["bad arrayRef", one([[{ formula: "1", arrayRef: "nope" }]]), "INVALID_REF"],
    ["column beyond XFD", one([Object.assign([], { 16384: 1 })]), "OUT_OF_BOUNDS"],
    ["bad colour", one([[{ value: 1, style: { font: { color: "red" } } }]]), "INVALID_STYLE"],
    ["bad theme index", one([[{ value: 1, style: { font: { color: { theme: 12 } } } }]]), "INVALID_STYLE"],
    ["bad tint", one([[{ value: 1, style: { font: { color: { theme: 1, tint: 2 } } } }]]), "INVALID_STYLE"],
    ["bad border style", one([[{ value: 1, style: { border: { top: { style: "dash" } } } } as unknown as CellInput]]), "INVALID_STYLE"],
    ["bad pattern", one([[{ value: 1, style: { fill: { pattern: "checker" } } } as unknown as CellInput]]), "INVALID_STYLE"],
    ["one gradient stop", one([[{ value: 1, style: { fill: { type: "gradient", gradient: "linear", stops: [{ position: 0, color: "FFFFFF" }] } } }]]), "INVALID_STYLE"],
    ["rotation out of range", one([[{ value: 1, style: { alignment: { rotation: 91 } } }]]), "INVALID_STYLE"],
    ["fractional rotation", one([[{ value: 1, style: { alignment: { rotation: 12.5 } } }]]), "INVALID_STYLE"],
    ["negative indent", one([[{ value: 1, style: { alignment: { indent: -1 } } }]]), "INVALID_STYLE"],
    ["font size 0", one([[{ value: 1, style: { font: { size: 0 } } }]]), "INVALID_STYLE"],
    ["non-boolean bold", one([[{ value: 1, style: { font: { bold: "yes" } } } as unknown as CellInput]]), "INVALID_STYLE"],
    ["numFmt id out of range", one([[{ value: 1, style: { numFmt: 164 } }]]), "INVALID_NUMFMT"],
    ["empty numFmt", one([[{ value: 1, style: { numFmt: "" } }]]), "INVALID_NUMFMT"],
    ["invalid created date", one([[1]], { properties: { created: new Date(Number.NaN) } }), "INVALID_PROPERTY"],
    ["duplicate custom property", one([[1]], { properties: { custom: [{ name: "a", value: 1 }, { name: "A", value: 2 }] } }), "INVALID_PROPERTY"],
  ];
  it.each(cases)("%s → %s", async (_name, wb, expected) => {
    expect(await codeOf(toUint8Array(wb))).toBe(expected);
  });

  it("errors name the sheet and cell", async () => {
    const err = await toUint8Array(one([[1, { value: 1, style: { font: { color: "bad" } } }]])).catch((e: unknown) => e);
    expect(isExcelError(err) && err.details).toMatchObject({ sheet: "S", ref: "B1", path: "font.color" });
  });

  it("TOO_MANY_STYLES past 64,000 distinct cell formats", async () => {
    const rows: CellInput[][] = [];
    for (let i = 0; i < 64_001; i++) rows.push([{ value: i, style: { numFmt: `0.${"0".repeat(i % 30)};"${i}"` } as Style }]);
    expect(await codeOf(toUint8Array(one(rows)))).toBe("TOO_MANY_STYLES");
  });

  it("explicit undefined fields are treated as absent", async () => {
    const p = await parts(one([[{ value: 1, style: { font: { bold: undefined }, fill: undefined }, formula: undefined }]], { activeSheet: undefined, date1904: undefined }));
    // Every field is undefined, so the style resolves to the default xf: no s attribute.
    expect(p.get("xl/worksheets/sheet1.xml")).toContain('<c r="A1"><v>1</v></c>');
    expect(p.get("xl/workbook.xml")).toContain("<workbookPr/>");
  });
});
