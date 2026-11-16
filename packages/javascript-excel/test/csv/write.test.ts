import { describe, expect, it } from "vitest";
import { CSV_MIME, toCsv, toCsvBlob } from "../../src/csv";
import type { CellInput, Sheet } from "../../src/model";

describe("values", () => {
  it("strings, numbers, booleans, empty cells", () => {
    expect(toCsv([["a", 1, -2.5, true, false, null, undefined, ""]])).toBe("a,1,-2.5,TRUE,FALSE,,,\r\n");
  });
  it("numbers use the shortest round-trip form, never locale formatting", () => {
    expect(toCsv([[0.1 + 0.2, 1e21, 1e-7, -0, 123456789.125]])).toBe("0.30000000000000004,1e+21,1e-7,0,123456789.125\r\n");
  });
  it("NaN and Infinity throw INVALID_NUMBER with the cell ref", () => {
    expect(() => toCsv([[1, Number.NaN]])).toThrow(expect.objectContaining({ code: "INVALID_NUMBER", details: { ref: "B1", value: "NaN" } }));
    expect(() => toCsv([[], [Infinity]])).toThrow(expect.objectContaining({ code: "INVALID_NUMBER" }));
  });
  it("error values as their code, rich text as plain text", () => {
    expect(toCsv([[{ error: "#N/A" }, { richText: [{ text: "Hello " }, { text: "world", font: { bold: true } }] }]])).toBe(
      "#N/A,Hello world\r\n",
    );
  });
  it("Cell objects: value, cached formula value, or formula text", () => {
    const row: CellInput[] = [{ value: "x", style: { font: { bold: true } } }, { formula: "SUM(A1:A2)", value: 3 }, { formula: "A1" }, { style: {} }];
    expect(toCsv([row])).toBe("x,3,,\r\n");
    expect(toCsv([row], { formulas: "formula" })).toBe("x,'=SUM(A1:A2),'=A1,\r\n");
    expect(toCsv([row], { formulas: "formula", escapeFormulas: false })).toBe("x,=SUM(A1:A2),=A1,\r\n");
    expect(toCsv([[{ formula: "=B2" }]], { formulas: "formula", escapeFormulas: false })).toBe("=B2\r\n");
  });
  it("unsupported values throw INVALID_CELL", () => {
    expect(() => toCsv([[Symbol("x") as unknown as CellInput]])).toThrow(expect.objectContaining({ code: "INVALID_CELL" }));
  });
});

describe("dates", () => {
  it("ISO date, or date-time when there is a time of day", () => {
    expect(toCsv([[new Date(Date.UTC(2024, 0, 15)), new Date(Date.UTC(2024, 0, 15, 9, 5, 7)), new Date(Date.UTC(2024, 0, 15, 9, 5, 7, 40))]], { dateZone: "utc" })).toBe(
      "2024-01-15,2024-01-15T09:05:07,2024-01-15T09:05:07.040\r\n",
    );
  });
  it("local zone by default", () => {
    expect(toCsv([[new Date(2024, 5, 1)], [new Date(2024, 5, 1, 13, 0)]])).toBe("2024-06-01\r\n2024-06-01T13:00:00\r\n");
  });
  it("a custom formatter; its output is not run through the guard", () => {
    expect(toCsv([[new Date(Date.UTC(2024, 0, 15))]], { dates: (d) => `-${d.getUTCFullYear()}` })).toBe("-2024\r\n");
  });
  it("invalid Date throws INVALID_DATE", () => {
    expect(() => toCsv([[new Date(Number.NaN)]])).toThrow(expect.objectContaining({ code: "INVALID_DATE", details: { ref: "A1" } }));
  });
});

describe("quoting", () => {
  it("auto: quotes fields containing the delimiter, a quote, CR or LF", () => {
    expect(toCsv([["a,b", 'say "hi"', "x\ny", "x\ry", "plain", " spaced "]])).toBe('"a,b","say ""hi""","x\ny","x\ry",plain, spaced \r\n');
  });
  it("auto quoting follows the chosen delimiter", () => {
    expect(toCsv([["a,b", "c;d"]], { delimiter: ";" })).toBe('a,b;"c;d"\r\n');
    expect(toCsv([["a\tb", "c"]], { delimiter: "\t" })).toBe('"a\tb"\tc\r\n');
  });
  it("all: quotes every field, including empty ones and numbers", () => {
    expect(toCsv([["a", 1, null]], { quote: "all" })).toBe('"a","1",""\r\n');
  });
  it("rejects invalid options", () => {
    expect(() => toCsv([["a"]], { delimiter: "" })).toThrow(TypeError);
    expect(() => toCsv([["a"]], { delimiter: '"' })).toThrow(TypeError);
    expect(() => toCsv([["a"]], { newline: "\r" as "\n" })).toThrow(TypeError);
    expect(() => toCsv([["a"]], { quote: "none" as "all" })).toThrow(TypeError);
  });
});

