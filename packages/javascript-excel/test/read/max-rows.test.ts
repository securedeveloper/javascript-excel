// ReadOptions.maxRows (docs/api.md §5.2): later rows are skipped without
// tokenizing them, and the sheet features after <sheetData> are still read.
import { describe, expect, it } from "vitest";
import { read } from "../../src/read";
import { XmlTokenizer, type XmlControl, type XmlHandler } from "../../src/internal/read/xml-reader";
import { toUint8Array } from "../../src/write";
import { build, NS } from "./build";

const rows = (n: number) => Array.from({ length: n }, (_, r) => `<row r="${r + 1}"><c r="A${r + 1}"><v>${r}</v></c><c r="B${r + 1}" t="inlineStr"><is><t>s${r}</t></is></c></row>`).join("");

describe("ReadOptions.maxRows", () => {
  it("keeps rows below the limit and the features after sheetData", async () => {
    const bytes = await toUint8Array({
      sheets: [{
        name: "S",
        rows: Array.from({ length: 200 }, (_, r) => [r, `s${r}`]),
        merges: ["A1:B1"],
        view: { freeze: { rows: 1 } },
        autoFilter: "A1:B200",
        cells: undefined as never,
      }],
    } as never);
    const { workbook, warnings } = await read(bytes, { maxRows: 10 });
    const s = workbook.sheets[0]!;
    expect(s.rows.length).toBe(10);
    expect(s.rows[9]![0]!.value).toBe(9);
    expect(s.merges).toEqual(["A1:B1"]);
    expect(s.view?.freeze).toEqual({ rows: 1 });
    expect(s.autoFilter).toBe("A1:B200");
    expect(warnings.filter((w) => w.code === "ROWS_TRUNCATED")).toHaveLength(1);
  });

  it("reads everything when the sheet is shorter, with no warning", async () => {
    const bytes = await build({ sheets: [rows(5)] });
    const { workbook, warnings } = await read(bytes, { maxRows: 5 });
    expect(workbook.sheets[0]!.rows.length).toBe(5);
    expect(warnings).toEqual([]);
  });

  it("works with prefixed SpreadsheetML and cells without r", async () => {
    const xml = `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${Array.from({ length: 50 }, (_, r) => `<x:row><x:c><x:v>${r}</x:v></x:c></x:row>`).join("")}</x:sheetData><x:mergeCells count="1"><x:mergeCell ref="A1:A2"/></x:mergeCells></x:worksheet>`;
    const { workbook } = await read(await build({ sheets: [xml] }), { maxRows: 3 });
    expect(workbook.sheets[0]!.rows.map((r) => r![0]!.value)).toEqual([0, 1, 2]);
    expect(workbook.sheets[0]!.merges).toEqual(["A1:A2"]);
  });

  it("stops at a cell whose reference is past the limit inside an earlier row element", async () => {
    const xml = `<sheetData><row><c r="A1"><v>1</v></c><c r="A9"><v>9</v></c></row><row r="10"><c r="A10"><v>10</v></c></row></sheetData><mergeCells><mergeCell ref="B1:C1"/></mergeCells>`;
    const { workbook } = await read(await build({ sheets: [xml] }), { maxRows: 2 });
    expect(workbook.sheets[0]!.rows.length).toBe(1);
    expect(workbook.sheets[0]!.merges).toEqual(["B1:C1"]);
  });

  it("maxRows 0 reads no cells", async () => {
    const { workbook } = await read(await build({ sheets: [`<sheetData>${rows(3)}</sheetData>`] }), { maxRows: 0 });
    expect(workbook.sheets[0]!.rows.length).toBe(0);
  });

  it("rejects invalid values", async () => {
    const bytes = await build({ sheets: [rows(1)] });
    for (const v of [-1, 1.5, "3"]) await expect(read(bytes, { maxRows: v as never })).rejects.toThrow(TypeError);
  });

  it("a truncated sheet that never closes sheetData is malformed", async () => {
    const xml = `<?xml version="1.0"?><worksheet ${NS}><sheetData>${rows(5)}</worksheet>`;
    await expect(read(await build({ sheets: [xml] }), { maxRows: 2 })).rejects.toMatchObject({ code: "XML_MALFORMED" });
  });
});

describe("XmlTokenizer.skipToEndOf", () => {
  /** Records events; skips the content of <skip> on its first child. */
  function run(xml: string, chunk: number): string[] {
    const events: string[] = [];
    let control!: XmlControl;
    const h: XmlHandler = {
      attach: (c) => (control = c),
      open: (name, _a, empty) => {
        events.push(`<${name}${empty ? "/" : ""}>`);
        if (name === "x" && !empty) control.skipToEndOf(control.depth() - 1);
      },
      close: (name) => events.push(`</${name}>`),
      text: (t) => events.push(t),
    };
    const tok = new XmlTokenizer(h, 64);
    for (let i = 0; i < xml.length; i += chunk) tok.feed(xml.slice(i, i + chunk));
    tok.end();
    return events;
  }

  it("jumps to the end tag across any chunking, without matching longer names", () => {
    const xml = `<r><skip><x>1</x><skipX/><y a="</skip"/>tail</skip><after>ok</after></r>`;
    // The '</skip' inside the attribute is part of the skipped text: skipping is a plain search, which is why
    // the reader only uses it for <sheetData>, whose content can't contain '<' outside markup.
    // Text may arrive in pieces when chunks are tiny, so compare the joined stream.
    const want = "<r><skip><x></skip><after>ok</after></r>";
    for (const chunk of [1, 2, 3, 7, 1000]) {
      const got = run(`<r><skip><x>1</x><skipX/>tail</skip><after>ok</after></r>`, chunk);
      expect(got.join(""), `chunk ${chunk}`).toBe(want);
    }
    expect(xml).toContain("</skip"); // documents the limitation above
  });
});
