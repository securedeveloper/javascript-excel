import { describe, expect, it } from "vitest";
import { importDataset } from "../../src/import";
import { toUint8Array } from "../../src/write";
import { build } from "../read/build";

const enc = (s: string) => new TextEncoder().encode(s);
const book = (sheets: Parameters<typeof toUint8Array>[0]["sheets"], activeSheet?: number) => toUint8Array({ sheets, ...(activeSheet !== undefined ? { activeSheet } : {}) });

describe("format detection", () => {
  it("strings are CSV; bytes need a CSV name, MIME type or format", async () => {
    expect((await importDataset("a,b\n1,2")).meta.format).toBe("csv");
    await expect(importDataset(enc("a,b\n1,2"))).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT", details: { format: "unknown" } });
    expect((await importDataset(enc("a,b\n1,2"), { fileName: "x.CSV" })).data).toEqual([Object.assign(Object.create(null), { a: 1, b: 2 })]);
    expect((await importDataset(enc("a\tb\n1\t2"), { mimeType: "text/tab-separated-values; charset=utf-8" })).meta.delimiter).toBe("\t");
    expect((await importDataset(enc("a,b\n1,2"), { format: "csv" })).meta.format).toBe("csv");
  });

  it("takes the name and type of a File", async () => {
    const file = new File([enc("x;y\n1;2")], "data.csv", { type: "" });
    const r = await importDataset(file);
    expect(r.meta).toMatchObject({ format: "csv", fileName: "data.csv", delimiter: ";", encoding: "utf-8", bom: false });
  });

  it("reports the BOM's encoding", async () => {
    const r = await importDataset(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("a\n1")]), { format: "csv" });
    expect(r.meta).toMatchObject({ encoding: "utf-8", bom: true });
    const le = new Uint8Array([0xff, 0xfe, ...[..."a\n1"].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect((await importDataset(le, { format: "csv" })).meta.encoding).toBe("utf-16le");
  });

  it("rejects .xls and other containers with UNSUPPORTED_FORMAT, even when named .csv", async () => {
    const cfb = new Uint8Array(1024);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(importDataset(cfb, { fileName: "old.xls" })).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    await expect(importDataset(cfb, { fileName: "renamed.csv" })).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });

  it("reads macro-enabled files as data", async () => {
    const bytes = await build({ sheets: [`<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>h</t></is></c></row><row r="2"><c r="A2"><v>1</v></c></row></sheetData>`] });
    expect((await importDataset(bytes)).data).toEqual([Object.assign(Object.create(null), { h: 1 })]);
  });
});

describe("sheets", () => {
  it("first-visible skips hidden sheets; names and indexes pick any sheet", async () => {
    const bytes = await book([
      { name: "Hidden", state: "hidden", rows: [["h"], [1]] },
      { name: "One", rows: [["a"], [1]] },
      { name: "Two", rows: [["b"], [2]] },
    ], 1);
    expect((await importDataset(bytes)).meta.sheet).toEqual({ name: "One", index: 1 });
    expect((await importDataset(bytes, { sheet: "Two" })).data[0]!["b"]).toBe(2);
    expect((await importDataset(bytes, { sheet: 0 })).data[0]!["h"]).toBe(1);
    const r = await importDataset(bytes);
    expect(r.meta.sheets!.map((s) => s.state)).toEqual(["hidden", "visible", "visible"]);
    await expect(importDataset(bytes, { sheet: "Nope" })).rejects.toMatchObject({ code: "SHEET_NOT_FOUND", details: { sheets: ["Hidden", "One", "Two"] } });
    await expect(importDataset(bytes, { sheet: 9 })).rejects.toMatchObject({ code: "SHEET_NOT_FOUND" });
  });
});

describe("header options", () => {
  const csv = "Title\n\nName,Age\nAda,36\n";
  it("auto, a fixed row, multi-row and none", async () => {
    expect((await importDataset(csv)).meta.header).toEqual({ rows: [2], detected: true, confidence: "high" });
    const fixed = await importDataset("a,b\nc,d\n1,2", { header: 1 });
    expect(fixed.columns.map((c) => c.key)).toEqual(["c", "d"]);
    const multi = await importDataset("Grp,Grp\nx,y\n1,2", { header: { row: 0, rows: 2, join: "." } });
    expect(multi.columns.map((c) => c.key)).toEqual(["Grp.x", "Grp.y"]);
    const none = await importDataset("1,2\n3,4", { header: false });
    expect(none.columns.map((c) => c.key)).toEqual(["A", "B"]);
    expect(none.data).toHaveLength(2);
    expect(none.meta.header).toEqual({ rows: [], detected: false });
  });
});