describe("formula-injection guard (on by default)", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"])("string %j gets a leading '", (s) => {
    const out = toCsv([[s]]);
    expect(out.startsWith("'") || out.startsWith(`"'`)).toBe(true);
  });
  it("exact output, including quoting after the prefix", () => {
    expect(toCsv([["=HYPERLINK(\"http://x\",\"y\")", "-5", "@a,b"]])).toBe(`"'=HYPERLINK(""http://x"",""y"")",'-5,"'@a,b"\r\n`);
    expect(toCsv([["\rtext"]])).toBe(`"'\rtext"\r\n`);
  });
  it("numbers, booleans and dates are never prefixed", () => {
    expect(toCsv([[-5, -0.5, true, new Date(Date.UTC(2024, 0, 1))]], { dateZone: "utc" })).toBe("-5,-0.5,TRUE,2024-01-01\r\n");
  });
  it("cached formula values that are strings pass the guard too", () => {
    expect(toCsv([[{ formula: "A1", value: "=evil" }]])).toBe("'=evil\r\n");
  });
  it("rich text passes the guard", () => {
    expect(toCsv([[{ richText: [{ text: "=1" }, { text: "+2" }] }]])).toBe("'=1+2\r\n");
  });
  it("characters elsewhere in the string are not touched", () => {
    expect(toCsv([["a=b", "x-1", " =1", "'=1"]])).toBe("a=b,x-1, =1,'=1\r\n");
  });
  it("escapeFormulas: false writes strings verbatim", () => {
    expect(toCsv([["=1+1", "-1"]], { escapeFormulas: false })).toBe("=1+1,-1\r\n");
  });
});

describe("sheets and row arrays", () => {
  it("a Sheet is written from A1 to its last used cell, as a rectangle", () => {
    const sheet: Sheet = {
      name: "S",
      rows: [
        ["a", "b"],
        undefined,
        [undefined, undefined, "c"],
        [{ style: { font: { bold: true } } }],
        [],
      ],
    };
    expect(toCsv(sheet)).toBe("a,b,\r\n,,\r\n,,c\r\n");
  });
  it("a Sheet with sparse rows and holes", () => {
    const rows: Sheet["rows"] = [];
    rows[2] = [];
    rows[2][1] = 5;
    expect(toCsv({ name: "S", rows })).toBe(",\r\n,\r\n,5\r\n");
  });
  it("an empty sheet gives an empty string", () => {
    expect(toCsv({ name: "S", rows: [] })).toBe("");
    expect(toCsv({ name: "S", rows: [[null, { style: {} }]] })).toBe("");
  });
  it("row arrays are written as given (ragged rows stay ragged)", () => {
    expect(toCsv([["a", "b", "c"], ["d"], []])).toBe("a,b,c\r\nd\r\n\r\n");
  });
  it("rejects a source that is neither", () => {
    expect(() => toCsv({} as Sheet)).toThrow(TypeError);
  });
});

describe("newline and BOM", () => {
  it("CRLF by default, LF on request, always after the last record", () => {
    expect(toCsv([["a"], ["b"]], { newline: "\n" })).toBe("a\nb\n");
  });
  it("toCsv: no BOM by default", () => {
    expect(toCsv([["a"]]).charCodeAt(0)).toBe(97);
    expect(toCsv([["a"]], { bom: true })).toBe("\uFEFFa\r\n");
  });
  it("toCsvBlob: BOM by default, text/csv;charset=utf-8", async () => {
    const blob = toCsvBlob([["é"]]);
    expect(blob.type).toBe(CSV_MIME);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf, 0xc3, 0xa9, 13, 10]);
    const plain = toCsvBlob([["é"]], { bom: false });
    expect([...new Uint8Array(await plain.arrayBuffer())]).toEqual([0xc3, 0xa9, 13, 10]);
  });
});
