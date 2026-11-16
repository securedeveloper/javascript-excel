/** Reader limit defaults, re-exported as DEFAULT_READ_LIMITS from /read. Internal. */

import type { ReadLimits } from "../../read";

/** Default limits (docs/api.md §5.2; the measurements behind each value are listed there). */
export const DEFAULT_LIMITS: Readonly<ReadLimits> = Object.freeze({
  maxInputBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxRatio: 1000,
  maxXmlDepth: 64,
  maxCells: 10_000_000,
  maxSharedStrings: 5_000_000,
  maxWarnings: 1000,
});

