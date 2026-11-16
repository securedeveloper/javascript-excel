/**
 * Number formats: the built-in table (docs/api.md §11.2) and date detection
 * (§3.4.1). Exported from the core entry.
 */

import type { NumFmt } from "./model";

/** The built-in number formats ECMA-376 §18.8.30 defines (§11.2). Ids 14–17 and 22 render in the user's locale in Excel. */
export const BUILTIN_NUM_FMTS: Readonly<Record<number, string>> = Object.freeze({
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "mm-dd-yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
});

/** Built-in ids that are dates or times: 14–22, 45 and 47, and the East Asian locale ids 27–36 and 50–58. 46 is `[h]:mm:ss`, a duration. */
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

const cache = new Map<string, boolean>();

/**
 * True when a number format shows a date or a time of day (§3.4.1): built-in
 * ids 14–22, 45, 47, 27–36 and 50–58, or a custom code that contains a date or
 * time token outside quoted text, escapes and brackets. Elapsed-time formats
 * (`[h]:mm:ss`, built-in 46) are durations and return false.
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
