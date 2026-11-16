// The writer's content-keyed style cache (JSE-8) must not change results or skip validation.
import { describe, expect, it } from "vitest";
import type { CellInput, Style } from "../../src/model";
import { read } from "../../src/read";
import { openZip } from "../../src/internal/zip/read";
import { toUint8Array } from "../../src/write";

const write = (rows: CellInput[][]) => toUint8Array({ properties: { created: new Date(0), modified: new Date(0) }, sheets: [{ name: "S", rows }] });

describe("style cache", () => {
  it("fresh but equal style objects give the same bytes as one shared object", async () => {
    const shared: Style = { font: { bold: true, color: "FF0000" }, numFmt: "0.00" };
    const a = await write(Array.from({ length: 50 }, (_, i) => [{ value: i, style: shared }]));
    const b = await write(Array.from({ length: 50 }, (_, i) => [{ value: i, style: { font: { bold: true, color: "FF0000" }, numFmt: "0.00" } }]));
    expect(b).toEqual(a);
    const { workbook } = await read(b);
    expect(workbook.sheets[0]!.rows[49]![0]!.style).toBe(workbook.sheets[0]!.rows[0]![0]!.style);
  });

  it.each([
    ["NaN size", { font: { size: Number.NaN } }],
    ["Infinity size", { font: { size: Number.POSITIVE_INFINITY } }],
    ["function flag", { font: { bold: (() => true) as unknown as boolean } }],
    ["symbol colour", { font: { color: Symbol("c") as unknown as string } }],
  ])("an invalid style is still rejected after a valid one that JSON would confuse it with (%s)", async (_name, bad) => {
    await expect(write([[{ value: 1, style: { font: {} } }], [{ value: 2, style: { font: { size: 11 } } }], [{ value: 3, style: bad as Style }]])).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  it("date cells and non-date cells with the same style get different formats", async () => {
    const { workbook } = await read(await write([[{ value: 1, style: { font: { bold: true } } }, { value: new Date(Date.UTC(2024, 0, 1)), style: { font: { bold: true } } }]]));
    const [n, d] = workbook.sheets[0]!.rows[0]!;
    expect(n!.style!.numFmt).toBeUndefined();
    expect(d!.style!.numFmt).toBe(14);
  });

  it("the identity cache stays bounded with a fresh style per cell", async () => {
    const rows = Array.from({ length: 30_000 }, (_, i) => [{ value: i, style: { font: { bold: i % 2 === 0 } } }]);
    const { workbook } = await read(await write(rows));
    expect(workbook.sheets[0]!.rows[29_999]![0]!.style?.font?.bold).toBeUndefined(); // 29,999 is odd: not bold
    expect(workbook.sheets[0]!.rows[29_998]![0]!.style?.font?.bold).toBe(true);
  });
});

describe("content cache only keys plain objects", () => {
  const xml = async (cells: unknown[]): Promise<string> => {
    const zip = openZip(await toUint8Array({ sheets: [{ name: "S", rows: [cells as never] }] }));
    return new TextDecoder().decode(await zip.read("xl/worksheets/sheet1.xml"));
  };

  it("an invalid toJSON colour still throws, even after the valid colour it serialises to was cached", async () => {
    // JSON applies toJSON, so this object would share the key of "FF0000" and skip validation.
    await expect(xml([{ value: "red", style: { font: { color: "FF0000" } } }, { value: "x", style: { font: { color: { toJSON: () => "FF0000" } } } }])).rejects.toMatchObject({ code: "INVALID_STYLE" });
  });

  it("a class-instance colour is resolved as it is, every time", async () => {
    class Rgb {
      get rgb(): string {
        return "FFFF0000";
      }
    }
    const x = await xml([{ value: "a", style: { font: { color: new Rgb() } } }, { value: "b", style: { font: { color: new Rgb() } } }, { value: "c", style: { font: { color: "FF0000" } } }]);
    // All three are the same red: one xf.
    expect(x).toContain('<c r="A1" s="1" t="s">');
    expect(x).toContain('<c r="B1" s="1" t="s">');
    expect(x).toContain('<c r="C1" s="1" t="s">');
  });
});
