import { describe, expect, it } from "vitest";
import { isExcelError } from "../../src/errors";
import { parseCsv } from "../../src/csv";

const rows = (text: string, opts?: Parameters<typeof parseCsv>[1]) => parseCsv(text, opts).rows;
const codes = (text: string, opts?: Parameters<typeof parseCsv>[1]) => parseCsv(text, opts).warnings.map((w) => w.code);

describe("RFC 4180 (section 2) vectors", () => {
  it("1. records separated by CRLF", () => {
    expect(rows("aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n")).toEqual([
      ["aaa", "bbb", "ccc"],
      ["zzz", "yyy", "xxx"],
    ]);
  });
  it("2. last record may lack a line break", () => {
    expect(rows("aaa,bbb,ccc\r\nzzz,yyy,xxx")).toEqual([
      ["aaa", "bbb", "ccc"],
      ["zzz", "yyy", "xxx"],
    ]);
  });
  it("3. header line is an ordinary record", () => {
    expect(rows("field_name,field_name,field_name\r\naaa,bbb,ccc\r\n")[0]).toEqual(["field_name", "field_name", "field_name"]);
  });
  it("4. spaces are part of a field; no trailing comma means no extra field", () => {
    expect(rows("aaa , bbb,ccc ")).toEqual([["aaa ", " bbb", "ccc "]]);
  });
  it("5. fields may be quoted", () => {
    expect(rows('"aaa","bbb","ccc"\r\nzzz,yyy,xxx')).toEqual([
      ["aaa", "bbb", "ccc"],
      ["zzz", "yyy", "xxx"],
    ]);
  });
  it("6. quoted fields may contain CRLF, commas and quotes", () => {
    expect(rows('"aaa","b\r\nbb","ccc"\r\nzzz,yyy,xxx')).toEqual([
      ["aaa", "b\r\nbb", "ccc"],
      ["zzz", "yyy", "xxx"],
    ]);
    expect(rows('"a,b",c')).toEqual([["a,b", "c"]]);
  });
  it("7. a quote inside a quoted field is doubled", () => {
    expect(rows('"aaa","b""bb","ccc"')).toEqual([["aaa", 'b"bb', "ccc"]]);
    expect(rows('""""')).toEqual([['"']]);
  });
});

describe("fields and records", () => {
  it("empty fields, quoted empty fields and a trailing delimiter", () => {
    expect(rows(",,\r\n")).toEqual([["", "", ""]]);
    expect(rows('"",a,""')).toEqual([["", "a", ""]]);
    expect(rows("a,b,")).toEqual([["a", "b", ""]]);
    expect(rows("a,b,\r\nc,d,\r\n")).toEqual([
      ["a", "b", ""],
      ["c", "d", ""],
    ]);
  });
  it("a blank line is an empty row unless skipEmptyLines", () => {
    expect(rows("a\r\n\r\nb\r\n")).toEqual([["a"], [], ["b"]]);
    expect(rows("a\r\n\r\nb\r\n", { skipEmptyLines: true })).toEqual([["a"], ["b"]]);
    expect(rows("")).toEqual([]);
    expect(rows("\r\n")).toEqual([[]]);
  });
  it("a blank line does not count as a field-count mismatch", () => {
    expect(codes("a,b\r\n\r\nc,d\r\n")).toEqual([]);
  });
  it("Unicode, including astral characters, passes through", () => {
    expect(rows("é,漢字,😀\n")).toEqual([["é", "漢字", "😀"]]);
  });
});

describe("newlines", () => {
  it("CRLF, LF and CR all separate records; the first one seen is reported", () => {
    expect(parseCsv("a\r\nb\nc\rd")).toMatchObject({ rows: [["a"], ["b"], ["c"], ["d"]], newline: "\r\n" });
    expect(parseCsv("a\nb\r\n").newline).toBe("\n");
    expect(parseCsv("a\rb\r").newline).toBe("\r");
    expect(parseCsv("a,b").newline).toBe("\r\n");
  });
  it("quoted fields keep their newlines verbatim", () => {
    expect(rows('"x\ny","x\ry","x\r\ny"\n')).toEqual([["x\ny", "x\ry", "x\r\ny"]]);
  });
});

describe("BOM", () => {
  it("a leading U+FEFF is removed and reported", () => {
    const r = parseCsv("\uFEFFa,b\r\n");
    expect(r.rows).toEqual([["a", "b"]]);
    expect(r.bom).toBe(true);
    expect(parseCsv("a,b").bom).toBe(false);
  });
  it("a BOM before a quoted first field", () => {
    expect(rows('\uFEFF"a",b')).toEqual([["a", "b"]]);
  });
});

