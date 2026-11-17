import { describe, expect, it } from "vitest";
import { parsePath } from "../../src/dataset";
import {
  fromDataset,
  fromDatasets,
  isExcelError,
  toDataset,
  type Cell,
  type CellInput,
  type DatasetOptions,
  type ExcelWarning,
  type Sheet,
} from "../../src/index";

const code = (f: () => unknown): unknown => {
  try {
    f();
  } catch (e) {
    return isExcelError(e) ? e.code : e;
  }
  return "no error";
};
const valueOf = (c: CellInput): unknown => (c !== null && typeof c === "object" && !(c instanceof Date) && !("error" in c) && !("richText" in c) ? (c as Cell).value : c);
const values = (s: Sheet): unknown[][] => s.rows.map((r) => Array.from(r ?? [], (c) => valueOf(c)));
const cell = (s: Sheet, ref: string): Cell => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  const c = s.rows[Number(m[2]) - 1]![m[1]!.charCodeAt(0) - 65];
  return (typeof c === "object" && c !== null && !(c instanceof Date) && !("error" in c) && !("richText" in c) ? c : { value: c }) as Cell;
};
const BOLD = { font: { bold: true } };

describe("fromDataset: accessors (§12 Q18)", () => {
  const data = [{ name: "Ada", "a.b": "literal key", a: { b: "nested", list: [{ x: 1 }, { x: 2 }], "x.y": "quoted" }, n: 3 }];

  it("key is literal, path is nested, value is computed, index picks from arrays", () => {
    const s = fromDataset({
      columns: [
        { title: "Key", key: "a.b" },
        { title: "Path", path: "a.b" },
        { title: "Index path", path: "a.list[1].x" },
        { title: "Quoted", path: "a['x.y']" },
        { title: "Value", value: (row, { rowIndex }) => `${row.name}#${rowIndex}` },
        { title: "Missing", path: "a.zz.yy" },
      ],
      data,
    });
    expect(values(s)[1]).toEqual(["literal key", "nested", 2, "quoted", "Ada#0"]);
    const arrays = fromDataset({ columns: [{ title: "Second", index: 1 }, { title: "First", index: 0 }, { title: "Pos 2" }], data: [["a", "b", "c"]] });
    expect(values(arrays)[1]).toEqual(["b", "a", "c"]);
  });

  it("reads own properties only", () => {
    const proto = { inherited: "nope" };
    const row = Object.assign(Object.create(proto) as Record<string, unknown>, { mine: "yes" });
    expect(values(fromDataset({ columns: [{ key: "mine" }, { key: "inherited" }, { path: "toString" }], data: [row] }))[1]).toEqual(["yes"]);
  });

  it("rejects forbidden path segments, bad paths, several accessors, and object rows without an accessor", () => {
    for (const path of ["__proto__.x", "a.constructor", "a['prototype']"]) expect(code(() => fromDataset({ columns: [{ path }], data: [] }))).toBe("INVALID_COLUMN");
    for (const path of ["", "a..b", "a.", "a[x]", "a['x"]) expect(code(() => parsePath(path))).toBe("INVALID_COLUMN");
    expect(code(() => fromDataset({ columns: [{ key: "a", path: "a" }], data: [] }))).toBe("INVALID_COLUMN");
    expect(code(() => fromDataset({ columns: [{ title: "x" }], data: [{ x: 1 }] }))).toBe("INVALID_COLUMN");
  });

  it("parsePath splits dots, indices and quoted segments", () => {
    expect(parsePath(`a.list[0]['x.y']["q"].z`)).toEqual(["a", "list", "0", "x.y", "q", "z"]);
  });
});

