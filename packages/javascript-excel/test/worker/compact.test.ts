import { describe, expect, it } from "vitest";
import { decodeWorkbook, encodeWorkbook } from "../../src/internal/worker/compact";
import type { CellInput, Style, Workbook } from "../../src/model";
import { toUint8Array } from "../../src/write";

const roundTrip = (wb: Workbook): Workbook => {
  const { message, transfer } = encodeWorkbook(wb);
  // What postMessage does: clone the message, moving the transferred buffers.
  const sent = structuredClone(message, { transfer });
  return decodeWorkbook(sent);
};

const bold: Style = { font: { bold: true } };

describe("compact encoding: decode(encode(x)) equals x", () => {
  it("every kind of cell", () => {
    const sparse: CellInput[] = [];
    sparse[3] = "after a hole";
    const rows: CellInput[][] = [
      [1, -0.5, Number.NaN, Infinity, 1e-300, "", "text", "😀", true, false, null, undefined],
      [new Date(Date.UTC(2024, 0, 15)), new Date(Number.NaN), { value: 1, style: bold }, { value: "s", style: bold }, { value: new Date(0), style: bold }, { style: bold }],
      [{ value: 2 }, { value: undefined, style: bold }, {}, { error: "#N/A" }, { richText: [{ text: "r", font: { italic: true } }] }],
      [{ value: 3, formula: "A1*3" }, { value: "x", hyperlink: "https://example.com" }, { value: 1, style: bold, type: "number" }, { value: { error: "#REF!" }, style: bold }],
      [],
      sparse,
    ];
    const holes: CellInput[][] = [];
    holes[5] = ["row 6"];
    const wb: Workbook = {
      properties: { title: "t", created: new Date(0) },
      definedNames: [{ name: "N", ref: "S!$A$1" }],
      sheets: [
        { name: "S", rows, colProps: [{ width: 10 }], merges: ["A1:B1"], view: { freeze: { rows: 1 } } },
        { name: "Holes", rows: holes },
        { name: "Empty", rows: [] },
      ],
    };
    expect(roundTrip(wb)).toEqual(wb);
  });

  it("equal style literals become one shared object; shared objects stay shared", () => {
    const shared: Style = { fill: "FFFF00" };
    const wb: Workbook = { sheets: [{ name: "S", rows: [[{ value: 1, style: { font: { bold: true } } }, { value: 2, style: { font: { bold: true } } }, { value: 3, style: shared }, { value: 4, style: shared }]] }] };
    const back = roundTrip(wb);
    const r = back.sheets[0]!.rows[0] as Array<{ style: Style }>;
    expect(r[0]!.style).toBe(r[1]!.style);
    expect(r[2]!.style).toBe(r[3]!.style);
    expect(back).toEqual(wb);
  });

  it("styles JSON cannot key faithfully are not merged (undefined fields, non-plain, NaN)", () => {
    class C {
      bold = true;
    }
    const wb: Workbook = {
      sheets: [
        {
          name: "S",
          rows: [[
            { value: 1, style: { font: { bold: true, italic: undefined } } },
            { value: 2, style: { font: { bold: true } } },
            { value: 3, style: { font: new C() as never } },
            { value: 4, style: { font: { size: Number.NaN } } },
            { value: 5, style: { font: { size: Number.NaN } } },
          ]],
        },
      ],
    };
    const back = roundTrip(wb);
    const r = back.sheets[0]!.rows[0] as Array<{ style: Style }>;
    expect(r[0]!.style).not.toBe(r[1]!.style);
    expect(r[3]!.style).not.toBe(r[4]!.style);
    expect(back.sheets[0]!.rows[0]![0]).toEqual({ value: 1, style: { font: { bold: true, italic: undefined } } });
  });

  it("the typed arrays are transferred (detached after sending)", () => {
    const { message, transfer } = encodeWorkbook({ sheets: [{ name: "S", rows: [[1, 2, 3]] }] });
    expect(transfer).toHaveLength(4);
    structuredClone(message, { transfer });
    expect(message.sheets[0]!.num.byteLength).toBe(0);
  });

  it("a sheet whose rows are not row arrays is left to structured clone", () => {
    const odd = { sheets: [{ name: "S", rows: [{ 0: "not an array" }] as never }] } as Workbook;
    expect(roundTrip(odd)).toEqual(odd);
  });

  it("the writer gives identical bytes for the decoded workbook", async () => {
    const rows = Array.from({ length: 300 }, (_, r) => [r, `row ${r}`, { value: r % 3 === 0, style: { font: { bold: r % 2 === 0 } } }, new Date(Date.UTC(2024, 0, 1 + (r % 28)))]);
    const wb: Workbook = { properties: { created: new Date(0), modified: new Date(0) }, sheets: [{ name: "S", rows }] };
    expect(await toUint8Array(roundTrip(wb), { dateZone: "utc" })).toEqual(await toUint8Array(wb, { dateZone: "utc" }));
  });
});
