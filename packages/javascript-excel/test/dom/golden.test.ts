// @vitest-environment happy-dom
/// <reference types="node" />
// Golden round trip: HTML table → fromTable → toUint8Array → openpyxl.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fromTable } from "../../src/dom";
import { toUint8Array, type Cell } from "../../src/index";
import { read } from "../../src/read";

const PY = process.env["JSE_PYTHON"] ?? "python3";
// (Under happy-dom, import.meta.url is not a file: URL; Vitest runs from the package directory.)
const script = join(process.cwd(), "test", "interop", "xlsx_dump.py");
const hasOpenpyxl = spawnSync(PY, ["-I", "-c", "import openpyxl"], { stdio: "ignore" }).status === 0;
if (process.env["CI"] && !hasOpenpyxl) throw new Error(`CI must provide openpyxl (python: ${PY})`);
const dir = mkdtempSync(join(tmpdir(), "jse-dom-golden-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!hasOpenpyxl)("fromTable → xlsx (openpyxl)", () => {
  it("keeps values, merges, header style, hints, links, computed styles and RTL", { timeout: 60_000 }, async () => {
    document.head.innerHTML = `<style>
      .num { text-align: right } .total td { font-weight: 700; background-color: #ddebf7 } .warn { color: rgb(192, 0, 0); font-style: italic }
    </style>`;
    document.body.innerHTML = `<table dir="rtl">
      <thead>
        <tr><th rowspan="2">Product</th><th colspan="2">Sales</th></tr>
        <tr><th>Q1</th><th>Q2</th></tr>
      </thead>
      <tbody>
        <tr><td><a href="https://example.com/pens">Pens</a></td><td class="num" data-type="number" data-numfmt="#,##0.00">1,200.50</td><td class="num" data-type="number">980</td></tr>
        <tr><td class="warn">Pads<br>(new)</td><td class="num" data-type="number">860</td><td data-type="date" data-numfmt="yyyy-mm-dd">2024-01-15</td></tr>
        <tr hidden><td>secret</td></tr>
        <tr data-export-ignore><td>internal</td></tr>
      </tbody>
      <tfoot><tr class="total"><td>Total</td><td colspan="2" data-type="number" data-value="4040.5">4,040.50</td></tr></tfoot>
    </table>`;
    const sheet = fromTable(document.querySelector("table")!, { name: "Sales", styles: "computed", freezeHeader: true, autoFilter: true, autoWidth: true });
    const file = join(dir, "table.xlsx");
    const bytes = await toUint8Array({ sheets: [sheet] });
    writeFileSync(file, bytes);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = JSON.parse(execFileSync(PY, ["-I", script, file], { encoding: "utf8" })) as any;
    const c = d.cells["Sales"];
    const info = d.sheetInfo["Sales"];

    expect(info.merges).toEqual(["A1:A2", "B1:C1", "B5:C5"]);
    expect(info.freeze).toBe("A3");
    expect(info.autoFilter).toBe("A2:C5");
    expect(info.view.rightToLeft).toBe(true);
    expect(c["A1"].value).toBe("Product");
    expect(c["A1"].font.bold).toBe(true); // header style
    expect(c["B2"].value).toBe("Q1");
    expect(c["A3"].value).toBe("Pens");
    expect(info.hyperlinks["A3"].target).toBe("https://example.com/pens");
    expect(c["B3"]).toMatchObject({ value: 1200.5, numFmt: "#,##0.00" });
    expect(c["B3"].alignment.horizontal).toBe("right");
    expect(c["A4"].value).toBe("Pads\n(new)");
    expect(c["A4"].alignment.wrapText).toBe(true);
    expect(c["A4"].font).toMatchObject({ italic: true, color: { rgb: "FFC00000" } });
    expect(c["C4"]).toMatchObject({ value: { datetime: "2024-01-15T00:00:00" }, numFmt: "yyyy-mm-dd" });
    // Hidden and ignored rows are gone; the footer follows the body.
    expect(c["A5"].value).toBe("Total");
    expect(c["A5"].font.bold).toBe(true);
    expect(c["A5"].fill.fgColor).toEqual({ rgb: "FFDDEBF7" });
    expect(c["B5"].value).toBe(4040.5);
    expect(Object.keys(info.cols)).toEqual(["A", "B", "C"]);

    // And back through our own reader.
    const { workbook, warnings } = await read(bytes);
    expect(warnings).toEqual([]);
    const back = workbook.sheets[0]!;
    expect(back.merges).toEqual(["A1:A2", "B1:C1", "B5:C5"]);
    expect(back.view).toMatchObject({ rightToLeft: true, freeze: { rows: 2 } });
    expect(back.autoFilter).toBe("A2:C5");
    const cell = (r: number, c: number): Cell => back.rows[r]![c] as Cell;
    expect(cell(2, 0)).toMatchObject({ value: "Pens", hyperlink: { target: "https://example.com/pens" } }); // the reader normalises the shorthand
    expect(cell(2, 1)).toMatchObject({ value: 1200.5, style: { numFmt: "#,##0.00" } });
    expect(cell(3, 0).value).toBe("Pads\n(new)");
    expect(cell(3, 2).value).toEqual(new Date(2024, 0, 15));
  });
});