describe("fromDataset: columns", () => {
  it("skips falsy columns (conditional columns) at any level", () => {
    const show = false;
    const s = fromDataset({ columns: [{ key: "a" }, show && { key: "b" }, null, undefined, { title: "G", children: [false, { key: "c" }] }], data: [{ a: 1, b: 2, c: 3 }] });
    expect(values(s)).toEqual([["a", "G"], [undefined, "c"], [1, 3]]);
  });

  it("infers columns from the first object's keys; arrays get no header", () => {
    expect(values(fromDataset({ data: [{ a: 1, b: "x" }, { a: 2, b: "y" }] }))).toEqual([["a", "b"], [1, "x"], [2, "y"]]);
    expect(values(fromDataset({ data: [[1, 2], [3, 4, 5]] }))).toEqual([[1, 2], [3, 4, 5]]);
  });

  it("header groups: titles merge across leaves; shallow leaves merge down (the §4.3 example)", () => {
    const s = fromDataset({ columns: [{ title: "Name", key: "name" }, { title: "Q1", children: [{ title: "Jan", key: "jan" }, { title: "Feb", key: "feb" }] }], data: [{ name: "Ada", jan: 1, feb: 2 }] });
    expect(s.merges).toEqual(["A1:A2", "B1:C1"]);
    expect(values(s)).toEqual([["Name", "Q1"], [undefined, "Jan", "Feb"], ["Ada", 1, 2]]);
  });

  it("three levels deep", () => {
    const s = fromDataset({
      columns: [{ key: "id" }, { title: "2024", children: [{ title: "H1", children: [{ key: "q1" }, { key: "q2" }] }, { key: "h2" }] }],
      data: [{ id: 1, q1: 2, q2: 3, h2: 4 }],
    });
    expect(s.merges).toEqual(["A1:A3", "B1:D1", "B2:C2", "D2:D3"]);
    expect(values(s)[3]).toEqual([1, 2, 3, 4]);
  });

  it("header styles: options.headerStyle, then the column's headerStyle, then a Cell title's own style", () => {
    const s = fromDataset(
      {
        columns: [
          { key: "a" },
          { key: "b", headerStyle: { fill: "FF0000" } },
          { key: "c", title: { value: "C!", style: { font: { italic: true } } } },
          { title: { richText: [{ text: "rich" }] }, key: "d" },
        ],
        data: [],
      },
      { headerStyle: { font: { bold: true, size: 12 } } },
    );
    expect(cell(s, "A1").style).toEqual({ font: { bold: true, size: 12 } });
    expect(cell(s, "B1").style).toEqual({ font: { bold: true, size: 12 }, fill: "FF0000" });
    expect(cell(s, "C1")).toEqual({ value: "C!", style: { font: { bold: true, size: 12, italic: true } } });
    expect(cell(s, "D1")).toEqual({ value: { richText: [{ text: "rich" }] }, style: { font: { bold: true, size: 12 } } });
    expect(cell(fromDataset({ columns: [{ key: "a" }], data: [] }), "A1").style).toEqual(BOLD);
  });

  it("header: false writes data only", () => {
    expect(values(fromDataset({ columns: [{ key: "a" }], data: [{ a: 1 }] }, { header: false }))).toEqual([[1]]);
  });
});

