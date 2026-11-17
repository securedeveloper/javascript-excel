import { describe, expect, it } from "vitest";
import { formatCell, formatValue } from "../../src/format";

const f = (v: Parameters<typeof formatValue>[0], fmt?: string | number, opts?: Parameters<typeof formatValue>[2]): string => formatValue(v, fmt, opts).text;
const serial = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): number => (Date.UTC(y, m - 1, d, hh, mm, ss) - Date.UTC(1899, 11, 30)) / 86_400_000;

describe("General", () => {
  it.each([
    [1234.5678, "1234.5678"],
    [0.1 + 0.2, "0.3"],
    [42, "42"],
    [0, "0"],
    [-3.5, "-3.5"],
    [1 / 3, "0.333333333"],
    [1e21, "1E+21"],
    [1e-7, "1E-07"],
    [123456789012, "1.23457E+11"],
    [12345678901, "12345678901"],
    [0.0001, "0.0001"],
  ])("%s → %s", (v, out) => {
    expect(f(v)).toBe(out);
    expect(f(v, 0)).toBe(out);
    expect(f(v, "General")).toBe(out);
  });

  it("aligns by value type", () => {
    expect(formatValue(1).align).toBe("right");
    expect(formatValue("a").align).toBe("left");
    expect(formatValue(true).align).toBe("center");
    expect(formatValue({ error: "#N/A" }).align).toBe("center");
  });
});

describe("built-in ids (en-US)", () => {
  it.each<[number, number, string]>([
    [1, 1234.5678, "1235"],
    [2, 1234.5678, "1234.57"],
    [3, 1234.5678, "1,235"],
    [4, 1234.5678, "1,234.57"],
    [9, 0.256, "26%"],
    [10, 0.256, "25.60%"],
    [11, 1234.5678, "1.23E+03"],
    [12, 1.25, "1 1/4"],
    [13, 1.3125, "1  5/16"],
    [14, 45306, "1/15/2024"],
    [15, 45306, "15-Jan-24"],
    [16, 45306, "15-Jan"],
    [17, 45306, "Jan-24"],
    [18, 0.6458333, "3:30 PM"],
    [19, 0.6458333, "3:30:00 PM"],
    [20, 0.6458333, "15:30"],
    [21, 0.6458333, "15:30:00"],
    [22, 45306.6458333, "1/15/2024 15:30"],
    [37, 1234, "1,234 "],
    [37, -1234, "(1,234)"],
    [39, 1234.5, "1,234.50 "],
    [39, -1234.5, "(1,234.50)"],
    [40, 1234.5, "1,234.50 "],
    [45, 0.0215278, "31:00"],
    [46, 1.5215278, "36:31:00"],
    [47, 0.0215278, "31:00.0"],
    [47, 0.0215278 + 0.5 / 86_400, "31:00.5"],
    [48, 12345.678, "12.3E+3"],
    [49, 1234.5678, "1234.5678"],
  ])("id %i: %s → %s", (id, v, out) => {
    expect(f(v, id)).toBe(out);
  });

  it("id 38 shows negatives in red", () => {
    expect(formatValue(-1234, 38)).toMatchObject({ text: "(1,234)", color: "FFFF0000" });
    expect(formatValue(1234, 38).color).toBeUndefined();
  });

  it("ids 32–35 are times", () => {
    expect(f(0.6458333, 32)).toBe("15:30:00");
  });

  it("unknown ids fall back to General", () => {
    expect(f(1234.5, 200)).toBe("1234.5");
  });
});