describe("types", () => {
  it("infer (default), none, and forced by key or title", async () => {
    const csv = "id,when,flag\n007,2024-01-15,TRUE\n012,2024-02-01,false";
    const inferred = await importDataset(csv);
    expect(inferred.columns.map((c) => c.type)).toEqual(["string", "date", "boolean"]);
    expect(inferred.data[0]!["flag"]).toBe(true);
    const none = await importDataset(csv, { types: "none" });
    expect(none.data[0]!["when"]).toBe("2024-01-15");
    expect(none.columns.map((c) => c.type)).toEqual(["string", "string", "string"]);
    const forced = await importDataset(csv, { types: { id: "number", flag: "string" } });
    expect(forced.data.map((d) => d["id"])).toEqual([null, null]);
    expect(forced.issues.map((i) => [i.code, i.ref])).toEqual([["TYPE", "A2"], ["TYPE", "A3"]]);
    await expect(importDataset(csv, { types: { nope: "number" } })).rejects.toThrow(TypeError);
  });

  it("ambiguous numeric dates stay text with one DATE_ORDER_AMBIGUOUS issue", async () => {
    const r = await importDataset("d\n01/02/2024\n03/04/2024");
    expect(r.data[0]!["d"]).toBe("01/02/2024");
    expect(r.issues).toEqual([expect.objectContaining({ code: "DATE_ORDER_AMBIGUOUS", field: "d", row: 0 })]);
    const fixed = await importDataset("d\n01/02/2024", { locale: { dateOrder: "DMY" } });
    expect(fixed.data[0]!["d"]).toEqual(new Date(2024, 1, 1));
  });

  it("schema field types force conversion", async () => {
    const r = await importDataset("Amount\n12\nx", { schema: { fields: { amount: { type: "number" } } } });
    expect(r.data.map((d) => d["amount"])).toEqual([12, null]);
    expect(r.issues.map((i) => i.code)).toEqual(["TYPE"]);
  });
});

describe("unmapped schema fields (JSE-21)", () => {
  const schema = { fields: { email: { aliases: ["E-mail"], required: true }, name: {}, joined: { type: "date" as const }, amount: { type: "number" as const } } };

  it("an optional field without a column is null in every row and has a column", async () => {
    const r = await importDataset("E-mail,Name\na@x,Ada\nb@x,Grace", { schema });
    expect(r.data).toEqual([
      Object.assign(Object.create(null), { email: "a@x", name: "Ada", joined: null, amount: null }),
      Object.assign(Object.create(null), { email: "b@x", name: "Grace", joined: null, amount: null }),
    ]);
    expect(r.columns.map((c) => [c.key, c.letter, c.type, c.field])).toEqual([["email", "A", "string", "email"], ["name", "B", "string", "name"], ["joined", "", "empty", "joined"], ["amount", "", "empty", "amount"]]);
    expect(r.meta.mapping).toEqual({ email: "E-mail", name: "Name", joined: null, amount: null });
    expect(r.issues).toEqual([]);
  });

  it("a required field without a column: MAPPING_MISSING once, null in the rows, no REQUIRED per row", async () => {
    const r = await importDataset("Name\nAda\nGrace", { schema });
    expect(r.issues.map((i) => [i.code, i.field, i.row])).toEqual([["MAPPING_MISSING", "email", 0]]);
    expect(r.data.map((d) => d["email"])).toEqual([null, null]);
    expect(Object.keys(r.data[0]!)).toEqual(["email", "name", "joined", "amount"]);
  });

  it("every row has the same keys, in schema order", async () => {
    const r = await importDataset("Amount,E-mail\n5,a@x\n,b@x", { schema });
    for (const row of r.data) expect(Object.keys(row)).toEqual(["email", "name", "joined", "amount"]);
    expect(r.data.map((d) => d["amount"])).toEqual([5, null]);
  });
});

