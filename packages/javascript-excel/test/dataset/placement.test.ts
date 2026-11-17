/// <reference types="node" />
// fromDatasets block placement (JSE-25): 'below' (default) and 'right'.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromDatasets, toUint8Array, type CellInput, type DatasetBlock, type DatasetOptions, type Sheet } from "../../src/index";

const valueOf = (c: CellInput): unknown => (c !== null && typeof c === "object" && !(c instanceof Date) && "value" in c ? c.value : c);
const values = (s: Sheet): unknown => s.rows.map((r) => (r ? Array.from(r, (c) => (c === undefined ? undefined : valueOf(c))) : r));

// Calls that existed before placement, with negative offsets, gap 0 and header: false.
// Their bytes must not change: the hashes were taken from the writer before JSE-25.
const LEGACY: Array<[string, Array<DatasetBlock<any>>, DatasetOptions<any> & { gap?: number }]> = [
  ["defaults", [{ columns: [{ key: "a" }], data: [{ a: 1 }] }, { columns: [{ key: "b" }, { key: "c" }], data: [{ b: 2, c: 3 }] }], {}],
  [
    "gap, offsets, totals, freeze, filter, widths",
    [
      { columns: [{ title: "A", key: "a", width: 12 }], data: [{ a: 1 }, { a: 2 }] },
      { columns: [{ key: "b", total: "sum", width: "auto" }], data: [{ b: 3 }, { b: 40 }] },
      { columns: [{ key: "c" }], data: [{ c: "long text value" }], offset: { rows: 0, cols: 2 } },
    ],
    { gap: 2, freezeHeader: true, autoFilter: true, autoWidth: true, origin: "B3" },
  ],
  [
    "negative offsets",
    [
      { columns: [{ key: "a" }], data: [{ a: 1 }, { a: 2 }, { a: 3 }] },
      { columns: [{ key: "b" }], data: [{ b: 4 }], offset: { rows: -2, cols: 3 } },
      { columns: [{ key: "c" }], data: [{ c: 5 }], offset: { rows: -1, cols: -1 } },
    ],
    { origin: "C5" },
  ],
  [
    "gap 0, no header, groups",
    [
      { columns: [{ title: "G", children: [{ key: "x" }, { key: "y" }] }], data: [{ x: 1, y: 2 }] },
      { columns: [{ key: "z" }], data: [{ z: 3 }] },
    ],
    { gap: 0, header: false },
  ],
];
const FIXED = new Date(Date.UTC(2024, 0, 1));
const sha = async (s: Sheet): Promise<string> =>
  createHash("sha256").update(await toUint8Array({ properties: { created: FIXED, modified: FIXED }, sheets: [s] })).digest("hex").slice(0, 32);

const LEGACY_SHA: Record<string, string> = {
  defaults: "848784386e4edbb7e115660d561ba232",
  "gap, offsets, totals, freeze, filter, widths": "7ae602007af53388e4960c1141ae3292",
  "negative offsets": "4f7cb51fca0fe36046d4f33f3c16c2e9",
  "gap 0, no header, groups": "8fbe4c46ed36e0cc0836e73d7bed5535",
};

/** Every cell each block writes, as "r,c", so overlaps can be checked. */
function cellsOf(s: Sheet): Set<string> {
  const out = new Set<string>();
  s.rows.forEach((row, r) => row?.forEach((c, col) => c !== undefined && c !== null && out.add(`${r},${col}`)));
  return out;
}

describe("fromDatasets placement: existing calls are unchanged", () => {
  it.each(LEGACY)("%s: same bytes as before, with and without placement: 'below'", async (name, blocks, opts) => {
    expect(await sha(fromDatasets(blocks, opts))).toBe(LEGACY_SHA[name]);
    const explicit = blocks.map((b) => ({ ...b, placement: "below" as const }));
    expect(await sha(fromDatasets(explicit, opts))).toBe(LEGACY_SHA[name]);
  });
});

