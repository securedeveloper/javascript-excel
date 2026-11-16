import { describe, expect, it } from "vitest";
import {
  dateToSerial,
  decodeCell,
  decodeCol,
  decodeRange,
  encodeCell,
  encodeCol,
  encodeRange,
  isExcelError,
  mergeStyles,
  serialToDate,
  type Style,
} from "../../src/index";

const code = (f: () => unknown): unknown => {
  try {
    f();
  } catch (e) {
    return isExcelError(e) ? e.code : e;
  }
  return "no error";
};

describe("dateToSerial / serialToDate", () => {
  // Reference serials from Excel's 1900 date system.
  it.each([
    [new Date(1900, 0, 1), 1],
    [new Date(1900, 1, 28), 59],
    [new Date(1900, 2, 1), 61],
    [new Date(1970, 0, 1), 25569],
    [new Date(2024, 0, 15), 45306],
    [new Date(2024, 0, 15, 12), 45306.5],
    [new Date(9999, 11, 31), 2958465],
  ])("%s → %d (1900 system, local)", (d, serial) => {
    expect(dateToSerial(d)).toBe(serial);
    expect(serialToDate(serial).getTime()).toBe(d.getTime());
  });

  it("1904 system: 1904-01-01 is serial 0", () => {
    expect(dateToSerial(new Date(1904, 0, 1), { date1904: true })).toBe(0);
    expect(dateToSerial(new Date(2024, 0, 15), { date1904: true })).toBe(45306 - 1462);
    expect(serialToDate(0, { date1904: true }).getTime()).toBe(new Date(1904, 0, 1).getTime());
  });

  it("utc zone uses UTC fields", () => {
    expect(dateToSerial(new Date(Date.UTC(2024, 0, 15, 6)), { dateZone: "utc" })).toBe(45306.25);
    expect(serialToDate(45306.25, { dateZone: "utc" }).toISOString()).toBe("2024-01-15T06:00:00.000Z");
  });

  it("keeps millisecond precision", () => {
    const d = new Date(2024, 0, 15, 10, 30, 15, 123);
    expect(serialToDate(dateToSerial(d)).getTime()).toBe(d.getTime());
  });

  it("1900 system: serials 0..1 are day 0 (1899-12-31), as time-only values are stored", () => {
    expect(serialToDate(0.5).getTime()).toBe(new Date(1899, 11, 31, 12).getTime());
    expect(serialToDate(0).getTime()).toBe(new Date(1899, 11, 31).getTime());
    expect(serialToDate(0.75, { dateZone: "utc" }).toISOString()).toBe("1899-12-31T18:00:00.000Z");
  });

  it("day 0 round-trips: a time-only value read back as 1899-12-31 can be written again", () => {
    expect(dateToSerial(new Date(1899, 11, 31))).toBe(0);
    expect(dateToSerial(new Date(1899, 11, 31, 12))).toBe(0.5);
    expect(dateToSerial(serialToDate(0.75))).toBe(0.75);
  });

  it("serial 60 (the fictitious 1900-02-29) maps to 1900-03-01", () => {
    expect(serialToDate(60).getTime()).toBe(new Date(1900, 2, 1).getTime());
  });

  it("rejects invalid and out-of-range dates and serials", () => {
    expect(code(() => dateToSerial(new Date(Number.NaN)))).toBe("INVALID_DATE");
    expect(code(() => dateToSerial(new Date(1899, 11, 30, 23, 59)))).toBe("INVALID_DATE");
    expect(code(() => dateToSerial(new Date(1903, 11, 31), { date1904: true }))).toBe("INVALID_DATE");
    expect(code(() => dateToSerial(new Date(10000, 0, 1)))).toBe("INVALID_DATE");
    expect(code(() => serialToDate(-1))).toBe("INVALID_DATE");
    expect(code(() => serialToDate(-0.5, { date1904: true }))).toBe("INVALID_DATE");
    expect(code(() => serialToDate(Number.POSITIVE_INFINITY))).toBe("INVALID_DATE");
  });
});

describe("A1 addresses", () => {
  it("encodes and decodes columns", () => {
    expect([0, 25, 26, 51, 52, 701, 702, 16383].map(encodeCol)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA", "XFD"]);
    expect(["A", "z", "AA", "XFD"].map(decodeCol)).toEqual([0, 25, 26, 16383]);
  });
  it("encodes and decodes cells and ranges", () => {
    expect(encodeCell({ row: 0, col: 1 })).toBe("B1");
    expect(decodeCell("$C$10")).toEqual({ row: 9, col: 2 });
    expect(decodeRange("C3:A1")).toEqual({ start: { row: 0, col: 0 }, end: { row: 2, col: 2 } });
    expect(encodeRange({ start: { row: 0, col: 0 }, end: { row: 0, col: 0 } })).toBe("A1");
    expect(encodeRange(decodeRange("A1:XFD1048576"))).toBe("A1:XFD1048576");
  });
  it("rejects malformed and out-of-bounds refs", () => {
    expect(code(() => decodeCell("A0"))).toBe("INVALID_REF");
    expect(code(() => decodeCell("XFE1"))).toBe("INVALID_REF");
    expect(code(() => decodeCell("A1048577"))).toBe("INVALID_REF");
    expect(code(() => decodeRange("A1:B2:C3"))).toBe("INVALID_REF");
    expect(code(() => encodeCol(16384))).toBe("OUT_OF_BOUNDS");
    expect(code(() => encodeCell({ row: 1_048_576, col: 0 }))).toBe("OUT_OF_BOUNDS");
  });
});

describe("mergeStyles", () => {
  it("merges font, alignment, protection and border sides by field; fill and numFmt replace", () => {
    const a: Style = { font: { name: "Arial", bold: true }, fill: "FF0000", numFmt: "0.00", border: { top: { style: "thin", color: "000000" } } };
    const b: Style = { font: { italic: true }, fill: { pattern: "gray125" }, border: { top: { style: "thick" }, left: { style: "hair" } }, alignment: { wrapText: true } };
    expect(mergeStyles(a, undefined, b)).toEqual({
      font: { name: "Arial", bold: true, italic: true },
      fill: { pattern: "gray125" },
      numFmt: "0.00",
      border: { top: { style: "thick", color: "000000" }, left: { style: "hair" } },
      alignment: { wrapText: true },
    });
  });
  it("skips undefined fields and does not mutate inputs", () => {
    const a: Style = { font: { bold: true } };
    const frozen = JSON.stringify(a);
    expect(mergeStyles(a, { font: { bold: undefined, size: 12 }, fill: undefined })).toEqual({ font: { bold: true, size: 12 } });
    expect(JSON.stringify(a)).toBe(frozen);
  });
});
