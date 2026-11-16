/**
 * A1 address helpers (docs/api.md §4.1). Indices are zero-based.
 */

import { ValidationError } from "./errors";

/** A zero-based cell address. */
export interface CellAddress {
  row: number;
  col: number;
}

/** A range of cells, inclusive. */
export interface RangeAddress {
  start: CellAddress;
  end: CellAddress;
}

/** Rows per sheet in the xlsx format. */
export const MAX_ROWS = 1_048_576;
/** Columns per sheet in the xlsx format (A..XFD). */
export const MAX_COLS = 16_384;

function invalidRef(ref: unknown, why: string): ValidationError {
  return new ValidationError("INVALID_REF", `Invalid reference ${JSON.stringify(ref)}: ${why}.`, { details: { ref } });
}

function checkIndex(n: number, max: number, what: string): void {
  if (!Number.isInteger(n) || n < 0 || n >= max) {
    throw new ValidationError("OUT_OF_BOUNDS", `${what} index ${n} is outside 0..${max - 1}.`, { details: { index: n, max: max - 1 } });
  }
}

/** Column index to letters: 0 → 'A', 16383 → 'XFD'. */
export function encodeCol(col: number): string {
  checkIndex(col, MAX_COLS, "Column");
  let s = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Column letters to index: 'A' → 0, 'XFD' → 16383. Case-insensitive. */
export function decodeCol(letters: string): number {
  if (typeof letters !== "string" || !/^[A-Za-z]{1,3}$/.test(letters)) throw invalidRef(letters, "expected column letters");
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  if (n > MAX_COLS) throw invalidRef(letters, "beyond column XFD");
  return n - 1;
}

/** { row: 0, col: 1 } → 'B1'. */
export function encodeCell(a: CellAddress): string {
  checkIndex(a.row, MAX_ROWS, "Row");
  return encodeCol(a.col) + String(a.row + 1);
}

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})$/;

/** 'B1' or '$B$1' → { row: 0, col: 1 }. */
export function decodeCell(ref: string): CellAddress {
  const m = typeof ref === "string" ? CELL_RE.exec(ref) : null;
  if (!m) throw invalidRef(ref, "expected an A1 cell reference");
  const row = Number(m[2]) - 1;
  if (row >= MAX_ROWS) throw invalidRef(ref, "beyond row 1048576");
  return { row, col: decodeCol(m[1]!) };
}

/** Range to 'A1:C3' (a single cell gives 'A1'). */
export function encodeRange(r: RangeAddress): string {
  const a = encodeCell(r.start);
  const b = encodeCell(r.end);
  return a === b ? a : `${a}:${b}`;
}

/** 'A1:C3' or 'A1' → range, normalised so start is top-left. */
export function decodeRange(ref: string): RangeAddress {
  if (typeof ref !== "string") throw invalidRef(ref, "expected an A1 range");
  const parts = ref.split(":");
  if (parts.length > 2) throw invalidRef(ref, "expected an A1 range");
  const a = decodeCell(parts[0]!);
  const b = parts.length === 2 ? decodeCell(parts[1]!) : a;
  return {
    start: { row: Math.min(a.row, b.row), col: Math.min(a.col, b.col) },
    end: { row: Math.max(a.row, b.row), col: Math.max(a.col, b.col) },
  };
}