describe("fromDataset: cells, types and styles", () => {
  it("coerces by type, with COERCION_FAILED for values that do not fit", () => {
    const warnings: ExcelWarning[] = [];
    const s = fromDataset(
      {
        columns: [
          { key: "v", type: "string" },
          { key: "v", type: "number", title: "n" },
          { key: "v", type: "boolean", title: "b" },
          { key: "v", type: "date", title: "d" },
        ],
        data: [{ v: "42" }, { v: "TRUE" }, { v: "2024-01-15" }, { v: 1_705_276_800_000 }, { v: "1,234" }],
      },
      { onWarning: (w) => warnings.push(w) },
    );
    const rows = values(s);
    expect(rows[1]).toEqual(["42", 42, "42", "42"]);
    expect(rows[2]).toEqual(["TRUE", "TRUE", true, "TRUE"]);
    expect(rows[3]![0]).toBe("2024-01-15");
    expect(rows[3]![3]).toEqual(new Date(2024, 0, 15));
    expect(rows[4]![1]).toBe(1_705_276_800_000);
    expect(rows[4]![3]).toEqual(new Date(1_705_276_800_000));
    expect(rows[5]![1]).toBe("1,234");
    expect(warnings.map((w) => w.ref)).toEqual(["C2", "D2", "B3", "D3", "B4", "C4", "C5", "B6", "C6", "D6"]);
    expect(new Set(warnings.map((w) => w.code))).toEqual(new Set(["COERCION_FAILED"]));
  });

  it("'string' turns dates into ISO text; non-finite numbers become empty cells with NON_FINITE_NUMBER", () => {
    const warnings: ExcelWarning[] = [];
    const s = fromDataset({ columns: [{ key: "d", type: "string" }, { key: "n" }], data: [{ d: new Date(2024, 0, 15, 10, 30), n: Number.NaN }, { d: null, n: Number.POSITIVE_INFINITY }] }, { onWarning: (w) => warnings.push(w) });
    expect(values(s)[1]).toEqual(["2024-01-15T10:30:00"]);
    expect(s.rows[2]).toBeUndefined(); // a row with only empty cells is a hole
    expect(warnings.map((w) => [w.code, w.ref])).toEqual([["NON_FINITE_NUMBER", "B2"], ["NON_FINITE_NUMBER", "B3"]]);
  });

  it("date and datetime default to built-in formats 14 and 22; numFmt overrides", () => {
    const s = fromDataset({ columns: [{ key: "d", type: "date" }, { key: "d", type: "datetime", title: "dt" }, { key: "d", type: "date", numFmt: "yyyy-mm-dd", title: "f" }], data: [{ d: "2024-01-15T10:30" }] });
    expect(cell(s, "A2").style).toEqual({ numFmt: 14 });
    expect(cell(s, "B2").style).toEqual({ numFmt: 22 });
    expect(cell(s, "C2").style).toEqual({ numFmt: "yyyy-mm-dd" });
  });

  it("styles merge: column style (with numFmt), then rowStyle, then the cell's own style", () => {
    const s = fromDataset(
      { columns: [{ key: "a", style: { font: { bold: true }, fill: "EEEEEE" }, numFmt: "0.00" }], data: [{ a: 1 }, { a: { value: 2, style: { font: { italic: true }, numFmt: "0%" } } }] },
      { rowStyle: (_row, i) => (i === 1 ? { fill: "FFFF00" } : undefined) },
    );
    expect(cell(s, "A2").style).toEqual({ font: { bold: true }, fill: "EEEEEE", numFmt: "0.00" });
    expect(cell(s, "A3")).toEqual({ value: 2, style: { font: { bold: true, italic: true }, fill: "FFFF00", numFmt: "0%" } });
  });

  it("an accessor may return a full Cell with a formula or hyperlink", () => {
    const s = fromDataset({ columns: [{ title: "Link", value: (r: { url: string }) => ({ value: "open", hyperlink: r.url }) }, { title: "Twice", value: (_r, { rowIndex }) => ({ formula: `A${rowIndex + 2}&"!"`, value: "open!" }) }], data: [{ url: "https://example.com" }] });
    expect(cell(s, "A2")).toEqual({ value: "open", hyperlink: "https://example.com" });
    expect(cell(s, "B2")).toEqual({ formula: 'A2&"!"', value: "open!" });
  });
});

describe("fromDataset: widths, hidden, freeze, filter, origin, RTL", () => {
  it("explicit widths, 'auto', hidden; autoWidth for the rest; group titles do not widen leaves", () => {
    const s = fromDataset(
      {
        columns: [
          { key: "a", width: 20 },
          { key: "b", width: { wpx: 100 } },
          { title: "A very long group title that should not widen", children: [{ key: "c" }, { key: "d", hidden: true }] },
        ],
        data: [{ a: "x", b: "y", c: "medium text", d: "漢字漢字" }],
      },
      { autoWidth: true },
    );
    expect(s.colProps).toEqual([{ width: 20 }, { width: { wpx: 100 } }, { width: 13 }, { width: 10, hidden: true }]);
    const bounded = fromDataset({ columns: [{ key: "long" }], data: [{ long: "x".repeat(100) }] }, { autoWidth: { min: 5, max: 30 } });
    expect(bounded.colProps).toEqual([{ width: 30 }]);
    const sampled = fromDataset({ columns: [{ key: "a", width: "auto" }], data: [{ a: "x" }, { a: "x".repeat(40) }] }, { autoWidth: { sampleRows: 1 } });
    expect(sampled.colProps).toEqual([{ width: 8.43 }]);
  });

  it("freeze and filter use the real header rows, with origin and groups", () => {
    const s = fromDataset(
      { columns: [{ key: "a" }, { title: "G", children: [{ key: "b" }, { key: "c" }] }], data: [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }] },
      { origin: "C3", freezeHeader: true, autoFilter: true, rightToLeft: true },
    );
    expect(s.view).toEqual({ freeze: { rows: 4 }, rightToLeft: true });
    expect(s.autoFilter).toBe("C4:E6");
    expect(s.merges).toEqual(["C3:C4", "D3:E3"]);
    expect(values(s)[2]).toEqual([undefined, undefined, "a", "G"]);
  });

  it("validates the sheet name and origin", () => {
    expect(code(() => fromDataset({ data: [] }, { name: "a:b" }))).toBe("INVALID_SHEET_NAME");
    expect(code(() => fromDataset({ data: [] }, { origin: "nope" }))).toBe("INVALID_REF");
    expect(fromDataset({ data: [] }).name).toBe("Sheet1");
  });
});

