/**
 * Auto column widths for builders (docs/api.md §4.3, §5.4).
 */

import { cellText } from "./cells";
import { AUTO_WIDTH, textWidth } from "./internal/write/sheet-features";
import type { CellInput } from "./model";

/** Bounds for estimated column widths, in characters. */
export interface AutoWidthOptions {
  /** Default 8.43 (Excel's default width). */
  min?: number | undefined;
  /** Default 60 (a readability choice, not a measurement); at most 255. */
  max?: number | undefined;
  /** Rows measured from the top; default all. */
  sampleRows?: number | undefined;
}

/** Estimated width in characters per column: widest `cellText` + 2 padding, clamped to [min, max]. */
export function autoWidths(rows: ReadonlyArray<ReadonlyArray<CellInput> | undefined>, options: AutoWidthOptions = {}): number[] {
  const min = options.min ?? AUTO_WIDTH.min;
  const max = Math.min(255, options.max ?? AUTO_WIDTH.max);
  const limit = Math.min(rows.length, options.sampleRows ?? rows.length);
  const widest: number[] = [];
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const w = textWidth(cellText(row[c]));
      if (w > (widest[c] ?? 0)) widest[c] = w;
    }
  }
  return Array.from(widest, (w) => Math.min(max, Math.max(min, (w ?? 0) + AUTO_WIDTH.padding)));
}