describe("issue fields (JSE-22)", () => {
  const schema = { fields: { name: { required: true }, quantity: { aliases: ["Qty"], type: "number" as const, required: true }, when: {} } };

  it("with a schema, issues name the field and carry the source column", async () => {
    const bytes = await book([{ name: "S", rows: [["Name", "Qty", "When"], ["Widget", { error: "#N/A" }, "01/02/2024"], ["Gadget", "abc", "03/04/2024"]] }]);
    const r = await importDataset(bytes, { schema });
    expect(r.issues.map((i) => [i.code, i.row, i.field, i.column, i.ref])).toEqual([
      ["ERROR_CELL", 2, "quantity", "Qty", "B2"],
      ["DATE_ORDER_AMBIGUOUS", 0, "when", "When", undefined],
      ["TYPE", 3, "quantity", "Qty", "B3"],
      ["REQUIRED", 2, "quantity", "Qty", "B2"],
    ]);
  });

  it("a forced-type failure in a required field gives TYPE only, not REQUIRED as well", async () => {
    const r = await importDataset("Name,Qty\nWidget,5\nGadget,abc\nGizmo,", { schema });
    expect(r.issues).toEqual([
      { row: 3, field: "quantity", column: "Qty", ref: "B3", code: "TYPE", message: 'B3: "abc" is not a number.', severity: "error" },
      { row: 4, field: "quantity", column: "Qty", ref: "B4", code: "REQUIRED", message: 'Row 4: "quantity" is required.', severity: "error" },
    ]);
  });

  it("MAPPING_MISSING has a field and no column", async () => {
    const r = await importDataset("Qty\n5", { schema });
    expect(r.issues).toEqual([{ row: 0, field: "name", code: "MAPPING_MISSING", message: 'No column for the required field "name".', severity: "error" }]);
  });

  it("kept columns: field is the key in the rows, suffix included", async () => {
    const r = await importDataset("Name,Qty,quantity\nWidget,5,x", { schema: { fields: schema.fields, unmapped: "keep" }, types: { quantity: "number" } });
    expect(r.columns.map((c) => c.key)).toEqual(["name", "quantity", "when", "quantity_2"]);
    expect(r.issues.map((i) => [i.code, i.field, i.column, i.ref])).toEqual([["TYPE", "quantity_2", "quantity", "C2"]]);
  });

  it("issues on columns the mapping drops are dropped", async () => {
    const bytes = await book([{ name: "S", rows: [["Name", "Qty", "Note"], ["Widget", 5, { error: "#REF!" }]] }]);
    expect((await importDataset(bytes, { schema })).issues).toEqual([]);
    const r = await importDataset("Name,Qty,Code\nWidget,5,x", { schema, types: { Code: "number" } });
    expect(r.issues).toEqual([]);
    expect(r.data).toHaveLength(1);
  });

  it("without a schema, field and column are the column key", async () => {
    const r = await importDataset("Qty\nabc", { types: { Qty: "number" } });
    expect(r.issues.map((i) => [i.code, i.field, i.column])).toEqual([["TYPE", "Qty", "Qty"]]);
  });
});

describe("cells", () => {
  it("error cells become null with ERROR_CELL, or are kept", async () => {
    const xml = `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>v</t></is></c></row><row r="2"><c r="A2" t="e"><v>#N/A</v></c></row><row r="3"><c r="A3"><v>2</v></c></row></sheetData>`;
    const bytes = await build({ sheets: [xml] });
    const r = await importDataset(bytes);
    expect(r.data.map((d) => d["v"])).toEqual([null, 2]);
    expect(r.issues).toEqual([{ row: 2, field: "v", column: "v", ref: "A2", code: "ERROR_CELL", message: "A2 holds the error #N/A; read as empty.", severity: "warning" }]);
    expect((await importDataset(bytes, { errorCells: "keep" })).data[0]!["v"]).toEqual({ error: "#N/A" });
  });

  it("formulas are never evaluated: the cached value is the data", async () => {
    const xml = `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>v</t></is></c></row><row r="2"><c r="A2"><f>1+1</f><v>99</v></c></row><row r="3"><c r="A3"><f>NOW()</f></c></row></sheetData>`;
    const r = await importDataset(await build({ sheets: [xml] }));
    // A formula without a cached value is a row with an empty value.
    expect(r.data.map((d) => d["v"])).toEqual([99, null]);
  });

  it("dates as serials on request", async () => {
    const bytes = await toUint8Array({ sheets: [{ name: "S", rows: [["d"], [new Date(Date.UTC(2024, 0, 1))]] }] }, { dateZone: "utc" });
    const r = await importDataset(bytes, { dates: "serial", dateZone: "utc" });
    expect(r.data[0]!["d"]).toBe(45292);
  });
});