describe("fromDataset: totals", () => {
  const ds = {
    columns: [
      { title: "Item", key: "item" },
      { title: "Qty", key: "qty", total: "sum" as const },
      { title: "Price", key: "price", numFmt: "#,##0.00", total: "average" as const },
      { title: "Min", key: "qty", total: "min" as const },
      { title: "Max", key: "qty", total: "max" as const },
      { title: "Count", key: "note", numFmt: "@", total: "count" as const },
      { title: "Custom", key: "qty", total: ({ range, values: v }: { range: string; values: unknown[] }) => ({ formula: `PRODUCT(${range})`, value: v.length }) },
      { title: "Fixed", key: "qty", total: "n/a" },
    ],
    data: [
      { item: "a", qty: 2, price: 1.5, note: "x" },
      { item: "b", qty: 3, price: 2.5 },
      { item: "c", qty: 5, price: Number.NaN, note: "" },
    ],
  };

  it("writes SUBTOTAL formulas with cached values computed from the data", () => {
    const s = fromDataset(ds, { totals: { label: "Total", style: { font: { bold: true } } } });
    expect(cell(s, "A5")).toEqual({ value: "Total", style: BOLD });
    expect(cell(s, "B5")).toEqual({ formula: "SUBTOTAL(109,B2:B4)", value: 10, style: BOLD });
    expect(cell(s, "C5")).toEqual({ formula: "SUBTOTAL(101,C2:C4)", value: 2, style: { numFmt: "#,##0.00", font: { bold: true } } });
    expect(cell(s, "D5").value).toBe(2);
    expect(cell(s, "E5").value).toBe(5);
    // COUNTA counts non-empty cells (the empty string counts); count drops the column's number format.
    expect(cell(s, "F5")).toEqual({ formula: "SUBTOTAL(103,F2:F4)", value: 2, style: { font: { bold: true } } });
    expect(cell(s, "G5")).toEqual({ formula: "PRODUCT(G2:G4)", value: 3, style: BOLD });
    expect(cell(s, "H5")).toEqual({ value: "n/a", style: BOLD });
  });

  it("the filter stops above the totals row; no data means no formula", () => {
    const s = fromDataset(ds, { autoFilter: true });
    expect(s.autoFilter).toBe("A1:H4");
    const empty = fromDataset({ columns: [{ key: "q", total: "sum" }, { key: "p", total: "average" }], data: [] });
    expect(values(empty)).toEqual([["q", "p"], [0, { error: "#DIV/0!" }]]);
  });
});

describe("fromDatasets", () => {
  it("stacks blocks with a gap, honours offsets, and freezes the first header", () => {
    const opts: DatasetOptions<unknown> & { gap?: number } = { freezeHeader: true, autoFilter: true, gap: 2 };
    const s = fromDatasets(
      [
        { columns: [{ key: "a" }], data: [{ a: 1 }, { a: 2 }] },
        { columns: [{ key: "b", total: "sum" }], data: [{ b: 3 }] },
        { columns: [{ key: "c" }], data: [{ c: 4 }], offset: { rows: 0, cols: 2 } },
      ],
      opts,
    );
    // Gap rows are holes in the sparse rows array.
    expect(values(s)).toEqual([["a"], [1], [2], undefined, undefined, ["b"], [3], [3], [undefined, undefined, "c"], [undefined, undefined, 4]]);
    expect(s.view).toEqual({ freeze: { rows: 1 } });
    expect(s.autoFilter).toBe("A1:A3");
  });
});

