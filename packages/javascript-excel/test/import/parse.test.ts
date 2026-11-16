import { describe, expect, it } from "vitest";
import { parseDate, parseNumber } from "../../src/import";

describe("parseNumber", () => {
  it.each([
    ["1234.5", {}, 1234.5],
    ["-1.5", {}, -1.5],
    ["+.5", {}, 0.5],
    [".5", {}, 0.5],
    ["1e3", {}, 1000],
    ["0", {}, 0],
    ["0.25", {}, 0.25],
    ["  42 ", {}, 42],
    ["1,234.56", { group: "," }, 1234.56],
    ["1234.56", { group: "," }, 1234.56],
    ["1.234,56", { decimal: ",", group: "." }, 1234.56],
    ["1234,56", { decimal: ",", group: "." }, 1234.56],
    ["1 234,5", { decimal: ",", group: " " }, 1234.5],
    ["1 234", { decimal: ",", group: " " }, 1234],
    ["1 234 567", { decimal: ",", group: " " }, 1234567],
    ["1'234.5", { group: "'" }, 1234.5],
    ["-12,000,000", { group: "," }, -12000000],
  ] as const)("%j %j -> %j", (text, options, want) => {
    expect(parseNumber(text, options)).toBe(want);
  });

  it.each([
    ["007", {}],
    ["01.5", {}],
    ["1.", {}],
    ["", {}],
    ["-", {}],
    ["12%", {}],
    ["$12", {}],
    ["(12)", {}],
    ["1,234", {}], // no group configured
    ["1,23,456", { group: "," }],
    ["1234,567", { group: "," }],
    ["1,2,3", { decimal: ",", group: "." }],
    ["1e3", { decimal: ",", group: "." }], // exponent only with '.'
    ["12345678901234567890", {}],
    ["Infinity", {}],
    ["0x10", {}],
    ["1".repeat(70), {}],
  ] as const)("%j %j -> undefined", (text, options) => {
    expect(parseNumber(text, options as never)).toBeUndefined();
  });

  it("rejects invalid options", () => {
    expect(() => parseNumber("1", { decimal: ";" as never })).toThrow(TypeError);
    expect(() => parseNumber("1", { group: "_" as never })).toThrow(TypeError);
    expect(() => parseNumber("1", { decimal: ",", group: "," })).toThrow(TypeError);
  });

  it("is linear on long adversarial input", () => {
    const t = performance.now();
    for (let i = 0; i < 2000; i++) parseNumber("1,".repeat(30) + "x", { group: "," });
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("parseDate", () => {
  const local = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s).getTime();
  it("reads ISO 8601 without an order", () => {
    expect(parseDate("2024-01-15")?.getTime()).toBe(local(2024, 1, 15));
    expect(parseDate("2024-01-15T10:30:00Z")?.toISOString()).toBe("2024-01-15T10:30:00.000Z");
  });
  it("reads numeric dates in the given order", () => {
    expect(parseDate("15/01/2024", { order: "DMY" })?.getTime()).toBe(local(2024, 1, 15));
    expect(parseDate("01/15/2024", { order: "MDY" })?.getTime()).toBe(local(2024, 1, 15));
    expect(parseDate("2024.01.15", { order: "YMD" })?.getTime()).toBe(local(2024, 1, 15));
    expect(parseDate("1-2-2024", { order: "DMY" })?.getTime()).toBe(local(2024, 2, 1));
    expect(parseDate("15.01.2024 13:45", { order: "DMY", zone: "utc" })?.toISOString()).toBe("2024-01-15T13:45:00.000Z");
    expect(parseDate("15.01.2024 13:45:09", { order: "DMY" })?.getTime()).toBe(local(2024, 1, 15, 13, 45, 9));
  });
  it.each([
    ["15/01/2024", {}], // no order
    ["15/01/24", { order: "DMY" }], // two-digit year
    ["31/04/2024", { order: "DMY" }],
    ["29/02/2023", { order: "DMY" }],
    ["15/01-2024", { order: "DMY" }],
    ["15/13/2024", { order: "DMY" }],
    ["2024/01/15", { order: "DMY" }],
    ["15/01/2024 25:00", { order: "DMY" }],
    ["15/01/2024T10:00", { order: "DMY" }],
  ] as const)("%j %j -> undefined", (text, options) => {
    expect(parseDate(text, options as never)).toBeUndefined();
  });
  it("accepts 29 February in leap years", () => {
    expect(parseDate("29/02/2024", { order: "DMY" })).toBeInstanceOf(Date);
  });
  it("rejects invalid options", () => {
    expect(() => parseDate("1", { order: "YDM" as never })).toThrow(TypeError);
    expect(() => parseDate("1", { zone: "gmt" as never })).toThrow(TypeError);
  });
});
