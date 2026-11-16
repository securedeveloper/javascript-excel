/**
 * javascript-excel/read: the xlsx reader (docs/api.md §5.2, §8).
 *
 * Parts are found through relationships, never by fixed path; each part is
 * inflated and streamed through the XML tokenizer; zip limits are counted on
 * the inflated bytes. ISO/IEC 29500 Strict files read like transitional ones,
 * because the tokenizer ignores namespace prefixes and relationship types
 * are matched by their last path segment, which both variants share.
 * .xlsm, .xltx and .xltm read like .xlsx; macros are never read or run.
 */

import type { BinaryInput } from "./binary";
import { toBytes } from "./internal/input";
import type { FormatName } from "./internal/read/formats";
import { DEFAULT_LIMITS } from "./internal/read/limits";
import { detectFormatImpl, readImpl, readSheetNamesImpl } from "./internal/read/reader";
import type { Cell, Workbook } from "./model";
import type { AbortSignalLike } from "./signal";
import type { Progress } from "./write";
import type { ExcelWarning } from "./warnings";

export type { BinaryInput, BlobLike, BlobType } from "./binary";
export type { AbortSignalLike } from "./signal";
export type { Progress } from "./write";
export type { ExcelWarning, ExcelWarningCode } from "./warnings";
export type {
  Alignment,
  Border,
  BorderSide,
  BorderStyle,
  Cell,
  CellErrorValue,
  CellInput,
  CellType,
  CellValue,
  Color,
  ColumnProps,
  ColumnWidth,
  DefinedName,
  DocProperties,
  ErrorCode,
  Fill,
  Font,
  GradientFill,
  Hyperlink,
  NumFmt,
  PatternFill,
  PatternType,
  PrintSetup,
  RichText,
  RichTextRun,
  RowProps,
  Sheet,
  SheetView,
  Style,
  Theme,
  Workbook,
} from "./model";

/** Result of `read`. */
export interface ReadResult {
  workbook: Workbook<Cell>;
  warnings: ExcelWarning[];
}

/** Options for `read`. */
export interface ReadOptions {
  /** Only parse these sheets (by name or index); the others are listed with empty rows. Default: all. */
  sheets?: Array<string | number> | undefined;
  /** Parse styles (default true). false is faster: no `cell.style`, but date detection still uses the number format. */
  styles?: boolean | undefined;
  /** Return formula text (default true). false: cached values only. */
  formulas?: boolean | undefined;
  /** `'date'` (default): date-formatted numbers become `Date`. `'serial'`: leave them as numbers. */
  dates?: "date" | "serial" | undefined;
  /** Default `'local'`. */
  dateZone?: "local" | "utc" | undefined;
  /** Rich text as runs (default) or flattened to a plain string. */
  richText?: "runs" | "plain" | undefined;
  limits?: Partial<ReadLimits> | undefined;
  /** Rejects with `signal.reason` when aborted. */
  signal?: AbortSignalLike | undefined;
  onProgress?: ((p: Progress) => void) | undefined;
  /** Called as warnings occur, in addition to `ReadResult.warnings`. */
  onWarning?: ((w: ExcelWarning) => void) | undefined;
}

/** Limits for untrusted input. Exceeding one throws `LimitError` (`LIMIT_EXCEEDED`, `details.limit` names it). */
export interface ReadLimits {
  maxInputBytes: number;
  maxEntries: number;
  /** Decompressed bytes of one part. */
  maxEntryBytes: number;
  /** Decompressed bytes of all parts read. */
  maxTotalBytes: number;
  /** Decompressed / compressed, per entry, checked once an entry has produced more than 1 MiB. */
  maxRatio: number;
  maxXmlDepth: number;
  /** All sheets together. */
  maxCells: number;
  maxSharedStrings: number;
  /** Then a single `WARNINGS_TRUNCATED`. */
  maxWarnings: number;
}

/** Default limits (docs/api.md §5.2; the measurements behind each value are listed there). */
export const DEFAULT_READ_LIMITS: Readonly<ReadLimits> = DEFAULT_LIMITS;

/** A sheet as listed by `readSheetNames`. */
export interface SheetInfo {
  name: string;
  index: number;
  state: "visible" | "hidden" | "veryHidden";
}

/**
 * What `detectFormat` recognises. `'cfb'` is a legacy `.xls` or an encrypted OOXML file.
 * `read` reads xlsx, xlsm, xltx and xltm; the others are rejected with UNSUPPORTED_FORMAT.
 */
export type DetectedFormat = FormatName;

/** Detects the file format from the bytes. Never throws for unreadable input; returns `'unknown'` or `'zip'` instead. */
export async function detectFormat(input: BinaryInput): Promise<DetectedFormat> {
  return detectFormatImpl(await toBytes(input, "detectFormat"));
}

/** Lists the worksheets (name, index, visibility) without parsing any sheet. */
export async function readSheetNames(
  input: BinaryInput,
  options?: { limits?: Partial<ReadLimits> | undefined; signal?: AbortSignalLike | undefined },
): Promise<SheetInfo[]> {
  return readSheetNamesImpl(await toBytes(input, "readSheetNames"), options);
}

/** Reads an .xlsx, .xlsm, .xltx or .xltm file into the model. */
export async function read(input: BinaryInput, options?: ReadOptions): Promise<ReadResult> {
  const { workbook, warnings } = await readImpl(input, options);
  return { workbook, warnings };
}