describe("toDataset", () => {
  it("headerRows flattens header groups written by fromDataset", () => {
    const sheet = fromDataset({
      columns: [
        { title: "Name", key: "name" },
        { title: "Q1", children: [{ title: "Jan", key: "jan" }, { title: "Feb", key: "feb" }] },
      ],
      data: [{ name: "Ada", jan: 1, feb: 2 }],
    });
    expect(toDataset(sheet, { headerRows: 2 })).toEqual({
      columns: [{ title: "Name", key: "Name" }, { title: "Q1 / Jan", key: "Q1 / Jan" }, { title: "Q1 / Feb", key: "Q1 / Feb" }],
      data: [Object.assign(Object.create(null), { Name: "Ada", "Q1 / Jan": 1, "Q1 / Feb": 2 })],
    });
    expect(toDataset(sheet, { headerRows: 2, join: "_" }).columns.map((c) => c.key)).toEqual(["Name", "Q1_Jan", "Q1_Feb"]);
  });

  it("headerRows without merges joins non-empty parts; one header row ignores merges as before", () => {
    const sheet = { name: "S", rows: [["A", "B", null], ["x", null, "z"], [1, 2, 3]], merges: ["A1:B1"] };
    expect(toDataset(sheet, { headerRows: 2 }).columns.map((c) => c.title)).toEqual(["A / x", "A", "z"]);
    expect(toDataset(sheet).columns.map((c) => c.title)).toEqual(["A", "B", ""]);
    expect(() => toDataset(sheet, { headerRows: 0 })).toThrow();
  });

  it("headerRows without merges carries a group title right over its sub-columns (CSV)", () => {
    // "Name,Q1,,Q2," over ",Jan,Feb,Apr,May": Name isn't filled from the left; Q1 and Q2 cover their columns.
    const csvLike: Sheet = { name: "S", rows: [["Name", "Q1", "", "Q2", ""], ["", "Jan", "Feb", "Apr", "May"], ["Ada", 1, 2, 3, 4]] };
    expect(toDataset(csvLike, { headerRows: 2 }).columns.map((c) => c.title)).toEqual(["Name", "Q1 / Jan", "Q1 / Feb", "Q2 / Apr", "Q2 / May"]);
    // Upper cells left of the first title stay empty; a column with no lower text isn't a sub-column.
    const leading: Sheet = { name: "S", rows: [["", "", "Q1", "", ""], ["Name", "City", "Jan", "Feb", ""], ["Ada", "Oslo", 1, 2, 3]] };
    expect(toDataset(leading, { headerRows: 2 }).columns.map((c) => c.title)).toEqual(["Name", "City", "Q1 / Jan", "Q1 / Feb", ""]);
    // Every upper cell non-empty (a units row): nothing to fill.
    const units: Sheet = { name: "S", rows: [["Temp", "Pressure"], ["°C", "hPa"], [20, 1013]] };
    expect(toDataset(units, { headerRows: 2 }).columns.map((c) => c.title)).toEqual(["Temp / °C", "Pressure / hPa"]);
  });

  it("headerRows: a real merge wins, and a fill never crosses a merged cell", () => {
    // Q1 merged over B:C; D's upper cell is empty and stays empty instead of taking Q1.
    const s: Sheet = { name: "S", rows: [["Name", "Q1", null, null], [null, "Jan", "Feb", "Notes"], ["Ada", 1, 2, "x"]], merges: ["B1:C1"] };
    expect(toDataset(s, { headerRows: 2 }).columns.map((c) => c.title)).toEqual(["Name", "Q1 / Jan", "Q1 / Feb", "Notes"]);
  });

  it("builds keys from header text: deduplicated, letters for empty headers", () => {
    const sheet: Sheet = { name: "S", rows: [["Name", "Name", "", "  Qty "], ["Ada", "x", true, 2], [], ["Grace", "y", false, { formula: "1+1", value: 2 }]] };
    const { columns, data } = toDataset(sheet);
    expect(columns).toEqual([{ title: "Name", key: "Name" }, { title: "Name", key: "Name_2" }, { title: "", key: "C" }, { title: "Qty", key: "Qty" }]);
    expect(data.map((r) => ({ ...r }))).toEqual([
      { Name: "Ada", Name_2: "x", C: true, Qty: 2 },
      { Name: "Grace", Name_2: "y", C: false, Qty: 2 },
    ]);
  });

  it("rows are null-prototype objects, so a __proto__ header is just a key", () => {
    const { data } = toDataset({ name: "S", rows: [["__proto__", "constructor"], ["polluted?", "x"]] });
    expect(Object.getPrototypeOf(data[0])).toBeNull();
    expect(data[0]!["__proto__"]).toBe("polluted?");
    expect(({} as Record<string, unknown>)["polluted?"]).toBeUndefined();
    expect(Object.keys(data[0]!)).toEqual(["__proto__", "constructor"]);
  });

  it("headerRow false, a range, and values: 'cell'", () => {
    const sheet: Sheet = { name: "S", rows: [["skip"], ["a", "b", "c"], [1, { value: 2, style: BOLD }, 3]] };
    expect(toDataset(sheet, { headerRow: false, range: "A2:B3" })).toEqual({
      columns: [{ title: "A", key: "A" }, { title: "B", key: "B" }],
      data: [Object.assign(Object.create(null), { A: "a", B: "b" }), Object.assign(Object.create(null), { A: 1, B: 2 })],
    });
    const cells = toDataset(sheet, { headerRow: 1, values: "cell" }).data;
    expect({ ...cells[0] }).toEqual({ a: { value: 1 }, b: { value: 2, style: BOLD }, c: { value: 3 } });
  });

  it("inverts fromDataset for flat data", () => {
    const data = [{ name: "Ada", qty: 2, ok: true }, { name: "Grace", qty: 3, ok: false }];
    const back = toDataset(fromDataset({ data }));
    expect(back.columns.map((c) => c.key)).toEqual(["name", "qty", "ok"]);
    expect(back.data.map((r) => ({ ...r }))).toEqual(data);
  });
});

