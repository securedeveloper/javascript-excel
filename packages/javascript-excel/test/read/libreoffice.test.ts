/// <reference types="node" />
// The reader on files written by LibreOffice Calc: LibreOffice opens a
// workbook (the openpyxl fixture, and one from our writer with fill-down
// formulas) and saves it again as .xlsx; the reader must read LibreOffice's
// output to the same content.
//
// $JSE_SOFFICE (default `soffice`) runs LibreOffice. With
// JSE_REQUIRE_LIBREOFFICE=1 (the `LibreOffice` CI job) a missing soffice
// fails the suite; otherwise the suite is skipped.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openZip } from "../../src/internal/zip/read";
import type { Cell, CellInput, Sheet } from "../../src/model";
import { read } from "../../src/read";
import { toUint8Array } from "../../src/write";

const SOFFICE = process.env["JSE_SOFFICE"] ?? "soffice";
const hasSoffice = spawnSync(SOFFICE, ["--version"], { stdio: "ignore", timeout: 120_000 }).status === 0;
if (process.env["JSE_REQUIRE_LIBREOFFICE"] === "1" && !hasSoffice) {
  throw new Error(`LibreOffice check required but soffice is missing (${SOFFICE})`);
}

const dir = mkdtempSync(join(tmpdir(), "jse-lo-read-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** LibreOffice opens `file` and saves it as .xlsx into a fresh folder; returns the new file's bytes. */
function resave(file: string, name: string): Uint8Array {
  const out = join(dir, `out-${name}`);
  mkdirSync(out, { recursive: true });
  execFileSync(SOFFICE, ["--headless", "--norestore", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", out, file], { stdio: "ignore", timeout: 180_000 });
  return new Uint8Array(readFileSync(join(out, `${name}.xlsx`)));
}

const values = (s: Sheet<Cell>) => s.rows.map((r) => (r ?? []).map((c) => (c ? [c.type, c.value instanceof Date ? c.value.toISOString() : c.value] : null)));

describe.skipIf(!hasSoffice)("LibreOffice-written files", () => {
  it("the openpyxl fixture re-saved by LibreOffice reads to the same content", { timeout: 300_000 }, async () => {
    const src = join(dir, "features.xlsx");
    copyFileSync(new URL("../fixtures/read/openpyxl-features.xlsx", import.meta.url), src);
    // LibreOffice splits text that mixes scripts (Latin, CJK, emoji) into rich-text runs
    // with a font per script, so compare the plain text.
    const original = await read(new Uint8Array(readFileSync(src)), { dateZone: "utc", richText: "plain" });
    const lo = await read(resave(src, "features"), { dateZone: "utc", richText: "plain" });

    expect(lo.workbook.sheets.map((s) => [s.name, s.state])).toEqual(original.workbook.sheets.map((s) => [s.name, s.state]));
    const a = original.workbook.sheets[0]!;
    const b = lo.workbook.sheets[0]!;
    // LibreOffice recalculates formulas on load and stores the results, so compare
    // formula text there and values everywhere else.
    for (const [r, row] of a.rows.entries()) {
      for (const [c, cell] of (row ?? []).entries()) {
        if (!cell) continue;
        const got = b.rows[r]?.[c];
        if (cell.formula !== undefined) {
          expect(got?.formula, `formula ${r},${c}`).toBe(cell.formula);
          continue;
        }
        expect(got?.value, `value ${r},${c}`).toEqual(cell.value);
      }
    }
    expect(b.rows[0]![6]).toMatchObject({ formula: "B1*2", value: 84 });
    const st = lo.workbook.sheets[1]!;
    expect(st.merges).toEqual(["C1:D2"]);
    expect(st.view?.freeze).toEqual({ rows: 1, cols: 1 });
    expect(st.colProps?.[2]?.hidden).toBe(true);
    expect(st.rowProps?.[1]?.height).toBe(40);
    expect(st.rows[0]![0]!.style?.font).toMatchObject({ name: "Arial", bold: true, italic: true });
    expect(st.rows[0]![0]!.style?.fill).toMatchObject({ pattern: "solid", fgColor: { rgb: "FFFFFF00" } });
    expect(st.rows[4]![0]!.hyperlink).toEqual({ target: "https://example.com/path?q=1" });
    expect(lo.warnings.filter((w) => w.code !== "UNSUPPORTED_PART")).toEqual([]);
  });

  it("fill-down formulas, dates and styles from our writer survive a LibreOffice save", { timeout: 300_000 }, async () => {
    const rows: CellInput[][] = [["n", "double", "date"]];
    for (let i = 1; i <= 50; i++) {
      rows.push([i, { formula: `A${i + 1}*2`, value: i * 2 }, { value: new Date(Date.UTC(2024, 0, i)), style: { numFmt: "yyyy-mm-dd" } }]);
    }
    rows.push([{ formula: "SUM(A2:A51)", value: 1275, style: { font: { bold: true } } }]);
    const src = join(dir, "filldown.xlsx");
    writeFileSync(src, await toUint8Array({ properties: { created: new Date(0), modified: new Date(0) }, sheets: [{ name: "Fill", rows }] }, { dateZone: "utc" }));
    const bytes = resave(src, "filldown");
    const { workbook, warnings } = await read(bytes, { dateZone: "utc" });
    const s = workbook.sheets[0]!;
    for (let i = 1; i <= 50; i++) {
      expect(s.rows[i]![0]!.value).toBe(i);
      expect(s.rows[i]![1]).toMatchObject({ type: "number", value: i * 2, formula: `A${i + 1}*2` });
      expect(s.rows[i]![2]!.value).toEqual(new Date(Date.UTC(2024, 0, i)));
    }
    expect(s.rows[51]![0]).toMatchObject({ value: 1275, formula: "SUM(A2:A51)", style: { font: { bold: true } } });
    expect(warnings.filter((w) => w.code !== "UNSUPPORTED_PART")).toEqual([]);
    // Report whether this LibreOffice wrote shared formulas, so the CI log shows which path ran.
    const zip = openZip(bytes);
    const sheetName = zip.entries.find((e) => /worksheets\/sheet1\.xml$/i.test(e.name))!.name;
    const xml = new TextDecoder().decode(await zip.read(sheetName));
    console.log(`LibreOffice wrote ${(xml.match(/t="shared"/g) ?? []).length} shared-formula cells`);
    expect(values(s).length).toBe(52);
  });
});
