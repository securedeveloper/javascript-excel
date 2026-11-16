/// <reference types="node" />
// fromDataset → writer → openpyxl, and → reader → toDataset (back to the original data).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fromDataset, toDataset, toUint8Array, type Dataset } from "../../src/index";
import { read } from "../../src/read";

const PY = process.env["JSE_PYTHON"] ?? "python3";
const dump = join(process.cwd(), "test", "interop", "xlsx_dump.py");
const hasOpenpyxl = spawnSync(PY, ["-I", "-c", "import openpyxl"], { stdio: "ignore" }).status === 0;
if (process.env["CI"] && !hasOpenpyxl) throw new Error(`CI must provide openpyxl (python: ${PY})`);
const dir = mkdtempSync(join(tmpdir(), "jse-dataset-golden-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Sale {
  id: number;
  name: string;
  joined: Date;
  sales: { q1: number; q2: number };
}
const DATA: Sale[] = [
  { id: 1, name: "Ada", joined: new Date(2024, 0, 15), sales: { q1: 1200.5, q2: 980 } },
  { id: 2, name: "Grace 漢字", joined: new Date(2023, 5, 1), sales: { q1: 860, q2: 1430.25 } },
  { id: 3, name: "Linus", joined: new Date(2022, 10, 30), sales: { q1: 0, q2: 75.5 } },
];
const dataset = (): Dataset<Sale> => ({
  columns: [
    { title: "ID", key: "id", width: 6 },
    { title: "Name", key: "name", width: "auto" },
    { title: "Joined", key: "joined", type: "date", numFmt: "yyyy-mm-dd" },
    {
      title: "Sales",
      children: [
        { title: "Q1", path: "sales.q1", numFmt: "#,##0.00", total: "sum" },
        { title: "Q2", path: "sales.q2", numFmt: "#,##0.00", total: "average" },
      ],
    },
  ],
  data: DATA,
});

describe("fromDataset golden round trip", () => {
  it.skipIf(!hasOpenpyxl)("openpyxl sees the layout, values, formulas with cached values and styles", { timeout: 60_000 }, async () => {
    const sheet = fromDataset(dataset(), { name: "Sales", freezeHeader: true, autoFilter: true, totals: { label: "Total", style: { font: { bold: true } } } });
    const file = join(dir, "dataset.xlsx");
    writeFileSync(file, await toUint8Array({ sheets: [sheet] }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = JSON.parse(execFileSync(PY, ["-I", dump, file], { encoding: "utf8" })) as any;
    const c = d.cells["Sales"];
    const info = d.sheetInfo["Sales"];
    expect(info.merges).toEqual(["A1:A2", "B1:B2", "C1:C2", "D1:E1"]);
    expect(info.freeze).toBe("A3");
    expect(info.autoFilter).toBe("A2:E5");
    expect([c["A1"].value, c["D1"].value, c["D2"].value, c["E2"].value]).toEqual(["ID", "Sales", "Q1", "Q2"]);
    expect(c["A1"].font.bold).toBe(true);
    expect(c["B4"].value).toBe("Grace 漢字");
    expect(c["C3"]).toMatchObject({ value: { datetime: "2024-01-15T00:00:00" }, numFmt: "yyyy-mm-dd" });
    expect(c["D3"]).toMatchObject({ value: 1200.5, numFmt: "#,##0.00" });
    expect(c["A6"]).toMatchObject({ value: "Total", font: { bold: true } });
    expect(c["D6"]).toMatchObject({ value: "=SUBTOTAL(109,D3:D5)", cached: 2060.5, numFmt: "#,##0.00", font: { bold: true } });
    expect(c["E6"]).toMatchObject({ value: "=SUBTOTAL(101,E3:E5)", cached: (980 + 1430.25 + 75.5) / 3 });
    expect(info.cols["A"].width).toBe(6.7109375);
    expect(info.cols["B"].width).toBeGreaterThan(10); // auto: "Grace 漢字" counts 10 + padding
  });

  it("our reader and toDataset give back the original rows", async () => {
    const sheet = fromDataset(
      { columns: [{ key: "id" }, { key: "name" }, { key: "joined", type: "date" }, { key: "ok" }], data: DATA.map((r, i) => ({ id: r.id, name: r.name, joined: r.joined, ok: i % 2 === 0 })) },
      { name: "Flat" },
    );
    const { workbook, warnings } = await read(await toUint8Array({ sheets: [sheet] }));
    expect(warnings).toEqual([]);
    const back = toDataset(workbook.sheets[0]!);
    expect(back.columns.map((c) => c.key)).toEqual(["id", "name", "joined", "ok"]);
    expect(back.data.map((r) => ({ ...r }))).toEqual(DATA.map((r, i) => ({ id: r.id, name: r.name, joined: r.joined, ok: i % 2 === 0 })));
  });

  it("our reader sees header-group merges, the totals formula and its cached value", async () => {
    const sheet = fromDataset(dataset(), { autoFilter: true });
    const { workbook } = await read(await toUint8Array({ sheets: [sheet] }));
    const s = workbook.sheets[0]!;
    expect(s.merges).toEqual(["A1:A2", "B1:B2", "C1:C2", "D1:E1"]);
    expect(s.autoFilter).toBe("A2:E5");
    expect(s.rows[5]![3]).toMatchObject({ formula: "SUBTOTAL(109,D3:D5)", value: 2060.5 });
    // Header rows 1–2 make a two-row header; toDataset with headerRow 1 reads the leaf titles.
    const back = toDataset(s, { headerRow: 1, range: "A2:E5" });
    expect(back.columns.map((c) => c.title)).toEqual(["", "", "", "Q1", "Q2"]);
    expect(back.data.map((r) => r["Q1"])).toEqual([1200.5, 860, 0]);
  });
});
