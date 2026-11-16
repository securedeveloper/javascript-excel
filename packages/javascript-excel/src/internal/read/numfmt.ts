/**
 * Date detection from number formats (docs/api.md §3.4.1). Internal.
 */

import type { NumFmt } from "../../model";

/** Built-in ids that are dates or times: 14–22, 45 and 47, and the East Asian locale ids 27–36 and 50–58. 46 is `[h]:mm:ss`, a duration. */
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

const cache = new Map<string, boolean>();

/**
 * True when a number format shows a date or a time of day.
 * Elapsed-time formats (`[h]:mm:ss`) are durations and return false.
 */
export function isDateFormat(fmt: NumFmt | undefined): boolean {
  if (fmt === undefined) return false;
  if (typeof fmt === "number") return DATE_IDS.has(fmt);
  let hit = cache.get(fmt);
  if (hit === undefined) {
    hit = detect(fmt);
    if (cache.size < 1000) cache.set(fmt, hit);
  }
  return hit;
}

function detect(code: string): boolean {
  // First section only (positive numbers); later sections rarely differ in kind.
  let s = "";
  let inQuote = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (inQuote) {
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      continue;
    }
    if (ch === "\\" || ch === "_" || ch === "*") {
      i++; // escaped literal, space-width or fill character
      continue;
    }
    if (ch === ";") break;
    if (ch === "[") {
      const end = code.indexOf("]", i + 1);
      if (end === -1) break;
      const inner = code.slice(i + 1, end).toLowerCase();
      if (/^(h+|m+|s+)$/.test(inner)) return false; // elapsed time: a duration, not a date
      i = end;
      continue;
    }
    s += ch;
  }
  s = s.replace(/general/gi, "").replace(/e[+-]/gi, "");
  return /[ymdhs]|am\/pm|a\/p|[egb]/i.test(s);
}
