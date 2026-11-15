import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../../src/csv";

// Deterministic PRNG so failures reproduce.
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ["a", "Z", "0", " ", ",", ";", "\t", "|", '"', "'", "\r", "\n", "\r\n", "é", "漢", "😀", "=", "-", "", "x y"];

function randomTable(rnd: () => number): string[][] {
  const width = 1 + Math.floor(rnd() * 5);
  const height = 1 + Math.floor(rnd() * 6);
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => {
      let s = "";
      const n = Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) s += PIECES[Math.floor(rnd() * PIECES.length)];
      return s;
    }),
  );
}

// A one-column row holding "" serialises to an empty line, which reads back
// as an empty row: the one shape CSV itself cannot tell apart.
const ambiguous = (t: string[][]) => t.some((r) => r.length === 1 && r[0] === "");

describe("round trips: parseCsv(toCsv(rows)) == rows", () => {
  for (const delimiter of [",", ";", "\t", "|"] as const) {
    for (const newline of ["\r\n", "\n"] as const) {
      for (const quote of ["auto", "all"] as const) {
        it(`delimiter ${JSON.stringify(delimiter)}, newline ${JSON.stringify(newline)}, quote ${quote}`, () => {
          const rnd = prng(delimiter.charCodeAt(0) * 31 + newline.length * 7 + quote.length);
          let checked = 0;
          for (let n = 0; n < 300; n++) {
            const table = randomTable(rnd);
            if (ambiguous(table)) continue;
            const text = toCsv(table, { delimiter, newline, quote, escapeFormulas: false });
            const back = parseCsv(text, { delimiter, mode: "strict" });
            expect(back.rows).toEqual(table);
            checked++;
          }
          expect(checked).toBeGreaterThan(200);
        });
      }
    }
  }

  it("delimiter detection recovers the delimiter of consistent tables", () => {
    const rnd = prng(7);
    for (const delimiter of [",", ";", "\t", "|"]) {
      const table = Array.from({ length: 5 }, (_, r) => Array.from({ length: 4 }, (_, c) => `r${r}c${c}${PIECES[Math.floor(rnd() * 4)]}`));
      const text = toCsv(table, { delimiter });
      expect(parseCsv(text).delimiter).toBe(delimiter);
    }
  });

  it("typed values round-trip with inferTypes", () => {
    const rows = [[1, -2.5, 0.1 + 0.2, 1e21, true, false, new Date(Date.UTC(2024, 1, 29)), new Date(Date.UTC(2024, 1, 29, 23, 59, 59, 999)), "text"]];
    const text = toCsv(rows, { dateZone: "utc" });
    expect(parseCsv(text, { inferTypes: true, dateZone: "utc" }).rows).toEqual(rows);
  });

  it("BOM round trip", () => {
    const r = parseCsv(toCsv([["a", "b"]], { bom: true }));
    expect(r).toMatchObject({ bom: true, rows: [["a", "b"]] });
  });

  it("guarded strings read back with their prefix (the guard is one-way by design)", () => {
    expect(parseCsv(toCsv([["=1", "-1", "ok"]])).rows).toEqual([["'=1", "'-1", "ok"]]);
  });
});