describe("delimiter", () => {
  it("auto-detects , ; TAB and |", () => {
    expect(parseCsv("a,b,c\n1,2,3\n").delimiter).toBe(",");
    expect(parseCsv("a;b;c\n1;2;3\n").delimiter).toBe(";");
    expect(parseCsv("a\tb\tc\n1\t2\t3\n").delimiter).toBe("\t");
    expect(parseCsv("a|b|c\n1|2|3\n").delimiter).toBe("|");
  });
  it("detection is quote-aware and prefers consistent field counts", () => {
    // Commas only inside quotes; semicolons separate.
    expect(parseCsv('"1,5";"2,5"\n"3,5";"4,5"\n').delimiter).toBe(";");
    // European number format: decimal commas, semicolon delimiter.
    const r = parseCsv("name;price\nTea;1,50\nCoffee;2,75\n");
    expect(r.delimiter).toBe(";");
    expect(r.rows).toEqual([
      ["name", "price"],
      ["Tea", "1,50"],
      ["Coffee", "2,75"],
    ]);
  });
  it("falls back to , for a single column", () => {
    expect(parseCsv("a\nb\n").delimiter).toBe(",");
  });
  it("an explicit delimiter is used as given", () => {
    expect(parseCsv("a;b,c", { delimiter: "," })).toMatchObject({ delimiter: ",", rows: [["a;b", "c"]] });
  });
  it("rejects invalid delimiter and quote options", () => {
    expect(() => parseCsv("a", { delimiter: ",," })).toThrow(TypeError);
    expect(() => parseCsv("a", { delimiter: "\n" })).toThrow(TypeError);
    expect(() => parseCsv("a", { delimiter: '"' })).toThrow(TypeError);
    expect(() => parseCsv("a", { quote: "" })).toThrow(TypeError);
  });
  it("a custom quote character", () => {
    expect(rows("'a,b','it''s'", { quote: "'" })).toEqual([["a,b", "it's"]]);
  });
});

describe("malformed input, lenient mode (default)", () => {
  it("unterminated quote: field runs to the end, CSV_UNTERMINATED_QUOTE", () => {
    const r = parseCsv('a,"bc\nd,e');
    expect(r.rows).toEqual([["a", "bc\nd,e"]]);
    expect(r.warnings).toMatchObject([{ code: "CSV_UNTERMINATED_QUOTE", ref: "B1" }]);
  });
  it("quote inside an unquoted field is kept, CSV_STRAY_QUOTE", () => {
    const r = parseCsv('ab"cd,e');
    expect(r.rows).toEqual([['ab"cd', "e"]]);
    expect(r.warnings).toMatchObject([{ code: "CSV_STRAY_QUOTE", ref: "A1" }]);
  });
  it("text after a closing quote is appended (like Python's csv), CSV_STRAY_QUOTE", () => {
    const r = parseCsv('"ab"cd,e\n');
    expect(r.rows).toEqual([["abcd", "e"]]);
    expect(r.warnings.map((w) => w.code)).toEqual(["CSV_STRAY_QUOTE"]);
  });
  it("field-count mismatch: CSV_FIELD_COUNT with the row's ref", () => {
    const r = parseCsv("a,b,c\n1,2\n3,4,5,6\n");
    expect(r.rows).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
      ["3", "4", "5", "6"],
    ]);
    expect(r.warnings).toMatchObject([
      { code: "CSV_FIELD_COUNT", ref: "A2" },
      { code: "CSV_FIELD_COUNT", ref: "A3" },
    ]);
  });
  it("line numbers in messages count newlines inside quoted fields", () => {
    const r = parseCsv('a,b\n"x\ny",z\n1\n');
    expect(r.warnings[0]!.message).toContain("line 4");
  });
  it("warnings are capped, with one WARNINGS_TRUNCATED at the end", () => {
    const text = "a,b\n" + "1\n".repeat(1500);
    const w = parseCsv(text).warnings;
    expect(w).toHaveLength(1001);
    expect(w.at(-1)!.code).toBe("WARNINGS_TRUNCATED");
    expect(w.at(-1)!.message).toContain("500");
  });
});

describe("strict mode", () => {
  const strict = { mode: "strict" } as const;
  it.each([
    ['a,"bc', "CSV_UNTERMINATED_QUOTE"],
    ['ab"c', "CSV_STRAY_QUOTE"],
    ['"ab"c', "CSV_STRAY_QUOTE"],
    ["a,b\n1\n", "CSV_FIELD_COUNT"],
  ])("%j throws CSV_MALFORMED (%s)", (text, warning) => {
    let err: unknown;
    try {
      parseCsv(text, strict);
    } catch (e) {
      err = e;
    }
    expect(isExcelError(err)).toBe(true);
    expect(err).toMatchObject({ name: "CsvError", code: "CSV_MALFORMED", details: { warning } });
  });
  it("valid input parses the same as lenient", () => {
    const text = 'a,"b,""c"""\r\n1,2\r\n';
    expect(parseCsv(text, strict).rows).toEqual(parseCsv(text).rows);
  });
  it("rejects an unknown mode", () => {
    expect(() => parseCsv("a", { mode: "loose" as "strict" })).toThrow(TypeError);
  });
});

