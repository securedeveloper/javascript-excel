/// <reference types="node" />
// LibreOffice headless check: converts written files to CSV with `soffice`
// and compares the values. Runs only where LibreOffice is installed
// ($JSE_SOFFICE, default `soffice`); otherwise the suite is skipped.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { toUint8Array, type Workbook } from "../../src/index";

const SOFFICE = process.env["JSE_SOFFICE"] ?? "soffice";
const available = spawnSync(SOFFICE, ["--version"], { stdio: "ignore", timeout: 60_000 }).status === 0;
const dir = mkdtempSync(join(tmpdir(), "jse-lo-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!available)("LibreOffice headless", () => {
  it("opens our files and reads the values", { timeout: 120_000 }, async () => {
    const wb: Workbook = {
      properties: { created: new Date(0), modified: new Date(0) },
      sheets: [
        {
          name: "S",
          rows: [
            ["text", "été 漢字", "=not a formula", "line1\r\nline2", "_x0041_"],
            [1, -2.5, 1e21, true, { error: "#N/A" }],
            [{ formula: "A2+B2", value: -1.5 }, { richText: [{ text: "bold", font: { bold: true } }, { text: " rest" }] }],
            [{ value: 0.5, style: { numFmt: "0.00%", font: { bold: true }, fill: "FFFF00", border: { top: { style: "thin" } } } }],
          ],
        },
      ],
    };
    const file = join(dir, "lo.xlsx");
    writeFileSync(file, await toUint8Array(wb));
    // CSV filter options: comma, double quote, UTF-8 (76), first line 1, then "formatted text as shown".
    execFileSync(SOFFICE, ["--headless", "--norestore", "--convert-to", 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true', "--outdir", dir, file], {
      stdio: "ignore",
      timeout: 120_000,
    });
    const csv = readFileSync(join(dir, "lo.csv"), "utf8").replace(/^\uFEFF/, "");
    const lines = csv.split(/\r?\n(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    // CR is stored as _x000D_; LibreOffice decodes it, so the field keeps a CR before the LF.
    expect(lines[0]).toMatch(/^text,été 漢字,=not a formula,"line1\r?\nline2",_x0041_$/);
    expect(lines[1]).toMatch(/^1,-2\.5,1(\.0+)?E\+0?21,TRUE,#N\/A$/);
    expect(lines[2]).toBe("-1.5,bold rest");
    expect(lines[3]).toBe("50.00%");
  });
});
