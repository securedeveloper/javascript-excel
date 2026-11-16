// JSE-20: with ReadOptions.maxRows, shared strings are decoded after the sheets
// and only up to the highest index the read rows use. Results must match the
// full read for the rows that are read.
import { describe, expect, it } from "vitest";
import { read } from "../../src/read";
import { readImpl } from "../../src/internal/read/reader";
import { toUint8Array } from "../../src/write";
import { build } from "./build";

const rowXml = (r: number, cells: string) => `<row r="${r}">${cells}</row>`;
const s = (ref: string, idx: number) => `<c r="${ref}" t="s"><v>${idx}</v></c>`;

describe("lazy shared strings (maxRows)", () => {
  it("matches the full read for the rows read, across sheets, with and without styles", async () => {
    const rows = (tag: string) => Array.from({ length: 300 }, (_, r) => [`${tag}${r}`, r, `${tag}${r}-b`, r % 2 === 0, new Date(Date.UTC(2024, 0, 1 + (r % 28)))]);
    const bytes = await toUint8Array({ sheets: [{ name: "A", rows: rows("a") }, { name: "B", rows: rows("b"), merges: ["A1:B1"] }] });
    for (const styles of [true, false]) {
      const full = await read(bytes, { styles });
      const capped = await read(bytes, { styles, maxRows: 40 });
      for (const i of [0, 1]) {
        expect(capped.workbook.sheets[i]!.rows).toEqual(full.workbook.sheets[i]!.rows.slice(0, 40));
      }
      expect(capped.workbook.sheets[1]!.merges).toEqual(["A1:B1"]);
      expect(capped.warnings.map((w) => w.code)).toEqual(["ROWS_TRUNCATED", "ROWS_TRUNCATED"]);
    }
  });

  it("decodes up to the highest index used, wherever it appears", async () => {
    const strings = Array.from({ length: 500 }, (_, i) => `str${i}`);
    const xml = `<sheetData>${rowXml(1, s("A1", 450) + s("B1", 3))}${rowXml(2, s("A2", 0))}${rowXml(3, s("A3", 499))}</sheetData>`;
    const bytes = await build({ sheets: [xml], sharedStrings: strings });
    const { workbook } = await read(bytes, { maxRows: 2 });
    expect(workbook.sheets[0]!.rows.map((r) => r!.map((c) => c?.value))).toEqual([["str450", "str3"], ["str0"]]);
  });

  it("rich text runs and plain mode, as on the full path", async () => {
    const sst = `<si><r><rPr><b/></rPr><t>Bold</t></r><r><t xml:space="preserve"> text</t></r></si><si><t>plain</t></si>`;
    const xml = `<sheetData>${rowXml(1, s("A1", 0) + s("B1", 1))}${rowXml(2, s("A2", 1))}</sheetData>`;
    const bytes = await build({ sheets: [xml], sharedStrings: sst });
    for (const richText of ["runs", "plain"] as const) {
      const full = await read(bytes, { richText });
      const capped = await read(bytes, { richText, maxRows: 1 });
      expect(capped.workbook.sheets[0]!.rows[0]).toEqual(full.workbook.sheets[0]!.rows[0]);
    }
    expect((await read(bytes, { maxRows: 1 })).workbook.sheets[0]!.rows[0]![0]!.type).toBe("richText");
  });

  it("an index past the table is reported and the cell dropped, as on the full path", async () => {
    const xml = `<sheetData>${rowXml(1, s("A1", 0) + s("B1", 7) + `<c r="C1" t="s"><f>X()</f><v>9</v></c>`)}${rowXml(2, s("A2", 0))}</sheetData>`;
    const bytes = await build({ sheets: [xml], sharedStrings: ["only"] });
    const full = await read(bytes);
    const capped = await read(bytes, { maxRows: 1 });
    expect(capped.workbook.sheets[0]!.rows[0]).toEqual(full.workbook.sheets[0]!.rows[0]);
    expect(capped.workbook.sheets[0]!.rows[0]![2]).toEqual({ type: "empty", formula: "X()" });
    const codes = (w: { code: string }[]) => w.filter((x) => x.code === "INVALID_SHARED_STRING").map((x) => (x as { ref?: string }).ref);
    expect(codes(capped.warnings)).toEqual(codes(full.warnings));
  });

  it("a missing shared strings part leaves the cells empty, with the same warnings", async () => {
    const xml = `<sheetData>${rowXml(1, s("A1", 0))}${rowXml(2, s("A2", 1))}</sheetData>`;
    const bytes = await build({ sheets: [xml], sharedStrings: ["a", "b"], override: { "xl/sharedStrings.xml": null } });
    const capped = await read(bytes, { maxRows: 1 });
    expect(capped.workbook.sheets[0]!.rows[0]?.[0]).toBeUndefined();
    expect(capped.warnings.map((w) => w.code)).toEqual(["MISSING_PART", "ROWS_TRUNCATED", "INVALID_SHARED_STRING"]);
  });

  it("maxRows 0 never decodes the table, and it still isn't an unparsed part", async () => {
    const bytes = await build({ sheets: [`<sheetData>${rowXml(1, s("A1", 0))}</sheetData>`], sharedStrings: ["a"] });
    const r = await readImpl(bytes, { maxRows: 0 }, { retainParts: true });
    expect(r.workbook.sheets[0]!.rows).toEqual([]);
    expect([...r.parts!.keys()]).not.toContain("xl/sharedStrings.xml");
  });

  it("a table bigger than maxSharedStrings only fails when the read needs that far", async () => {
    const strings = Array.from({ length: 50 }, (_, i) => `s${i}`);
    const xml = `<sheetData>${rowXml(1, s("A1", 1))}${rowXml(2, s("A2", 49))}</sheetData>`;
    const bytes = await build({ sheets: [xml], sharedStrings: strings });
    await expect(read(bytes, { limits: { maxSharedStrings: 10 } })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await read(bytes, { maxRows: 1, limits: { maxSharedStrings: 10 } })).workbook.sheets[0]!.rows[0]![0]!.value).toBe("s1");
    await expect(read(bytes, { maxRows: 2, limits: { maxSharedStrings: 10 } })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("a later duplicate of a cell keeps its own value", async () => {
    const xml = `<sheetData>${rowXml(1, s("A1", 5) + s("A1", 0))}${rowXml(2, s("A2", 0))}</sheetData>`;
    const bytes = await build({ sheets: [xml], sharedStrings: ["kept"] });
    const capped = await read(bytes, { maxRows: 1 });
    expect(capped.workbook.sheets[0]!.rows[0]![0]!.value).toBe("kept");
  });
});