describe("numbers", () => {
  it.each<[string, number, string]>([
    ["0.000", 1234.5678, "1234.568"],
    ['#,##0.00 "€"', 1234.5, "1,234.50 €"],
    ["#,##0,", 1234567, "1,235"],
    ["0.0,,", 1234567, "1.2"],
    ["0%", 0.5, "50%"],
    ["000-00-0000", 123456789, "123-45-6789"],
    ["#.##", 0.5, ".5"],
    ["0.##", 1, "1."],
    ["0.00", 1.005, "1.01"],
    ["0", 2.5, "3"],
    ["0", -2.5, "-3"],
    ["0.0", 0.05, "0.1"],
    ["0", 1e20, "100000000000000000000"],
    ["0.00", -0.001, "0.00"],
    ["00000", 42, "00042"],
    ["0;(0)", -5, "(5)"],
    ["0.00E+00", 0.000123, "1.23E-04"],
    ["0.00E+00", 0, "0.00E+00"],
    ["0.0E+0", 99999, "1.0E+5"],
    ["##0.0E+0", 0.000123, "123.0E-6"],
    ["_(0_)", 5, " 5 "],
    ["\\$0", 5, "$5"],
    ['"Total: "General', 12.5, "Total: 12.5"],
    ['[$€-407]#,##0.00', 1234.5, "€1,234.50"],
  ])("%s with %s → %s", (code, v, out) => {
    expect(f(v, code)).toBe(out);
  });

  it("uses the locale's separators", () => {
    expect(f(1234.5, "#,##0.00", { locale: "de-DE" })).toBe("1.234,50");
    expect(f(0.5, "0.0%", { locale: "de-DE" })).toBe("50,0%");
    expect(f(1234.5, undefined, { locale: "de-DE" })).toBe("1234,5");
  });

  it("selects sections with and without conditions", () => {
    const code = '0;-0;"zero";"text: "@';
    expect(f(5, code)).toBe("5");
    expect(f(-5, code)).toBe("-5");
    expect(f(0, code)).toBe("zero");
    expect(f("x", code)).toBe("text: x");
    const cond = '[>100]"big";[<0]"neg";"small"';
    expect(f(150, cond)).toBe("big");
    expect(f(-1, cond)).toBe("neg");
    expect(f(5, cond)).toBe("small");
  });

  it("returns format colours as ARGB", () => {
    expect(formatValue(-12.5, "[Blue]0.0;[Red]-0.0;0")).toMatchObject({ text: "-12.5", color: "FFFF0000" });
    expect(formatValue(1, "[Color10]0").color).toBe("FF008000");
    expect(formatValue(1, "[Color10]0", { indexedColors: Array.from({ length: 64 }, (_, i) => (i === 17 ? "FF123456" : "FF000000")) }).color).toBe("FF123456");
  });

  it("reports a *x fill without repeating it", () => {
    expect(formatValue(5, "*-0")).toMatchObject({ text: "5", fill: { char: "-", at: 0 } });
    expect(formatValue(5, '"$"* 0')).toMatchObject({ text: "$5", fill: { char: " ", at: 1 } });
  });

  it("fractions", () => {
    expect(f(1.3, "# ?/8")).toBe("1 2/8");
    expect(f(0.75, "?/?")).toBe("3/4");
    expect(f(2, "# ?/?")).toBe("2    ");
    expect(f(3.14159, "# ???/???")).toBe("3  16/113");
  });
});