describe("toDataset: totals rows (skipTotals)", () => {
  const ds = { columns: [{ title: "Name", key: "name" }, { title: "Qty", key: "qty", total: "sum" as const }], data: [{ name: "a", qty: 5 }, { name: "b", qty: 10 }] };
  const plain = (r: Record<string, unknown>): Record<string, unknown> => ({ ...r });

  it("'auto' (default) drops the SUBTOTAL row fromDataset wrote, with or without a label", () => {
    expect(toDataset(fromDataset(ds)).data.map(plain)).toEqual([{ Name: "a", Qty: 5 }, { Name: "b", Qty: 10 }]);
    expect(toDataset(fromDataset(ds, { totals: { label: "Total" } })).data.map(plain)).toEqual([{ Name: "a", Qty: 5 }, { Name: "b", Qty: 10 }]);
  });

  it("false keeps it; true drops whatever the last row is", () => {
    expect(toDataset(fromDataset(ds), { skipTotals: false }).data.map(plain)).toEqual([{ Name: "a", Qty: 5 }, { Name: "b", Qty: 10 }, { Name: null, Qty: 15 }]);
    expect(toDataset({ name: "S", rows: [["k"], [1], [2]] }, { skipTotals: true }).data.map(plain)).toEqual([{ k: 1 }]);
  });

  it("'auto' keeps a last row of plain values or of other formulas", () => {
    expect(toDataset({ name: "S", rows: [["k"], [1], [2]] }).data).toHaveLength(2);
    expect(toDataset({ name: "S", rows: [["k", "t"], [1, 2], [{ formula: "SUM(A2)", value: 1 }, { formula: "SUBTOTAL(109,B2)", value: 2 }]] }).data).toHaveLength(2);
  });
});