describe("limits", () => {
  it("maxRows stops reading and warns CSV_ROWS_TRUNCATED (not malformed, also in strict mode)", () => {
    const r = parseCsv("1\n2\n3\n4\n", { maxRows: 2, mode: "strict" });
    expect(r.rows).toEqual([["1"], ["2"]]);
    expect(r.warnings.map((w) => w.code)).toEqual(["CSV_ROWS_TRUNCATED"]);
    expect(parseCsv("1\n2\n", { maxRows: 2 }).warnings).toEqual([]);
  });
  it("maxFieldBytes throws LimitError, counting UTF-8 bytes", () => {
    expect(() => parseCsv("abcd,e", { maxFieldBytes: 3 })).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED", name: "LimitError" }));
    // "éé" is 4 UTF-8 bytes in 2 code units.
    expect(() => parseCsv("éé", { maxFieldBytes: 3 })).toThrow(expect.objectContaining({ details: expect.objectContaining({ limit: "maxFieldBytes", value: 4, max: 3, ref: "A1" }) }));
    expect(parseCsv("éé", { maxFieldBytes: 4 }).rows).toEqual([["éé"]]);
  });
  it("an unterminated quote over a huge input hits maxFieldBytes instead of building a giant field", () => {
    expect(() => parseCsv('"' + "x".repeat(2_000_000))).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });
});

describe("inferTypes", () => {
  const infer = (text: string, zone: "local" | "utc" = "utc") => parseCsv(text, { inferTypes: true, dateZone: zone }).rows[0];
  it("numbers", () => {
    expect(infer("1,-2,+3,0.5,.5,-0.25,1e3,2.5E-2,0")).toEqual([1, -2, 3, 0.5, 0.5, -0.25, 1000, 0.025, 0]);
  });
  it("keeps text that would not survive as a number", () => {
    expect(infer("007,1.,1 000,1,5,0x10,Infinity,NaN,12345678901234567890, 1")).toEqual([
      "007",
      "1.",
      "1 000",
      1,
      5,
      "0x10",
      "Infinity",
      "NaN",
      "12345678901234567890",
      " 1",
    ]);
  });
  it("booleans", () => {
    expect(infer("TRUE,FALSE,true,false,True,yes")).toEqual([true, false, true, false, "True", "yes"]);
  });
  it("ISO 8601 dates and date-times", () => {
    expect(infer("2024-01-15,2024-01-15T10:30,2024-01-15T10:30:05.123Z,2024-01-15 10:30:05+02:00")).toEqual([
      new Date(Date.UTC(2024, 0, 15)),
      new Date(Date.UTC(2024, 0, 15, 10, 30)),
      new Date(Date.UTC(2024, 0, 15, 10, 30, 5, 123)),
      new Date(Date.UTC(2024, 0, 15, 8, 30, 5)),
    ]);
  });
  it("dates without an offset use dateZone (default local)", () => {
    expect(infer("2024-01-15T10:30", "local")).toEqual([new Date(2024, 0, 15, 10, 30)]);
    expect(parseCsv("2024-01-15", { inferTypes: true }).rows[0]).toEqual([new Date(2024, 0, 15)]);
  });
  it("rejects impossible or non-ISO dates", () => {
    expect(infer("2024-02-30,2023-02-29,2024-13-01,15/01/2024,2024-1-5,2024-01-15T25:00")).toEqual([
      "2024-02-30",
      "2023-02-29",
      "2024-13-01",
      "15/01/2024",
      "2024-1-5",
      "2024-01-15T25:00",
    ]);
    expect(infer("2024-02-29")).toEqual([new Date(Date.UTC(2024, 1, 29))]);
  });
  it("quoted fields and empty fields stay strings", () => {
    expect(infer('"1","TRUE","2024-01-15",,x')).toEqual(["1", "TRUE", "2024-01-15", "", "x"]);
  });
  it("off by default: everything is a string", () => {
    expect(rows("1,TRUE,2024-01-15")).toEqual([["1", "TRUE", "2024-01-15"]]);
  });
});

describe("robustness", () => {
  it("never throws in lenient mode on random input", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const alphabet = ['"', ",", ";", "\r", "\n", "a", " ", "\t", "\uFEFF", "é"];
    for (let n = 0; n < 2000; n++) {
      let s = "";
      const len = Math.floor(rnd() * 40);
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const r = parseCsv(s);
      expect(Array.isArray(r.rows)).toBe(true);
    }
  });
  it("is linear on pathological input (many quotes)", () => {
    const text = '"' + '""'.repeat(400_000) + '"';
    const t0 = Date.now();
    expect(parseCsv(text).rows[0]![0]).toHaveLength(400_000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
