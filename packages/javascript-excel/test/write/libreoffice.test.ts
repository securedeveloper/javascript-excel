/// <reference types="node" />
// LibreOffice headless check on the golden workbooks (test/write/golden-cases.ts):
// - values: LibreOffice opens the file and exports every sheet to CSV "as shown";
// - styles: LibreOffice opens the file and re-saves it as xlsx, and openpyxl reads
//   back what LibreOffice understood.
//
// $JSE_SOFFICE (default `soffice`) runs LibreOffice; $JSE_PYTHON (default python3)
// needs openpyxl. With JSE_REQUIRE_LIBREOFFICE=1 (the `LibreOffice` CI job) a
// missing tool fails the suite; otherwise the suite is skipped.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { toUint8Array, type Workbook } from "../../src/index";
import { LONG_TEXT, stylesWorkbook, valuesWorkbook } from "./golden-cases";

const SOFFICE = process.env["JSE_SOFFICE"] ?? "soffice";
const PY = process.env["JSE_PYTHON"] ?? "python3";
const dump = fileURLToPath(new URL("../interop/xlsx_dump.py", import.meta.url));
const hasSoffice = spawnSync(SOFFICE, ["--version"], { stdio: "ignore", timeout: 120_000 }).status === 0;
const hasOpenpyxl = spawnSync(PY, ["-I", "-c", "import openpyxl"], { stdio: "ignore" }).status === 0;
if (process.env["JSE_REQUIRE_LIBREOFFICE"] === "1" && !(hasSoffice && hasOpenpyxl)) {
  throw new Error(`LibreOffice check required but missing: soffice=${hasSoffice} (${SOFFICE}), openpyxl=${hasOpenpyxl} (${PY})`);
}

const dir = mkdtempSync(join(tmpdir(), "jse-lo-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** CSV, comma, double quote, UTF-8, from line 1, values as shown, all sheets (-1). */
const CSV_FILTER = "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true,false,false,-1";

function soffice(args: string[]): void {
  execFileSync(SOFFICE, ["--headless", "--norestore", ...args], { stdio: "ignore", timeout: 180_000 });
}

async function write(name: string, wb: Workbook): Promise<string> {
  const file = join(dir, `${name}.xlsx`);
  writeFileSync(file, await toUint8Array(wb));
  return file;
}

/** Parses LibreOffice's CSV (quoted fields may contain newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

describe.skipIf(!(hasSoffice && hasOpenpyxl))("LibreOffice headless", () => {
  it("opens the values workbook and shows every value", { timeout: 300_000 }, async () => {
    const file = await write("values", valuesWorkbook());
    soffice(["--convert-to", CSV_FILTER, "--outdir", dir, file]);
    const rows = parseCsv(readFileSync(join(dir, "values-Values.csv"), "utf8").replace(/^\uFEFF/, ""));

    // Text: the ST_Xstring escapes are decoded (U+0001 comes back); LibreOffice keeps
    // no CR in cell text, so CR LF reads back as LF.
    expect(rows[0]).toEqual(["plain", "été 漢字 😀", "=1+1", "  padded  ", "line1\nline2", "_x0041_ literal", "ctrl\u0001char", "", LONG_TEXT]);
    // Numbers as shown with the General format.
    expect(rows[1]!.slice(0, 9)).toEqual(["0", "0", "42", "-3.5", "0.3", "1E+021", "0.0000001", "9007199254740991", "123456789.125"]);
    expect(rows[2]!.slice(0, 2)).toEqual(["TRUE", "FALSE"]);
    // Dates with built-in format 14 (en-US short date). LibreOffice does not emulate Excel's
    // 1900 leap-year bug, so it shows serials 1..59 one day earlier than Excel; the serials
    // themselves are Excel's (checked in writer.test.ts and by openpyxl).
    expect(rows[3]!.slice(0, 6)).toEqual(["1/15/2024", "1/15/2024", "12/31/1899", "2/27/1900", "3/1/1900", "12/31/9999"]);
    // LibreOffice 26.2 shows a stored #REF! error constant as #NAME? (24.2 shows #REF!). A file
    // written by openpyxl behaves the same, so this is LibreOffice's reading, not our output.
    const errors = rows[4]!.slice(0, 7);
    expect(["#REF!", "#NAME?"]).toContain(errors[3]);
    expect([...errors.slice(0, 3), ...errors.slice(4)]).toEqual(["#NULL!", "#DIV/0!", "#VALUE!", "#NAME?", "#NUM!", "#N/A"]);
    // Cached formula results. TODAY() and NOW() are volatile, so LibreOffice recalculates them on load.
    expect(rows[5]!.slice(0, 4)).toEqual(["42", "plain!", "FALSE", "#DIV/0!"]);
    expect(rows[5]![4]).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
    expect(rows[5]![6]).toBe("0");
    expect(rows[6]!.slice(0, 3)).toEqual(["", "", "typed"]);
    expect(rows[7]![0]).toBe("Bold red plain");
  });

  it("opens the styles workbook and keeps every style when re-saving", { timeout: 300_000 }, async () => {
    const file = await write("styles", stylesWorkbook());
    const out = join(dir, "resaved");
    mkdirSync(out, { recursive: true });
    soffice(["--convert-to", "xlsx", "--outdir", out, file]);
    const d = JSON.parse(execFileSync(PY, ["-I", dump, join(out, "styles.xlsx")], { encoding: "utf8" })) as {
      cells: Record<string, Record<string, { font: Record<string, unknown>; fill: Record<string, unknown>; border: Record<string, unknown>; alignment: Record<string, unknown>; numFmt: string }>>;
    };
    const c = d.cells["Styles"]!;
    expect(c["A1"]!.font).toMatchObject({ name: "Arial", size: 14, bold: true, italic: true, color: { rgb: "FFC00000" } });
    expect(c["B1"]!.font["underline"]).toBe("double");
    expect(c["C1"]!.font["strike"]).toBe(true);
    expect(c["D1"]!.font["vertAlign"]).toBe("superscript");
    expect(c["E1"]!.fill).toMatchObject({ pattern: "solid", fgColor: { rgb: "FFFFFF00" } });
    // LibreOffice has no pattern fills: it reads the pattern and approximates it with a solid colour.
    expect(c["F1"]!.fill["pattern"]).toBe("solid");
    expect(c["G1"]!.border).toMatchObject({
      left: { style: "thin", color: { rgb: "FFFF0000" } },
      right: { style: "medium", color: { rgb: "FF00B050" } },
      top: { style: "double", color: { rgb: "FF0070C0" } },
      bottom: { style: "dashed", color: { rgb: "FF7030A0" } },
    });
    expect(c["H1"]!.alignment).toMatchObject({ horizontal: "center", vertical: "top", wrapText: true });
    // (LibreOffice adds its own horizontal alignment to rotated cells.)
    expect([c["I1"]!.alignment["textRotation"], c["J1"]!.alignment["textRotation"], c["K1"]!.alignment["textRotation"]]).toEqual([45, 135, 255]);
    expect(c["L1"]!.alignment).toMatchObject({ horizontal: "left", indent: 2 });
    expect([c["M1"]!.numFmt, c["N1"]!.numFmt, c["O1"]!.numFmt]).toEqual(["0.000", "#,##0.00", "0.00%"]);
    expect(c["P1"]!.numFmt.replace(/\\/g, "")).toBe("yyyy-mm-dd"); // LibreOffice escapes the literal '-'
  });
});