describe("fromDatasets placement: 'right'", () => {
  it("starts on the previous block's top row, gap columns after its last column", () => {
    const s = fromDatasets([
      { columns: [{ key: "a" }, { key: "b" }], data: [{ a: 1, b: 2 }, { a: 3, b: 4 }] },
      { columns: [{ key: "c" }], data: [{ c: 5 }], placement: "right" },
    ]);
    expect(values(s)).toEqual([
      ["a", "b", undefined, "c"],
      [1, 2, undefined, 5],
      [3, 4],
    ]);
  });

  it("uses the widest row (header groups and totals) as the previous block's last column", () => {
    const s = fromDatasets(
      [
        { columns: [{ title: "G", children: [{ key: "x" }, { key: "y" }, { key: "z", total: "sum" }] }], data: [{ x: 1, y: 2, z: 3 }] },
        { columns: [{ key: "n" }], data: [{ n: 9 }], placement: "right" },
      ],
      { gap: 2 },
    );
    // Three leaf columns (A-C), two gap columns (D-E): the block starts at F, on row 1.
    const v = values(s) as unknown[][];
    expect(v[0]![5]).toBe("n");
    expect(v[1]![5]).toBe(9);
    expect(s.merges).toContain("A1:C1");
  });

  it("offset.cols adds to the gap, offset.rows moves it down from the top row", () => {
    const s = fromDatasets(
      [
        { columns: [{ key: "a" }], data: [{ a: 1 }], offset: { rows: 1 } },
        { columns: [{ key: "b" }], data: [{ b: 2 }], placement: "right", offset: { cols: 2, rows: 1 } },
      ],
      { gap: 0, origin: "B2" },
    );
    // Block 1 at B3 (origin row 2 + offset 1). Block 2: top row 3 + 1 = row 4, column B + 1 + 0 gap + 2 = E.
    expect(values(s)).toEqual([undefined, undefined, [undefined, "a"], [undefined, 1, undefined, undefined, "b"], [undefined, undefined, undefined, undefined, 2]]);
  });

  it("chains: each 'right' block goes after the one before it", () => {
    const s = fromDatasets([
      { columns: [{ key: "a" }], data: [{ a: 1 }] },
      { columns: [{ key: "b" }], data: [{ b: 2 }], placement: "right" },
      { columns: [{ key: "c" }], data: [{ c: 3 }], placement: "right" },
    ]);
    expect(values(s)).toEqual([["a", undefined, "b", undefined, "c"], [1, undefined, 2, undefined, 3]]);
  });

  it("a first block with 'right' starts at the origin", () => {
    expect(values(fromDatasets([{ columns: [{ key: "a" }], data: [{ a: 1 }], placement: "right" }], { origin: "C2" }))).toEqual([undefined, [undefined, undefined, "a"], [undefined, undefined, 1]]);
  });

  it("rejects an unknown placement", () => {
    expect(() => fromDatasets([{ columns: [{ key: "a" }], data: [], placement: "left" as never }])).toThrow(/placement must be 'below' or 'right'/);
  });
});

describe("fromDatasets placement: 'below' after 'right' blocks", () => {
  it("starts gap rows below the lowest block of the row, so blocks never overlap", () => {
    const blocks: Array<DatasetBlock<any>> = [
      { columns: [{ key: "a" }], data: [{ a: 1 }] }, // rows 1-2
      { columns: [{ key: "b" }], data: [{ b: 1 }, { b: 2 }, { b: 3 }, { b: 4 }], placement: "right" }, // rows 1-5, the tallest
      { columns: [{ key: "c", total: "sum" }], data: [{ c: 1 }], placement: "right", offset: { rows: 1 } }, // rows 2-4
      { columns: [{ key: "d" }, { key: "e" }, { key: "f" }], data: [{ d: 1, e: 2, f: 3 }] }, // below: row 7 (after one gap row)
      { columns: [{ key: "g" }], data: [{ g: 1 }], placement: "right" },
      { columns: [{ key: "h" }], data: [{ h: 1 }] },
    ];
    const s = fromDatasets(blocks);
    const v = values(s) as unknown[][];
    expect(v[6]!.slice(0, 5)).toEqual(["d", "e", "f", undefined, "g"]);
    expect(v[5]).toBeUndefined(); // the gap row
    expect(v[9]).toEqual(["h"]);
    // No cell is written twice: the cells add up to the sum of the blocks' sizes.
    const separate = blocks.reduce((n, b) => n + cellsOf(fromDatasets([{ ...b, placement: "below", offset: undefined }])).size, 0);
    expect(cellsOf(s).size).toBe(separate);
  });

  it("keeps the origin column, plus its own offset.cols", () => {
    const s = fromDatasets(
      [
        { columns: [{ key: "a" }], data: [{ a: 1 }] },
        { columns: [{ key: "b" }], data: [{ b: 2 }], placement: "right" },
        { columns: [{ key: "c" }], data: [{ c: 3 }], offset: { cols: 1 } },
      ],
      { origin: "B1", gap: 0 },
    );
    // gap 0: no empty column before the 'right' block and no empty row before the 'below' one.
    expect(values(s)).toEqual([[undefined, "a", "b"], [undefined, 1, 2], [undefined, undefined, "c"], [undefined, undefined, 3]]);
  });
});

describe("fromDatasets placement: freeze, filter and widths", () => {
  it("freeze and filter use the first block with header rows; widths follow the usual rules", () => {
    const s = fromDatasets(
      [
        { columns: [{ key: "a", width: 20 }, { key: "b" }], data: [{ a: 1, b: 2 }, { a: 3, b: 4 }] },
        { columns: [{ key: "c", width: 8 }], data: [{ c: "a longer text value" }], placement: "right" },
        { columns: [{ key: "d", width: 30 }], data: [{ d: 5 }] },
      ],
      { freezeHeader: true, autoFilter: true, autoWidth: true },
    );
    expect(s.view).toEqual({ freeze: { rows: 1 } });
    expect(s.autoFilter).toBe("A1:B3");
    // Column A: the first explicit width (20) wins over block 3's 30. Column D: block 2's own width.
    expect(s.colProps?.[0]?.width).toBe(20);
    expect(s.colProps?.[3]?.width).toBe(8);
  });
});
