/**
 * Cell helpers (docs/api.md §4.2).
 */

import { isoDate } from "./internal/iso-date";
import type { Cell, CellInput, CellValue } from "./model";

/** Options for `cellText`. */
export interface CellTextOptions {
  /** Fields used for dates. Default 'local'. */
  dateZone?: "local" | "utc" | undefined;
}

function valueText(v: CellValue | null | undefined, zone: "local" | "utc"): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? isoDate(v, zone) : "";
  if (typeof v === "object" && "error" in v) return String(v.error);
  if (typeof v === "object" && "richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
  return "";
}

/**
 * Plain text of a cell: strings as they are, numbers as `String(n)`, booleans
 * as TRUE/FALSE, dates as ISO 8601, errors as their code, rich text joined.
 * A formula cell gives its cached value's text ('' when there is none).
 * Number formats are not applied.
 */
export function cellText(cell: CellInput, options?: CellTextOptions): string {
  const zone = options?.dateZone ?? "local";
  if (cell === null || cell === undefined) return "";
  if (typeof cell !== "object" || cell instanceof Date || "error" in cell || "richText" in cell) {
    return valueText(cell as CellValue, zone);
  }
  return valueText((cell as Cell).value, zone);
}
