import { describe, expect, it } from "vitest";
import { needsPreserve, num, xmlAttr, xmlText, xstring, xstringAttr } from "../../src/internal/xml";

/** Reference ST_Xstring decoder (ECMA-376 Part 1, §22.9.2.19), as Excel applies it on read. */
const decodeXstring = (s: string): string => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");

describe("xstring (ST_Xstring)", () => {
  it.each([
    ["plain text", "plain text"],
    ["a < b & c > d", "a &lt; b &amp; c &gt; d"],
    ["line1\r\nline2", "line1_x000D_\nline2"],
    ["tab\tand\nnewline", "tab\tand\nnewline"],
    ["ctrl\u0001\u0008\u000B\u000C\u001F", "ctrl_x0001__x0008__x000B__x000C__x001F_"],
    ["_x0041_", "_x005F_x0041_"],
    ["_x005F_", "_x005F_x005F_"],
    ["_x005F_x0041_", "_x005F_x005F_x005F_x0041_"],
    ["_x12_ is not an escape", "_x12_ is not an escape"],
    ["\uFFFE\uFFFF", "_xFFFE__xFFFF_"],
    ["lone \uD800 high", "lone _xD800_ high"],
    ["lone \uDC00 low", "lone _xDC00_ low"],
    ["pair 😀 ok", "pair 😀 ok"],
  ])("%j → %j", (input, expected) => {
    expect(xstring(input)).toBe(expected);
  });

  it("decodes back to the original for every case, as Excel would", () => {
    const samples = ["line1\r\nline2", "ctrl\u0001x", "_x0041_", "_x005F_x0041_", "a & b", "\uFFFF", "_x000D_"];
    for (const s of samples) expect(decodeXstring(unescapeXml(xstring(s)))).toBe(s);
  });

  it("escapes quotes and whitespace in attributes", () => {
    expect(xstringAttr('say "hi"\n')).toBe("say &quot;hi&quot;&#10;");
  });
});

describe("plain XML text", () => {
  it("escapes markup and drops characters XML 1.0 cannot carry", () => {
    expect(xmlText("a<b>&c\u0001d")).toBe("a&lt;b&gt;&amp;cd");
    expect(xmlAttr('x"y\tz\u0000')).toBe("x&quot;y&#9;z");
  });
});

describe("helpers", () => {
  it("needsPreserve detects edge whitespace and newlines", () => {
    expect([" a", "a ", "a\nb", "a\tb", "ab", ""].map(needsPreserve)).toEqual([true, true, true, true, false, false]);
  });
  it("num writes shortest round-trip numbers and turns -0 into 0", () => {
    expect([0, -0, 1.5, 1e21, 1e-7, 0.1 + 0.2].map(num)).toEqual(["0", "0", "1.5", "1e+21", "1e-7", "0.30000000000000004"]);
  });
});
