/// <reference types="node" />
// Golden-file tests: every workbook written here is opened by an independent
// reader, openpyxl, and its values and styles are checked.
//
// Python comes from $JSE_PYTHON (default python3) and needs openpyxl. In CI the
// suite fails when openpyxl is missing; locally it is skipped.
// Set JSE_GOLDEN_DIR to keep the written files (e.g. to open them in Excel).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { LONG_TEXT, valuesWorkbook } from "./golden-cases";
import { toUint8Array, type BorderStyle, type PatternType, type Style, type Workbook, type WriteOptions } from "../../src/index";

const PY = process.env["JSE_PYTHON"] ?? "python3";
const script = fileURLToPath(new URL("../interop/xlsx_dump.py", import.meta.url));
const hasOpenpyxl = spawnSync(PY, ["-I", "-c", "import openpyxl"], { stdio: "ignore" }).status === 0;
if (process.env["CI"] && !hasOpenpyxl) throw new Error(`CI must provide openpyxl (python: ${PY}) for the golden-file tests`);

const keep = process.env["JSE_GOLDEN_DIR"];
const dir = keep ?? mkdtempSync(join(tmpdir(), "jse-golden-"));
mkdirSync(dir, { recursive: true });
afterAll(() => {
  if (!keep) rmSync(dir, { recursive: true, force: true });
});

interface Color { rgb?: string; theme?: number; tint?: number; indexed?: number; auto?: boolean }
interface DumpCell {
  value: unknown;
  cached: unknown;
  dataType: string;
  numFmt: string;
  font: { name: string; size: number; bold: boolean; italic: boolean; underline: string | null; strike: boolean; vertAlign: string | null; color: Color | null; family: number | null; scheme: string | null; [k: string]: unknown };
  fill: { pattern?: string | null; fgColor?: Color; bgColor?: Color; gradient?: string; degree?: number; stops?: Array<{ position: number; color: Color }>; [k: string]: unknown };
  border: Record<string, { style: string; color: Color | null } | null | boolean>;
  alignment: { horizontal: string | null; vertical: string | null; textRotation: number; wrapText: boolean; shrinkToFit: boolean; indent: number; readingOrder: number; justifyLastLine: boolean };
  protection: { locked: boolean; hidden: boolean };
}
interface Dump {
  sheets: Array<{ title: string; state: string }>;
  active: number;
  epoch1904: boolean;
  properties: Record<string, string | null>;
  custom: Array<{ name: string; value: unknown }>;
  cellXfCount: number;
  cells: Record<string, Record<string, DumpCell>>;
}

async function golden(name: string, wb: Workbook, options?: WriteOptions, valuesOnly = false): Promise<Dump> {
  const file = join(dir, `${name}.xlsx`);
  writeFileSync(file, await toUint8Array(wb, options));
  const args = ["-I", script, file, ...(valuesOnly ? ["values"] : [])];
  return JSON.parse(execFileSync(PY, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })) as Dump;
}