describe("dates and times from serials", () => {
  it.each<[string, number, string]>([
    ['yyyy-mm-dd"T"hh:mm', serial(2024, 1, 15, 9, 5), "2024-01-15T09:05"],
    ["dddd, mmmm d, yyyy", 45306, "Monday, January 15, 2024"],
    ["ddd d mmm yy", 45306, "Mon 15 Jan 24"],
    ["mmmmm", 45306, "J"],
    ["h:mm AM/PM", 0, "12:00 AM"],
    ["h am/pm", 0.5, "12 pm"],
    ["h:mm A/P", 0.75, "6:00 P"],
    ["[h]:mm", 1.5, "36:00"],
    ["[mm]:ss", 0.0215278, "31:00"],
    ["[ss]", 0.0215278, "1860"],
    ["ss.00", 1.5 / 86400, "01.50"],
    ["hh:mm:ss.000", 0.5 + 0.123 / 86400, "12:00:00.123"],
    ["d-mmm-yy", 60, "29-Feb-00"],
    ["yyyy-mm-dd", 0, "1900-01-00"],
    ["dddd", 1, "Sunday"],
    ["dddd", 61, "Thursday"],
    ["yyyy-mm-dd hh:mm", 45306.99999999, "2024-01-16 00:00"],
    ["m/d/yy", 2958465, "12/31/99"],
    ["yyyy", 45306, "2024"],
    ["mm:ss", serial(2024, 1, 15, 10, 30, 15) % 1, "30:15"],
    ["h:mm", serial(2024, 1, 15, 10, 30, 15) % 1, "10:30"],
  ])("%s with %s → %s", (code, v, out) => {
    expect(f(v, code)).toBe(out);
  });

  it("1904 system", () => {
    expect(f(0, "yyyy-mm-dd", { date1904: true })).toBe("1904-01-01");
    expect(f(0, "dddd", { date1904: true })).toBe("Friday");
  });

  it("Date inputs become serials in the chosen zone", () => {
    expect(f(new Date(2024, 0, 15), 14)).toBe("1/15/2024");
    expect(f(new Date(Date.UTC(2024, 0, 15, 12)), "yyyy-mm-dd hh:mm", { dateZone: "utc" })).toBe("2024-01-15 12:00");
  });

  it("locale names and short dates", () => {
    expect(f(45306, "dddd d mmmm", { locale: "de-DE" })).toBe("Montag 15 Januar");
    expect(f(45306, 14, { locale: "de-DE" })).toBe("15.01.2024");
    expect(f(45306, 14, { locale: "en-GB" })).toBe("15/01/2024");
    expect(f(45306, "[$-407]mmmm", { locale: "en-US" })).toBe("Januar");
  });

  it("dates Excel cannot show fill the cell with #", () => {
    expect(formatValue(-1, "yyyy-mm-dd")).toMatchObject({ text: "", fill: { char: "#", at: 0 } });
    expect(formatValue(3e6, "yyyy-mm-dd")).toMatchObject({ text: "", fill: { char: "#", at: 0 } });
    expect(f(-1.5, "[h]:mm")).toBe("-36:00");
  });
});

describe("other values", () => {
  it("booleans, errors, text and empty", () => {
    expect(f(true, "0.00")).toBe("TRUE");
    expect(f(false)).toBe("FALSE");
    expect(f({ error: "#DIV/0!" }, "0")).toBe("#DIV/0!");
    expect(f("abc", '"<"@">"')).toBe("<abc>");
    expect(f("abc", "0.00")).toBe("abc");
    expect(f({ richText: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(f(null)).toBe("");
    expect(f(5, "@")).toBe("5");
  });

  it("formatCell uses the cell's number format and cached value", () => {
    expect(formatCell({ value: 45306, style: { numFmt: 14 } }).text).toBe("1/15/2024");
    expect(formatCell({ formula: "SUM(A1:A2)", value: 3, style: { numFmt: "0.00" } }).text).toBe("3.00");
    expect(formatCell({ formula: "NOW()" }).text).toBe("");
    expect(formatCell(12.5).text).toBe("12.5");
    expect(formatCell(undefined).text).toBe("");
  });

  it("never throws on odd codes", () => {
    for (const code of ['"abc', "[Red", "[>abc]0", "0.0.0", ";;;", "\\", "_", "*", "[$-ZZZ]0", "[h", "0/0", "#,##0,,,,", "E+0", "?/"]) {
      expect(() => formatValue(1234.5, code)).not.toThrow();
      expect(() => formatValue(-1, code)).not.toThrow();
      expect(() => formatValue("t", code)).not.toThrow();
    }
    expect(f(5, ";;;")).toBe("");
  });
});
