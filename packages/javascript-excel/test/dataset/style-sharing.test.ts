// Builder output shares style objects, so a column style reused across many
// rows hits the writer's identity cache instead of being keyed by content per cell.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromDataset, toUint8Array, type Cell, type Style } from "../../src/index";
import { StyleRegistry } from "../../src/internal/write/style-registry";

afterEach(() => vi.restoreAllMocks());
const styleOf = (c: unknown): Style | undefined => (c as Cell).style;

describe("fromDataset shares style objects", () => {
  const band: Style = { fill: "F2F2F2" };
  const columns = [
    { key: "id" },
    { key: "name", style: { font: { italic: true } } },
    { key: "amt", numFmt: "#,##0.00" },
    { key: "d", type: "date" as const },
  ];
  const rows = (n: number): Array<{ id: number; name: string; amt: number; d: Date }> =>
    Array.from({ length: n }, (_, i) => ({ id: i, name: `n${i}`, amt: i * 1.5, d: new Date(2024, 0, 1 + (i % 365)) }));

  it("one object per column, and one per (column, rowStyle object) with banding", () => {
    const s = fromDataset({ columns, data: rows(10) }, { rowStyle: (_r, i) => (i % 2 ? band : undefined) });
    const [r1, r2, r3, r4] = [s.rows[1]!, s.rows[2]!, s.rows[3]!, s.rows[4]!];
    expect(styleOf(r1[1])).toBe(styleOf(r3[1])); // unbanded rows share the column style
    expect(styleOf(r2[1])).toBe(styleOf(r4[1])); // banded rows share the merged style
    expect(styleOf(r1[1])).not.toBe(styleOf(r2[1]));
    expect(styleOf(r2[1])).toEqual({ font: { italic: true }, fill: "F2F2F2" });
    expect(styleOf(r2[0])).toBe(styleOf(r4[0])); // id column on banded rows: one merged object
    expect(styleOf(r2[0])).toEqual({ fill: "F2F2F2" });
    expect(r1[0]).toBe(0); // no style at all: a bare value
  });

  it("a cell's own style still gets its own merge", () => {
    const s = fromDataset({ columns: [{ key: "a", style: { font: { bold: true } } }], data: [{ a: { value: 1, style: { fill: "FF0000" } } }, { a: 2 }] });
    expect(styleOf(s.rows[1]![0])).toEqual({ font: { bold: true }, fill: "FF0000" });
    expect(styleOf(s.rows[2]![0])).toEqual({ font: { bold: true } });
  });

  it("200,000 styled rows resolve only the distinct styles, without a content key per cell", { timeout: 120_000 }, async () => {
    const sheet = fromDataset({ columns, data: rows(200_000) }, { rowStyle: (_r, i) => (i % 2 ? band : undefined) });
    const resolve = vi.spyOn(StyleRegistry.prototype as unknown as { resolve: () => number }, "resolve");
    const stringify = vi.spyOn(JSON, "stringify");
    await toUint8Array({ sheets: [sheet] });
    // Distinct styles: header bold, italic, number format, date, and each of those banded, plus the band alone.
    expect(resolve.mock.calls.length).toBeLessThanOrEqual(10);
    // Without sharing, every styled cell (600,000 here) would be keyed by JSON.stringify.
    expect(stringify.mock.calls.length).toBeLessThan(1_000);
  });
});