const iso = (d: Date): string => {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  const base = `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return d.getMilliseconds() ? `${base}.${p(d.getMilliseconds(), 3)}000` : base;
};

describe.skipIf(!hasOpenpyxl)("golden files (openpyxl)", () => {
  // ------------------------------------------------------------ values
  describe("cell values", () => {
    const long = LONG_TEXT;
    const values = valuesWorkbook;

    for (const sharedStrings of [true, false]) {
      it(`round-trips every value type (${sharedStrings ? "shared" : "inline"} strings)`, async () => {
        const d = await golden(`values-${sharedStrings ? "sst" : "inline"}`, values(), { sharedStrings });
        const c = d.cells["Values"]!;
        const v = (ref: string): unknown => c[ref]?.value;
        expect(v("A1")).toBe("plain");
        expect(v("B1")).toBe("été 漢字 😀");
        expect(v("C1")).toBe("=1+1"); // text, not a formula
        expect(c["C1"]!.dataType).toBe("s");
        expect(v("D1")).toBe("  padded  ");
        // CR and control characters are stored as ST_Xstring escapes (ECMA-376 §22.9.2.19), which Excel
        // decodes. openpyxl does not decode them on read, so it shows the stored form; the encoding itself
        // is checked in test/write/xml.test.ts.
        expect(v("E1")).toBe("line1_x000D_\nline2");
        expect(v("F1")).toBe("_x0041_ literal"); // a literal _xHHHH_ survives (written as _x005F_x0041_)
        expect(v("G1")).toBe("ctrl_x0001_char");
        expect(v("H1") ?? "").toBe("");
        expect(v("I1")).toBe(long);

        expect([v("A2"), v("B2"), v("C2"), v("D2"), v("E2")]).toEqual([0, 0, 42, -3.5, 0.1 + 0.2]);
        expect([v("F2"), v("G2"), v("H2"), v("I2")]).toEqual([1e21, 1e-7, Number.MAX_SAFE_INTEGER, 123456789.125]);
        expect([v("A3"), v("B3")]).toEqual([true, false]);

        expect(v("A4")).toEqual({ datetime: "2024-01-15T00:00:00" });
        expect(c["A4"]!.numFmt).toBe("mm-dd-yy"); // built-in 14
        expect(v("B4")).toEqual({ datetime: iso(new Date(2024, 0, 15, 10, 30, 15, 500)) });
        expect(v("C4")).toEqual({ datetime: "1900-01-01T00:00:00" });
        expect(v("D4")).toEqual({ datetime: "1900-02-28T00:00:00" });
        expect(v("E4")).toEqual({ datetime: "1900-03-01T00:00:00" });
        expect(v("F4")).toEqual({ datetime: "9999-12-31T00:00:00" });

        expect(["A5", "B5", "C5", "D5", "E5", "F5", "G5"].map(v)).toEqual(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"]);
        expect(c["A5"]!.dataType).toBe("e");

        expect(v("A6")).toBe("=SUM(B2:C2)");
        expect(c["A6"]!.cached).toBe(42);
        expect(v("B6")).toBe('=A1&"!"');
        expect(c["B6"]!.cached).toBe("plain!");
        expect(c["C6"]!.cached).toBe(false);
        expect(c["D6"]!.cached).toBe("#DIV/0!");
        expect(c["E6"]!.cached).toEqual({ datetime: "2024-01-15T00:00:00" });
        expect(v("F6")).toBe("=NOW()");
        expect(c["F6"]!.cached).toBeNull();
        expect(v("G6")).toEqual({ repr: expect.stringContaining("ArrayFormula") });

        expect(c["A7"]!.fill.fgColor).toEqual({ rgb: "FFFFEE00" });
        expect(c["A7"]!.value).toBeNull();
        expect(c["B7"]!.font.bold).toBe(true);
        expect(v("C7")).toBe("typed");

        expect(v("A8")).toEqual({
          richText: [
            { text: "Bold ", font: expect.objectContaining({ bold: true, name: "Calibri", size: 11 }) },
            { text: "red", font: expect.objectContaining({ italic: true, color: { rgb: "FFFF0000" } }) },
            { text: " plain" },
          ],
        });
      });
    }

    it("1904 date system", async () => {
      // (1904-01-01 is serial 0, which openpyxl shows as a bare time; the unit tests check that serial.)
      const d = await golden("dates-1904", { date1904: true, sheets: [{ name: "S", rows: [[new Date(1904, 0, 2), new Date(2024, 0, 15, 12)]] }] });
      expect(d.epoch1904).toBe(true);
      expect(d.cells["S"]!["A1"]!.value).toEqual({ datetime: "1904-01-02T00:00:00" });
      expect(d.cells["S"]!["B1"]!.value).toEqual({ datetime: "2024-01-15T12:00:00" });
    });

    it("dateZone 'utc' uses the UTC fields", async () => {
      const d = await golden("dates-utc", { sheets: [{ name: "S", rows: [[new Date(Date.UTC(2024, 0, 15, 23, 30))]] }] }, { dateZone: "utc" });
      expect(d.cells["S"]!["A1"]!.value).toEqual({ datetime: "2024-01-15T23:30:00" });
    });
  });

  // ------------------------------------------------------------ styles
  describe("styles", () => {
    it("fonts: every property and colour form", async () => {
      const fonts: Style[] = [
        { font: { name: "Arial", size: 14, bold: true, italic: true, strike: true, color: "#336699" } },
        { font: { underline: true } },
        { font: { underline: "double" } },
        { font: { underline: "singleAccounting" } },
        { font: { underline: "doubleAccounting" } },
        { font: { vertAlign: "superscript" } },
        { font: { vertAlign: "subscript" } },
        { font: { color: { theme: 4, tint: -0.25 } } },
        { font: { color: { indexed: 10 } } },
        { font: { color: { auto: true } } },
        { font: { color: "80FF0000" } },
        { font: { outline: true, shadow: true, condense: true, extend: true, family: 1, charset: 0, scheme: "major" } },
      ];
      const d = await golden("fonts", { sheets: [{ name: "S", rows: [fonts.map((style, i) => ({ value: i, style }))] }] });
      const f = (col: string): DumpCell["font"] => d.cells["S"]![`${col}1`]!.font;
      expect(f("A")).toMatchObject({ name: "Arial", size: 14, bold: true, italic: true, strike: true, color: { rgb: "FF336699" }, scheme: null, family: null });
      expect([f("B").underline, f("C").underline, f("D").underline, f("E").underline]).toEqual(["single", "double", "singleAccounting", "doubleAccounting"]);
      expect([f("F").vertAlign, f("G").vertAlign]).toEqual(["superscript", "subscript"]);
      expect(f("H").color).toEqual({ theme: 4, tint: -0.25 });
      expect(f("I").color).toEqual({ indexed: 10 });
      expect(f("J").color).toEqual({ auto: true });
      expect(f("K").color).toEqual({ rgb: "80FF0000" });
      expect(f("L")).toMatchObject({ outline: true, shadow: true, condense: true, extend: true, family: 1, charset: 0, scheme: "major" });
      // Unset fields come from the default font.
      expect(f("B")).toMatchObject({ name: "Calibri", size: 11, scheme: "minor", family: 2, color: { theme: 1, tint: 0 } });
    });

    it("fills: all 19 patterns, solid shorthand, gradients", async () => {
      const patterns: PatternType[] = [
        "none", "solid", "mediumGray", "darkGray", "lightGray", "darkHorizontal", "darkVertical", "darkDown", "darkUp", "darkGrid",
        "darkTrellis", "lightHorizontal", "lightVertical", "lightDown", "lightUp", "lightGrid", "lightTrellis", "gray125", "gray0625",
      ];
      const row = patterns.map((pattern, i) => ({ value: i, style: { fill: { pattern, fgColor: "FF0000", bgColor: { theme: 3 } } } }));
      const extra = [
        { value: "shorthand", style: { fill: "00FF00" } },
        { value: "linear", style: { fill: { type: "gradient" as const, gradient: "linear" as const, degree: 90, stops: [{ position: 0, color: "FFFFFF" }, { position: 1, color: { theme: 4 } }] } } },
        { value: "path", style: { fill: { type: "gradient" as const, gradient: "path" as const, left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, stops: [{ position: 0, color: "FFFFFF" }, { position: 1, color: "000000" }] } } },
      ];
      const d = await golden("fills", { sheets: [{ name: "S", rows: [row, extra] }] });
      const cells = d.cells["S"]!;
      patterns.forEach((pattern, i) => {
        const fill = cells[`${String.fromCharCode(65 + i)}1`]!.fill;
        if (pattern === "none") expect(fill.pattern).toBeNull();
        else expect(fill, pattern).toMatchObject({ pattern, fgColor: { rgb: "FFFF0000" }, bgColor: { theme: 3 } });
      });
      expect(cells["A2"]!.fill).toMatchObject({ pattern: "solid", fgColor: { rgb: "FF00FF00" }, bgColor: { indexed: 64 } });
      expect(cells["B2"]!.fill).toMatchObject({ gradient: "linear", degree: 90, stops: [{ position: 0, color: { rgb: "FFFFFFFF" } }, { position: 1, color: { theme: 4 } }] });
      expect(cells["C2"]!.fill).toMatchObject({ gradient: "path", left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 });
    });

    it("borders: all 14 styles, a colour per side, diagonals", async () => {
      const styles: BorderStyle[] = ["none", "thin", "medium", "thick", "double", "hair", "dotted", "dashed", "dashDot", "dashDotDot", "mediumDashed", "mediumDashDot", "mediumDashDotDot", "slantDashDot"];
      const row = styles.map((style, i) => ({ value: i, style: { border: { left: { style }, right: { style }, top: { style }, bottom: { style } } } }));
      const perSide = {
        value: "sides",
        style: {
          border: {
            left: { style: "thin" as const, color: "FF0000" },
            right: { style: "medium" as const, color: { theme: 5 } },
            top: { style: "dashed" as const, color: { indexed: 12 } },
            bottom: { style: "double" as const },
            diagonal: { style: "hair" as const, color: "0000FF" },
            diagonalUp: true,
            diagonalDown: true,
          },
        },
      };
      const d = await golden("borders", { sheets: [{ name: "S", rows: [row, [perSide]] }] });
      const cells = d.cells["S"]!;
      styles.forEach((style, i) => {
        const b = cells[`${String.fromCharCode(65 + i)}1`]!.border;
        if (style === "none") expect(b["left"]).toBeNull();
        else for (const s of ["left", "right", "top", "bottom"]) expect((b[s] as { style: string }).style, `${style} ${s}`).toBe(style);
      });
      const b = cells["A2"]!.border;
      expect(b["left"]).toEqual({ style: "thin", color: { rgb: "FFFF0000" } });
      expect(b["right"]).toEqual({ style: "medium", color: { theme: 5, tint: 0 } });
      expect(b["top"]).toEqual({ style: "dashed", color: { indexed: 12 } });
      expect(b["bottom"]).toEqual({ style: "double", color: null });
      expect(b["diagonal"]).toEqual({ style: "hair", color: { rgb: "FF0000FF" } });
      expect([b["diagonalUp"], b["diagonalDown"]]).toEqual([true, true]);
    });

    it("alignment: horizontal, vertical, rotation, indent, readingOrder, wrap, shrink", async () => {
      const h = ["general", "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"] as const;
      const v = ["top", "center", "bottom", "justify", "distributed"] as const;
      const rotations = [0, 45, 90, -45, -90, "vertical"] as const;
      const d = await golden("alignment", {
        sheets: [
          {
            name: "S",
            rows: [
              h.map((horizontal) => ({ value: horizontal, style: { alignment: { horizontal } } })),
              v.map((vertical) => ({ value: vertical, style: { alignment: { vertical } } })),
              rotations.map((rotation) => ({ value: String(rotation), style: { alignment: { rotation } } })),
              [
                { value: "indent", style: { alignment: { horizontal: "left", indent: 3 } } },
                { value: "rtl", style: { alignment: { readingOrder: "rtl" } } },
                { value: "ltr", style: { alignment: { readingOrder: "ltr" } } },
                { value: "wrap", style: { alignment: { wrapText: true, shrinkToFit: true, justifyLastLine: true } } },
              ],
            ],
          },
        ],
      });
      const a = (ref: string): DumpCell["alignment"] => d.cells["S"]![ref]!.alignment;
      h.forEach((horizontal, i) => expect(a(`${String.fromCharCode(65 + i)}1`).horizontal).toBe(horizontal));
      v.forEach((vertical, i) => expect(a(`${String.fromCharCode(65 + i)}2`).vertical).toBe(vertical));
      expect(["A3", "B3", "C3", "D3", "E3", "F3"].map((r) => a(r).textRotation)).toEqual([0, 45, 90, 135, 180, 255]);
      expect(a("A4")).toMatchObject({ horizontal: "left", indent: 3 });
      expect([a("B4").readingOrder, a("C4").readingOrder]).toEqual([2, 1]);
      expect(a("D4")).toMatchObject({ wrapText: true, shrinkToFit: true, justifyLastLine: true });
    });

    it("number formats: every spec built-in id and custom codes", async () => {
      const builtins = [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 37, 38, 39, 40, 45, 46, 47, 48, 49];
      const custom = ["0.000", "#,##0.00 [$€-x-euro2]", 'yyyy-mm-dd"T"hh:mm', "[Red]-0.0;[Blue]0.0", "General"];
      const d = await golden("numfmts", {
        sheets: [{ name: "S", rows: [builtins.map((numFmt) => ({ value: 1234.5, style: { numFmt } })), custom.map((numFmt) => ({ value: 1234.5, style: { numFmt } }))] }],
      });
      const cells = d.cells["S"]!;
      const col = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + i - 26)}`);
      const expected: Record<number, string> = {
        0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
        14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss",
        22: "m/d/yy h:mm", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
      };
      builtins.forEach((id, i) => {
        if (expected[id]) expect(cells[`${col(i)}1`]!.numFmt, `id ${id}`).toBe(expected[id]);
      });
      custom.forEach((code, i) => expect(cells[`${col(i)}2`]!.numFmt).toBe(code));
    });

    it("protection flags", async () => {
      const d = await golden("protection", {
        sheets: [{ name: "S", rows: [[{ value: 1, style: { protection: { locked: false } } }, { value: 2, style: { protection: { hidden: true } } }, 3]] }],
      });
      const p = (r: string): DumpCell["protection"] => d.cells["S"]![r]!.protection;
      expect([p("A1"), p("B1"), p("C1")]).toEqual([{ locked: false, hidden: false }, { locked: true, hidden: true }, { locked: true, hidden: false }]);
    });

    it("deduplicates: one xf per distinct style, however many cells use it", async () => {
      const bold: Style = { font: { bold: true } };
      const rows = Array.from({ length: 500 }, (_, r) =>
        Array.from({ length: 10 }, (_, c) => ({ value: r * c, style: c % 2 ? bold : { font: { bold: true } , fill: "FFFF00" } })),
      );
      // Same content written via different objects and field orders must dedupe too.
      rows.push([{ value: 1, style: { fill: "ffff00", font: { bold: true } } }, { value: 2, style: { font: { bold: true, italic: false } } }]);
      const d = await golden("dedup", { sheets: [{ name: "S", rows }] });
      expect(d.cellXfCount).toBe(3); // default + bold + bold/yellow
    });

    it("layers: sheet default → column → row → cell, field by field", async () => {
      const d = await golden("layers", {
        sheets: [
          {
            name: "S",
            defaultStyle: { font: { name: "Arial" } },
            colProps: [{ style: { font: { bold: true }, fill: "DDDDDD" } }],
            rowProps: [undefined, { style: { font: { italic: true }, alignment: { horizontal: "center" } } }],
            rows: [
              ["col only", "default only"],
              ["col + row", { value: "row + cell", style: { font: { size: 20 }, border: { top: { style: "thin" } } } }],
            ],
          },
        ],
      });
      const c = d.cells["S"]!;
      expect(c["A1"]!.font).toMatchObject({ name: "Arial", bold: true, italic: false });
      expect(c["A1"]!.fill.fgColor).toEqual({ rgb: "FFDDDDDD" });
      expect(c["B1"]!.font).toMatchObject({ name: "Arial", bold: false });
      expect(c["A2"]!.font).toMatchObject({ name: "Arial", bold: true, italic: true });
      expect(c["A2"]!.alignment.horizontal).toBe("center");
      expect(c["B2"]!.font).toMatchObject({ name: "Arial", italic: true, size: 20, bold: false });
      expect((c["B2"]!.border["top"] as { style: string }).style).toBe("thin");
    });
  });

  // ---------------------------------------------------------- workbook
  describe("workbook", () => {
    it("sheet order, names, visibility, active sheet, document properties", async () => {
      const created = new Date(Date.UTC(2024, 0, 15, 10, 30, 0));
      const d = await golden("workbook", {
        activeSheet: 2,
        properties: {
          title: "Quarterly <report> & more",
          subject: "Sales",
          creator: "Ada",
          keywords: "q1, sales",
          description: "Line one",
          lastModifiedBy: "Grace",
          category: "Finance",
          created,
          modified: created,
          company: "ACME",
          manager: "Boss",
          custom: [
            { name: "Text", value: "hello" },
            { name: "Count", value: 42 },
            { name: "Ratio", value: 0.25 },
            { name: "Flag", value: true },
          ],
        },
        sheets: [
          { name: "First", rows: [["a"]] },
          { name: "Hidden", state: "hidden", rows: [["b"]] },
          { name: "Données & 漢字", rows: [["c"]] },
          { name: "Very hidden", state: "veryHidden", rows: [] },
        ],
      });
      expect(d.sheets).toEqual([
        { title: "First", state: "visible" },
        { title: "Hidden", state: "hidden" },
        { title: "Données & 漢字", state: "visible" },
        { title: "Very hidden", state: "veryHidden" },
      ]);
      expect(d.active).toBe(2);
      expect(d.properties).toMatchObject({
        title: "Quarterly <report> & more",
        subject: "Sales",
        creator: "Ada",
        keywords: "q1, sales",
        description: "Line one",
        lastModifiedBy: "Grace",
        category: "Finance",
        created: "2024-01-15T10:30:00",
        modified: "2024-01-15T10:30:00",
      });
      expect(d.custom).toEqual([
        { name: "Text", value: "hello" },
        { name: "Count", value: 42 },
        { name: "Ratio", value: 0.25 },
        { name: "Flag", value: true },
      ]);
    });

    it("default font applies to unstyled cells and is the base of styled ones", async () => {
      const d = await golden("default-font", {
        defaultFont: { name: "Arial", size: 10 },
        sheets: [{ name: "S", rows: [["plain", { value: "bold", style: { font: { bold: true } } }]] }],
      });
      expect(d.cells["S"]!["A1"]!.font).toMatchObject({ name: "Arial", size: 10, scheme: null });
      expect(d.cells["S"]!["B1"]!.font).toMatchObject({ name: "Arial", size: 10, bold: true });
    });

    it("a large sheet: 20,000 rows x 10 columns", async () => {
      const rows = Array.from({ length: 20_000 }, (_, r) => Array.from({ length: 10 }, (_, c) => (c % 3 === 0 ? `r${r}c${c}` : r * 10 + c)));
      const d = await golden("large", { sheets: [{ name: "Big", rows }] }, undefined, true);
      const c = d.cells["Big"]!;
      expect(Object.keys(c)).toHaveLength(200_000);
      expect(c["A1"]!.value).toBe("r0c0");
      expect(c["J20000"]!.value).toBe("r19999c9");
      expect(c["I20000"]!.value).toBe(199_998);
    });
  });
});