describe("limits and preview", () => {
  const big = "n\n" + Array.from({ length: 500 }, (_, i) => i).join("\n");
  it("maxRows rejects bigger files, xlsx and CSV", async () => {
    await expect(importDataset(big, { maxRows: 100 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", details: { limit: "maxRows", max: 100 } });
    expect((await importDataset(big, { maxRows: 500 })).data).toHaveLength(500);
    const bytes = await book([{ name: "S", rows: [["n"], ...Array.from({ length: 500 }, (_, i) => [i])] }]);
    await expect(importDataset(bytes, { maxRows: 100 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await importDataset(bytes, { maxRows: 500 })).data).toHaveLength(500);
  });

  it("preview returns the first rows and says whether more exist", async () => {
    const p = await importDataset(big, { preview: 10 });
    expect(p.data.map((d) => d["n"])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.rowNumbers[0]).toBe(2);
    expect(p.meta.truncated).toBe(true);
    expect((await importDataset("n\n1\n2", { preview: 10 })).meta.truncated).toBe(false);
    const bytes = await book([{ name: "S", rows: [["n"], ...Array.from({ length: 5000 }, (_, i) => [i])] }]);
    const xp = await importDataset(bytes, { preview: 3 });
    expect(xp.data.map((d) => d["n"])).toEqual([0, 1, 2]);
    expect(xp.meta.truncated).toBe(true);
  });

  it("preview doesn't map", async () => {
    const r = await importDataset("E-mail\na@x", { preview: 5, schema: { fields: { email: { aliases: ["E-mail"] } } } });
    expect(r.columns.map((c) => c.key)).toEqual(["E-mail"]);
    expect(r.meta.mapping).toBeUndefined();
  });

  it("read limits pass through", async () => {
    const bytes = await book([{ name: "S", rows: [["n"], [1], [2]] }]);
    await expect(importDataset(bytes, { limits: { maxCells: 1 } })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
});

describe("empty input, abort, progress, options", () => {
  it("empty input is a warning, not an error", async () => {
    expect((await importDataset("")).issues).toEqual([{ row: 0, code: "EMPTY", message: "The file has no data.", severity: "warning" }]);
    const headerOnly = await importDataset("a,b\n");
    expect(headerOnly.columns.map((c) => c.key)).toEqual(["a", "b"]);
    expect(headerOnly.issues.map((i) => i.code)).toEqual(["EMPTY"]);
  });

  it("abort rejects with the signal's reason", async () => {
    const ac = new AbortController();
    ac.abort(new Error("stop"));
    await expect(importDataset("a\n1", { signal: ac.signal })).rejects.toThrow("stop");
  });

  it("progress ends at 1 and never goes back; warnings are collected", async () => {
    const bytes = await book([{ name: "S", rows: [["a"], [1]] }]);
    const seen: number[] = [];
    const warned: string[] = [];
    const r = await importDataset(bytes, { onProgress: (p) => seen.push(p.ratio), onWarning: (w) => warned.push(w.code) });
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    const csv = await importDataset("a,b\n1", { onWarning: (w) => warned.push(w.code) });
    expect(csv.warnings.map((w) => w.code)).toEqual(["CSV_FIELD_COUNT"]);
    expect(warned).toEqual(["CSV_FIELD_COUNT"]);
    expect(r.warnings).toEqual([]);
  });

  it("validates options", async () => {
    for (const o of [{ format: "xls" }, { types: "auto" }, { errorCells: "drop" }, { maxRows: -1 }, { preview: 1.5 }, { header: { rows: 0 } }, { header: -1 }, { sheet: -1 }, { mapping: {} }, { locale: { dateOrder: "DM" } }]) {
      await expect(importDataset("a\n1", o as never), JSON.stringify(o)).rejects.toThrow(TypeError);
    }
  });

  it("rows are null-prototype objects; __proto__ headers are just keys", async () => {
    const r = await importDataset("__proto__,constructor\n1,2");
    expect(Object.getPrototypeOf(r.data[0])).toBeNull();
    expect(r.data[0]!["__proto__"]).toBe(1);
    expect(({} as Record<string, unknown>)["1"]).toBeUndefined();
  });
});
