import { describe, expect, it } from "vitest";
import { coerceColumns, inferColumnTypes } from "../../src/import";

const ds = (values: Record<string, unknown[]>) => {
  const keys = Object.keys(values);
  const n = Math.max(...keys.map((k) => values[k]!.length));
  return {
    columns: keys.map((key, i) => ({ key, title: key, letter: String.fromCharCode(65 + i) })),
    data: Array.from({ length: n }, (_, r) => Object.fromEntries(keys.map((k) => [k, values[k]![r] ?? null]))),
  };
};
const types = (values: Record<string, unknown[]>, options = {}) => Object.fromEntries(inferColumnTypes(ds(values), options).map((c) => [c.key, c.type]));

describe("inferColumnTypes", () => {
  it("keeps typed values", () => {
    expect(types({ n: [1, 2.5, null], b: [true, false], d: [new Date(2024, 0, 1), new Date(2024, 5, 1)], t: [new Date(2024, 0, 1, 10, 30)], s: ["a", "b"] })).toEqual({
      n: "number", b: "boolean", d: "date", t: "datetime", s: "string",
    });
  });

  it("converts text only when every value converts (all-or-nothing)", () => {
    expect(types({ a: ["1", "2.5", " 3 "], b: ["1", "x"], code: ["007", "012"], c: ["true", "FALSE"], d: ["2024-01-15", "2023-12-31"] })).toEqual({
      a: "number", b: "string", code: "string", c: "boolean", d: "date",
    });
  });

  it("mixes typed values and convertible text", () => {
    expect(types({ a: [1, "2"], b: [1, true], c: [new Date(2024, 0, 1), "2024-02-01"], e: [1, "x"] })).toEqual({ a: "number", b: "mixed", c: "date", e: "mixed" });
  });

  it("empty columns and error cells", () => {
    expect(types({ a: [null, "", "  "], b: [{ error: "#N/A" }, 3] })).toEqual({ a: "empty", b: "number" });
  });

  it("decides the date order from the data only", () => {
    const r = inferColumnTypes(ds({ dmy: ["15/01/2024", "02/03/2024"], mdy: ["01/15/2024", "03/02/2024"], amb: ["01/02/2024", "03/04/2024"], ymd: ["2024.01.15"] }));
    expect(r).toEqual([
      { key: "dmy", type: "date", dateOrder: "DMY" },
      { key: "mdy", type: "date", dateOrder: "MDY" },
      { key: "amb", type: "string" },
      { key: "ymd", type: "date", dateOrder: "YMD" },
    ]);
  });

  it("uses an explicit date order and the number locale", () => {
    expect(types({ d: ["01/02/2024"], n: ["1.234,5"] }, { locale: { dateOrder: "DMY", decimal: ",", group: "." } })).toEqual({ d: "date", n: "number" });
    expect(types({ d: ["01/02/2024 10:15"] }, { locale: { dateOrder: "DMY" } })).toEqual({ d: "datetime" });
  });

  it("conflicting evidence stays text", () => {
    expect(types({ d: ["15/01/2024", "01/15/2024"] })).toEqual({ d: "string" });
  });
});

describe("coerceColumns", () => {
  it("converts inferred columns", () => {
    const d = ds({ n: ["1", "2"], d: ["15/01/2024"] });
    const out = coerceColumns(d, Object.fromEntries(inferColumnTypes(d).map((c) => [c.key, c])));
    expect(out.issues).toEqual([]);
    expect(out.data[0]!["n"]).toBe(1);
    expect(out.data[0]!["d"]).toEqual(new Date(2024, 0, 15));
    expect(Object.getPrototypeOf(out.data[0])).toBeNull();
  });

  it("forced types: failures become null with a TYPE issue", () => {
    const d = { ...ds({ amount: ["1", "x", null] }), rowNumbers: [5, 6, 7] };
    const out = coerceColumns(d, { amount: "number" });
    expect(out.data.map((r) => r["amount"])).toEqual([1, null, null]);
    expect(out.issues).toEqual([{ row: 6, field: "amount", column: "amount", ref: "A6", code: "TYPE", message: 'A6: "x" is not a number.', severity: "error" }]);
  });

  it("string, boolean and date targets", () => {
    const d = ds({ s: [1, new Date(Date.UTC(2024, 0, 2))], b: ["TRUE", true, "no"], dt: ["2024-01-02", new Date(2024, 0, 3), 5] });
    const out = coerceColumns(d, { s: "string", b: "boolean", dt: "date" }, { dateZone: "utc" });
    expect(out.data.map((r) => r["s"])).toEqual(["1", "2024-01-02", null]);
    expect(out.data.map((r) => r["b"])).toEqual([true, true, null]);
    expect(out.data[2]!["dt"]).toBeNull();
    expect(out.issues.map((i) => [i.field, i.row])).toEqual([["b", 4], ["dt", 4]]);
  });

  it("leaves columns without a type alone", () => {
    const d = ds({ a: ["1"], b: ["2"] });
    expect(coerceColumns(d, { a: "number" }).data[0]).toEqual(Object.assign(Object.create(null), { a: 1, b: "2" }));
  });
});
