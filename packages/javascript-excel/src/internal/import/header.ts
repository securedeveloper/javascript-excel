/**
 * Header row detection for javascript-excel/import (docs/api.md §5.6,
 * "Header detection"). Deterministic: no scores or weights.
 */

import { decodeRange } from "../../address";
import type { CellInput, Sheet } from "../../model";
import { dateParts, parseBoolean, parseNumber, type NumberGroup } from "./parse";
import { parseIsoDate } from "../csv/infer";

export interface ImportLocale {
  decimal?: "." | "," | undefined;
  group?: NumberGroup | undefined;
  dateOrder?: "auto" | "YMD" | "DMY" | "MDY" | undefined;
}

export interface DetectHeaderOptions {
  range?: string | undefined;
  /** Rows scanned from the top of the range. Default 25 (a choice, not a measurement). */
  maxScan?: number | undefined;
  locale?: ImportLocale | undefined;
}

export interface HeaderDetection {
  /** Zero-based sheet rows of the header, top to bottom. */
  rows: number[];
  confidence: "high" | "low";
}

export const DEFAULT_MAX_SCAN = 25;
/** Rows below a header candidate that are checked for non-text values. */
const LOOKAHEAD = 5;

type Kind = 0 | 1 | 2; // empty, text, other

interface Range {
  start: { row: number; col: number };
  end: { row: number; col: number };
}

function usedRange(sheet: Sheet<CellInput>): Range | undefined {
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  sheet.rows.forEach((row, r) =>
    row?.forEach((c, col) => {
      if (c === undefined || c === null) return;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (col < minC) minC = col;
      if (col > maxC) maxC = col;
    }),
  );
  return maxR < 0 ? undefined : { start: { row: minR, col: minC }, end: { row: maxR, col: maxC } };
}

/** Text that reads as a number, boolean or date under the locale counts as "other". */
function textKind(text: string, locale: ImportLocale): Kind {
  const s = text.trim();
  if (s === "") return 0;
  if (parseNumber(s, { decimal: locale.decimal ?? ".", group: locale.group ?? "" }) !== undefined) return 2;
  if (parseBoolean(s) !== undefined) return 2;
  if (s.length >= 10 && s.charCodeAt(4) === 45 && parseIsoDate(s, "utc")) return 2;
  if (dateParts(s)) return 2;
  return 1;
}

export function cellKind(c: CellInput | undefined, locale: ImportLocale): Kind {
  if (c === undefined || c === null) return 0;
  if (typeof c === "string") return textKind(c, locale);
  if (typeof c === "number" || typeof c === "boolean" || c instanceof Date) return 2;
  if (typeof c === "object") {
    if ("error" in c) return 2;
    if ("richText" in c) return textKind(c.richText.map((r) => r.text).join(""), locale);
    const v = (c as { value?: unknown }).value;
    if (v === undefined || v === null) return (c as { formula?: string }).formula ? 2 : 0;
    return cellKind(v as CellInput, locale);
  }
  return 1;
}

export function detectHeader(sheet: Sheet<CellInput>, options: DetectHeaderOptions = {}): HeaderDetection {
  const maxScan = options.maxScan ?? DEFAULT_MAX_SCAN;
  if (!Number.isInteger(maxScan) || maxScan < 1) throw new TypeError(`maxScan must be a positive integer, got ${String(maxScan)}`);
  const locale = options.locale ?? {};
  const rng = options.range ? decodeRange(options.range) : sheet.dimension ? decodeRange(sheet.dimension) : usedRange(sheet);
  if (!rng) return { rows: [0], confidence: "low" };
  const top = rng.start.row;
  const last = Math.min(rng.end.row, top + maxScan - 1);
  const width = rng.end.col - rng.start.col + 1;
  const merges = (sheet.merges ?? []).map((m) => decodeRange(m)).filter((m) => m.start.row <= last && m.end.row >= top);

  interface RowInfo {
    r: number;
    kinds: Kind[];
    filled: number;
    nonEmpty: number;
    allText: boolean;
    fullWidthMerge: boolean;
  }
  const rows: RowInfo[] = [];
  for (let r = top; r <= last; r++) {
    const row = sheet.rows[r];
    const kinds: Kind[] = [];
    let filled = 0;
    let nonEmpty = 0;
    let other = 0;
    for (let c = rng.start.col; c <= rng.end.col; c++) {
      const k = cellKind(row?.[c], locale);
      kinds.push(k);
      if (k !== 0) {
        nonEmpty++;
        filled++;
        if (k === 2) other++;
      } else if (merges.some((m) => r >= m.start.row && r <= m.end.row && c >= m.start.col && c <= m.end.col && (r !== m.start.row || c !== m.start.col))) {
        filled++; // covered by a merged cell
      }
    }
    const fullWidthMerge = width > 1 && merges.some((m) => m.start.row === r && m.start.col <= rng.start.col && m.end.col >= rng.end.col);
    rows.push({ r, kinds, filled, nonEmpty, allText: nonEmpty > 0 && other === 0, fullWidthMerge });
  }

  // Table width: the most common filled count among rows with more than one filled cell.
  const counts = new Map<number, number>();
  for (const x of rows) if (x.filled > 1) counts.set(x.filled, (counts.get(x.filled) ?? 0) + 1);
  let tableWidth = 1;
  let best = 0;
  for (const [w, n] of counts) if (n > best || (n === best && w > tableWidth)) [tableWidth, best] = [w, n];

  const isTitle = (x: RowInfo): boolean => (tableWidth > 1 && x.filled <= 1) || x.fullWidthMerge;
  const candidates = rows.filter((x) => x.nonEmpty > 0 && !isTitle(x));

  const hasOtherBelow = (idx: number): boolean => {
    const x = rows[idx]!;
    let seen = 0;
    for (let j = idx + 1; j < rows.length && seen < LOOKAHEAD; j++) {
      const y = rows[j]!;
      if (y.nonEmpty === 0) continue;
      seen++;
      for (let k = 0; k < width; k++) if (x.kinds[k] === 1 && y.kinds[k] === 2) return true;
    }
    return false;
  };

  let header: RowInfo | undefined;
  let confidence: "high" | "low" = "low";
  for (const x of candidates) {
    if (x.allText && x.filled >= tableWidth && hasOtherBelow(rows.indexOf(x))) {
      header = x;
      confidence = "high";
      break;
    }
  }
  if (!header) header = candidates.find((x) => x.allText && x.filled >= tableWidth);
  if (!header) return { rows: [top], confidence: "low" };

  // Multi-row headers: a text row joins the row below it when it merges down
  // into that row (a vertically merged "Name") or holds a group merge
  // narrower than the table (a "Q1" over its months).
  const joinsBelow = (x: RowInfo): boolean =>
    merges.some((m) => m.start.row === x.r && m.end.row > x.r) ||
    merges.some((m) => m.start.row === x.r && m.end.row === x.r && m.end.col > m.start.col && !(m.start.col <= rng.start.col && m.end.col >= rng.end.col));
  const result = [header.r];
  let at = rows.indexOf(header);
  while (at + 1 < rows.length && joinsBelow(rows[at]!) && rows[at + 1]!.allText && rows[at + 1]!.r === rows[at]!.r + 1) {
    at++;
    result.push(rows[at]!.r);
  }
  for (let i = rows.indexOf(header) - 1; i >= 0; i--) {
    const x = rows[i]!;
    if (!x.allText || x.fullWidthMerge || !joinsBelow(x)) break;
    result.unshift(x.r);
  }
  return { rows: result, confidence };
}
