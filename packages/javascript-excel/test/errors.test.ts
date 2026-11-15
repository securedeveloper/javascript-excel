import { describe, expect, it } from "vitest";
import {
  CsvError,
  EnvironmentError,
  ExcelError,
  FormatError,
  isExcelError,
  LimitError,
  ValidationError,
} from "../src/index";

describe("errors", () => {
  it("carry code, details, cause and the subclass name", () => {
    const cause = new Error("inner");
    const e = new LimitError("LIMIT_EXCEEDED", "too big", { cause, details: { limit: "maxEntries", value: 2, max: 1 } });
    expect(e).toBeInstanceOf(ExcelError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LimitError");
    expect(e.code).toBe("LIMIT_EXCEEDED");
    expect(e.details).toEqual({ limit: "maxEntries", value: 2, max: 1 });
    expect(e.cause).toBe(cause);
    expect(e.message).toBe("too big");
  });

  it("omit details and cause when not given", () => {
    const e = new FormatError("ZIP_INVALID", "bad");
    expect("details" in e).toBe(false);
    expect("cause" in e).toBe(false);
  });

  it("isExcelError recognises every subclass by brand, not prototype", () => {
    for (const C of [ExcelError, ValidationError, FormatError, LimitError, CsvError, EnvironmentError]) {
      expect(isExcelError(new C("ZIP_INVALID", "x"))).toBe(true);
    }
    // A copy from another bundle (or realm) has a different prototype but the same global brand.
    const foreign = Object.assign(new Error("x"), { code: "ZIP_INVALID" });
    Object.defineProperty(foreign, Symbol.for("javascript-excel.error"), { value: true });
    expect(isExcelError(foreign)).toBe(true);
    expect(isExcelError(new Error("x"))).toBe(false);
    expect(isExcelError(null)).toBe(false);
    expect(isExcelError({ code: "ZIP_INVALID" })).toBe(false);
  });
});
