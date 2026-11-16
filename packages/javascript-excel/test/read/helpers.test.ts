import { describe, expect, it } from "vitest";
import { shiftFormula } from "../../src/internal/read/formula";
import { isDateFormat } from "../../src/internal/read/numfmt";
import { resolveTarget } from "../../src/internal/read/opc";
import { decodeXstring } from "../../src/internal/read/strings";

describe("shared formula shifter (Q6)", () => {
  it.each([
    ["A1*2", 1, 0, "A2*2"],
    ["A1*2", 0, 1, "B1*2"],
    ["$A1+A$1+$A$1", 2, 2, "$A3+C$1+$A$1"],
    ["SUM(A1:B2)", 1, 1, "SUM(B2:C3)"],
    ["SUM($A$1:B2)", 3, 0, "SUM($A$1:B5)"],
    ["Sheet2!A1+'My Sheet'!B2+'It''s'!C3", 1, 0, "Sheet2!A2+'My Sheet'!B3+'It''s'!C4"],
    ["SUM(A:A)+SUM(1:1)", 1, 1, "SUM(B:B)+SUM(2:2)"],
    ["SUM($A:B)+SUM($1:2)", 1, 1, "SUM($A:C)+SUM($1:3)"],
    ['"A1"&A1', 1, 0, '"A1"&A2'],
    ['"say ""A1"""&B1', 1, 0, '"say ""A1"""&B2'],
    ["Table1[@Col]*A1", 1, 0, "Table1[@Col]*A2"],
    ["[1]Sheet1!A1", 1, 0, "[1]Sheet1!A2"],
    ["LOG10(A1)+ATAN2(B1,C1)", 1, 0, "LOG10(A2)+ATAN2(B2,C2)"],
    ["TaxRate*A1", 1, 0, "TaxRate*A2"],
    ["ABCD1+A1", 1, 0, "ABCD1+A2"],
    ["A1+1.5E+3+10", 1, 0, "A2+1.5E+3+10"],
    ["IF(TRUE,A1,#REF!)", 1, 0, "IF(TRUE,A2,#REF!)"],
    ["_xlfn.XLOOKUP(A1,B:B,C:C)", 1, 0, "_xlfn.XLOOKUP(A2,B:B,C:C)"],
    ["AB1!A1", 1, 0, "AB1!A2"],
    ["XFD1+A1048575", 1, 0, "XFD2+A1048576"],
  ])("%s shifted by (%i, %i) = %s", (f, dr, dc, expected) => {
    expect(shiftFormula(f, dr, dc)).toBe(expected);
  });
  it("returns undefined when a reference would leave the sheet", () => {
    expect(shiftFormula("A1048576", 1, 0)).toBeUndefined();
    expect(shiftFormula("XFD1", 0, 1)).toBeUndefined();
    expect(shiftFormula("SUM(A:XFD)", 0, 1)).toBeUndefined();
  });
  it("zero offset returns the text unchanged", () => {
    expect(shiftFormula("whatever(", 0, 0)).toBe("whatever(");
  });
});

describe("date number formats (§3.4.1)", () => {
  it.each([
    [14, true],
    [22, true],
    [45, true],
    [46, false], // [h]:mm:ss
    [47, true],
    [27, true],
    [58, true],
    [0, false],
    [10, false],
    [49, false],
    ["yyyy-mm-dd", true],
    ["d/m/yy h:mm", true],
    ["hh:mm AM/PM", true],
    ["[$-409]mmm d, yyyy", true],
    ['"Day "d', true],
    ['"yyyy"0', false],
    ["\\d0", false],
    ["[h]:mm:ss", false],
    ["[mm]:ss", false],
    ["0.00E+00", false],
    ["General", false],
    ["#,##0.00", false],
    ["[Red]#,##0", false],
    ["0;-0;;@", false],
    ["_(* #,##0_);_(* (#,##0);_(* \"-\"_);_(@_)", false],
  ] as const)("%j -> %s", (fmt, expected) => {
    expect(isDateFormat(fmt)).toBe(expected);
  });
});

describe("ST_Xstring and relationship targets", () => {
  it("decodes _xHHHH_ escapes; _x005F_ escapes a literal", () => {
    expect(decodeXstring("a_x000D_b_x0009_c")).toBe("a\rb\tc");
    expect(decodeXstring("_x005F_x0041_")).toBe("_x0041_");
    expect(decodeXstring("_xZZZZ_ x_y")).toBe("_xZZZZ_ x_y");
  });
  it("resolves relative, absolute and percent-encoded targets", () => {
    expect(resolveTarget("xl/", "worksheets/sheet1.xml")).toBe("xl/worksheets/sheet1.xml");
    expect(resolveTarget("xl/", "/xl/worksheets/sheet1.xml")).toBe("xl/worksheets/sheet1.xml");
    expect(resolveTarget("xl/worksheets/", "../sharedStrings.xml")).toBe("xl/sharedStrings.xml");
    expect(resolveTarget("xl/", "./a/./b/../c.xml")).toBe("xl/a/c.xml");
    expect(resolveTarget("xl/", "My%20Sheet.xml")).toBe("xl/My Sheet.xml");
    expect(resolveTarget("", "../../../etc/passwd")).toBe("etc/passwd");
  });
});
