import { describe, expect, it } from "vitest";
import { applyMapping, mapColumns, type ImportSchema } from "../../src/import";

const cols = (...titles: string[]) => titles.map((title, i) => ({ key: title || String.fromCharCode(65 + i), title, letter: String.fromCharCode(65 + i) }));

describe("mapColumns", () => {
  const schema: ImportSchema = { fields: { email: { aliases: ["E-mail", "Email address"], required: true }, name: { aliases: ["Full name"] }, city: {} } };

  it("matches after normalisation, in schema order", () => {
    expect(mapColumns(cols("Full_Name", "E MAIL", "Ćity", "x"), schema)).toEqual({
      mapping: { email: "E MAIL", name: "Full_Name", city: "Ćity" },
      missing: [],
      unmapped: ["x"],
    });
  });

  it("takes each column once, the first match in file order", () => {
    const r = mapColumns(cols("Email", "E-mail", "other"), { fields: { email: {}, backup: { aliases: ["email"] }, third: { aliases: ["email"] } } });
    expect(r.mapping).toEqual({ email: "Email", backup: "E-mail", third: null });
  });

  it("reports missing required fields and does not guess near-misses", () => {
    expect(mapColumns(cols("Emial", "Name"), schema)).toEqual({ mapping: { email: null, name: "Name", city: null }, missing: ["email"], unmapped: ["Emial"] });
  });

  it("explicit mapping wins, field by field", () => {
    expect(mapColumns(cols("Emial", "Name"), schema, { email: "Emial", name: null }).mapping).toEqual({ email: "Emial", name: null, city: null });
    expect(() => mapColumns(cols("a"), schema, { email: "zzz" })).toThrow(TypeError);
    expect(() => mapColumns(cols("a", "b"), schema, { email: "a", name: "a" })).toThrow(TypeError);
    expect(() => mapColumns(cols("a"), schema, { phone: "a" })).toThrow(TypeError);
    expect(() => mapColumns(cols("a"), { fields: null } as never)).toThrow(TypeError);
  });
});

describe("applyMapping", () => {
  const ds = { columns: cols("E-mail", "Name", "email2"), data: [{ "E-mail": "a@x", Name: "Ada", email2: 1 }, { "E-mail": null, Name: "Grace", email2: 2 }], rowNumbers: [3, 4] };

  it("renames to fields and reports REQUIRED and MAPPING_MISSING", () => {
    const schema: ImportSchema = { fields: { email: { required: true }, name: {}, phone: { required: true } } };
    const r = applyMapping(ds, { email: "E-mail", name: "Name", phone: null }, schema);
    // Every schema field has a column and a key in every row; an unmapped one is null (JSE-21).
    expect(r.columns.map((c) => [c.key, c.title, c.letter, c.type, c.field])).toEqual([["email", "E-mail", "A", "mixed", "email"], ["name", "Name", "B", "mixed", "name"], ["phone", "", "", "empty", "phone"]]);
    expect(r.data).toEqual([Object.assign(Object.create(null), { email: "a@x", name: "Ada", phone: null }), Object.assign(Object.create(null), { email: null, name: "Grace", phone: null })]);
    expect(r.rowNumbers).toEqual([3, 4]);
    expect(r.issues).toEqual([
      { row: 0, field: "phone", code: "MAPPING_MISSING", message: 'No column for the required field "phone".', severity: "error" },
      { row: 4, field: "email", column: "E-mail", ref: "A4", code: "REQUIRED", message: 'Row 4: "email" is required.', severity: "error" },
    ]);
  });

  it("keeps unmapped columns, suffixing keys that collide with fields", () => {
    const r = applyMapping({ ...ds, columns: cols("E-mail", "name", "email2") , data: [{ "E-mail": "a", name: "N", email2: 1 }] }, { email: "E-mail" }, { fields: { email: {}, name: { aliases: ["zzz"] } }, unmapped: "keep" });
    expect(r.columns.map((c) => c.key)).toEqual(["email", "name", "name_2", "email2"]);
    expect(r.data[0]).toEqual(Object.assign(Object.create(null), { email: "a", name: null, name_2: "N", email2: 1 }));
  });

  it("a header named __proto__ is just a key", () => {
    const row = Object.create(null) as Record<string, unknown>;
    row["__proto__"] = "x";
    const r = applyMapping({ columns: cols("__proto__"), data: [row] }, { p: "__proto__" }, { fields: { p: {} }, unmapped: "keep" });
    expect(r.data[0]!["p"]).toBe("x");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
