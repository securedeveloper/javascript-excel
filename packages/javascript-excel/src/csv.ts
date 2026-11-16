/**
 * javascript-excel/csv: CSV parse and serialize (docs/api.md §5.3).
 *
 * RFC 4180 with the usual real-world extensions: delimiter detection, CRLF,
 * LF and CR newlines, a UTF-8 BOM, and lenient recovery from malformed
 * quoting (warnings) unless `mode: 'strict'`. Pulls in nothing from the xlsx
 * code.
 *
 * @module javascript-excel/csv
 */

import type { BinaryInput, BlobType } from "./binary";
import { CsvError, EnvironmentError } from "./errors";
import { decodeBytes } from "./internal/csv/decode";
import { toBytes } from "./internal/input";
import { CsvParser, DEFAULT_MAX_FIELD_BYTES, type ParseConfig } from "./internal/csv/parse";
import { serialize, type WriteConfig } from "./internal/csv/write";
import type { CellInput, CellValue, Sheet } from "./model";
import type { AbortSignalLike } from "./signal";
import type { ExcelWarning } from "./warnings";

export type { BinaryInput, BlobLike, BlobType } from "./binary";
export type { ExcelWarning, ExcelWarningCode } from "./warnings";
export type { AbortSignalLike } from "./signal";
export type {
  Cell,
  CellErrorValue,
  CellInput,
  CellType,
  CellValue,
  ErrorCode,
  RichText,
  RichTextRun,
  Sheet,
  Workbook,
} from "./model";

/** Options for `parseCsv` and `readCsv`. */
export interface CsvParseOptions {
  /** A single character, or `'auto'` (default): picks from `, ; TAB |` by field-count consistency over the first records. */
  delimiter?: string | undefined;
  /** Default `'"'`. A quote inside a quoted field is doubled (RFC 4180). */
  quote?: string | undefined;
  /**
   * Default false: every field is a string. true: unquoted fields that are numbers,
   * `TRUE`/`FALSE` (or `true`/`false`) or ISO 8601 dates become numbers, booleans and
   * `Date`s. No locale guessing. Quoted fields always stay strings.
   */
  inferTypes?: boolean | undefined;
  /** Time zone for ISO dates without an offset when `inferTypes` is on. Default `'local'`. */
  dateZone?: "local" | "utc" | undefined;
  /** Default false. A blank line otherwise gives an empty row (`[]`). */
  skipEmptyLines?: boolean | undefined;
  /** `'lenient'` (default): malformed input gives warnings. `'strict'`: throws `CsvError` (`CSV_MALFORMED`). */
  mode?: "lenient" | "strict" | undefined;
  /** Stop after this many rows, with warning `CSV_ROWS_TRUNCATED`. Default unlimited. */
  maxRows?: number | undefined;
  /** Largest field, in UTF-8 bytes; a bigger one throws `LimitError` (`LIMIT_EXCEEDED`). Default 1,048,576 (1 MiB). */
  maxFieldBytes?: number | undefined;
}

/** Options for `readCsv`. */
export interface CsvReadOptions extends CsvParseOptions {
  /** Used when the bytes have no BOM. Any label `TextDecoder` accepts. Default `'utf-8'`. */
  encoding?: string | undefined;
  /** Rejects with `signal.reason` when aborted. */
  signal?: AbortSignalLike | undefined;
}

/** Result of `parseCsv` and `readCsv`. */
export interface CsvParseResult {
  /** `string[][]` unless `inferTypes`. */
  rows: CellValue[][];
  /** The delimiter used (detected or given). */
  delimiter: string;
  /** The first newline seen; `'\r\n'` when the input has none. */
  newline: "\r\n" | "\n" | "\r";
  /** The input started with a BOM (removed from the data). */
  bom: boolean;
  /** `CSV_UNTERMINATED_QUOTE`, `CSV_STRAY_QUOTE`, `CSV_FIELD_COUNT`, `CSV_INVALID_ENCODING`, `CSV_ROWS_TRUNCATED`. */
  warnings: ExcelWarning[];
}

/** Options for `toCsv` and `toCsvBlob`. */
export interface CsvWriteOptions {
  /** Default `','`. */
  delimiter?: string | undefined;
  /** Default `'\r\n'` (RFC 4180). */
  newline?: "\r\n" | "\n" | undefined;
  /** `'auto'` (default): quote fields containing the delimiter, a quote, CR or LF. `'all'`: quote every field. */
  quote?: "auto" | "all" | undefined;
  /** Prepend a UTF-8 BOM so Excel detects UTF-8. `toCsvBlob` default true, `toCsv` default false. */
  bom?: boolean | undefined;
  /**
   * Formula-injection guard, default true: a string field starting with `=`, `+`, `-`, `@`,
   * TAB or CR gets a leading `'`. Numbers, booleans and dates are never prefixed.
   */
  escapeFormulas?: boolean | undefined;
  /** `'iso'` (default): `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm:ss` (`.sss` when there are milliseconds). Or a function. */
  dates?: "iso" | ((d: Date) => string) | undefined;
  /** Time zone for `'iso'` dates. Default `'local'`. */
  dateZone?: "local" | "utc" | undefined;
  /** Formula cells: the cached value (default) or the formula text (`'formula'`, which still passes the guard). */
  formulas?: "value" | "formula" | undefined;
}

/** MIME type of `toCsvBlob` output. */
export const CSV_MIME = "text/csv;charset=utf-8";

/** Records between yields in `readCsv` are bounded by this many characters. */
const CHUNK_CHARS = 1_048_576;

function parseConfig(options: CsvParseOptions | undefined): ParseConfig {
  const o = options ?? {};
  return {
    delimiter: o.delimiter ?? "auto",
    quote: o.quote ?? '"',
    inferTypes: o.inferTypes ?? false,
    skipEmptyLines: o.skipEmptyLines ?? false,
    strict: (o.mode ?? "lenient") === "strict",
    maxRows: o.maxRows ?? Number.POSITIVE_INFINITY,
    maxFieldBytes: o.maxFieldBytes ?? DEFAULT_MAX_FIELD_BYTES,
    dateZone: o.dateZone ?? "local",
  };
}

function checkMode(options: CsvParseOptions | undefined): void {
  const mode = options?.mode;
  if (mode !== undefined && mode !== "lenient" && mode !== "strict") throw new TypeError(`mode must be 'lenient' or 'strict'`);
  const zone = options?.dateZone;
  if (zone !== undefined && zone !== "local" && zone !== "utc") throw new TypeError(`dateZone must be 'local' or 'utc'`);
}

function result(p: CsvParser, bom: boolean, extra: ExcelWarning[]): CsvParseResult {
  return {
    rows: p.rows,
    delimiter: p.delimiter,
    newline: p.newline ?? "\r\n",
    bom: bom || p.bom,
    warnings: extra.length ? [...extra, ...p.warnings] : p.warnings,
  };
}

/** Parses CSV text synchronously. */
export function parseCsv(text: string, options?: CsvParseOptions): CsvParseResult {
  if (typeof text !== "string") throw new TypeError("parseCsv: text must be a string; use readCsv for bytes");
  checkMode(options);
  const p = new CsvParser(text, parseConfig(options));
  p.run();
  return result(p, false, []);
}

/**
 * Decodes (for bytes) and parses CSV without blocking: it yields to the event
 * loop between chunks of records and honours `signal`.
 */
export async function readCsv(input: string | BinaryInput, options?: CsvReadOptions): Promise<CsvParseResult> {
  checkMode(options);
  const signal = options?.signal;
  throwIfAborted(signal);
  let text: string;
  let bom = false;
  const extra: ExcelWarning[] = [];
  if (typeof input === "string") {
    text = input;
  } else {
    const bytes = await toBytes(input, "readCsv", "a string, ");
    throwIfAborted(signal);
    const label = options?.encoding ?? "utf-8";
    const decoded = decodeBytes(bytes, label);
    text = decoded.text;
    bom = decoded.bom;
    if (decoded.invalid) {
      const message = `Input is not valid ${decoded.encoding}; invalid bytes were replaced with U+FFFD.`;
      if (options?.mode === "strict") {
        throw new CsvError("CSV_MALFORMED", message, { details: { warning: "CSV_INVALID_ENCODING", encoding: decoded.encoding } });
      }
      extra.push({ code: "CSV_INVALID_ENCODING", message });
    }
  }
  const p = new CsvParser(text, parseConfig(options));
  while (!p.done) {
    p.run(p.position + CHUNK_CHARS);
    if (!p.done) {
      await yieldToEventLoop();
      throwIfAborted(signal);
    }
  }
  return result(p, bom, extra);
}

/** Serializes a sheet (A1 to its last used cell) or an array of rows to CSV text. */
export function toCsv(source: Sheet | CellInput[][], options?: CsvWriteOptions): string {
  const text = serialize(source, writeConfig(options));
  return options?.bom === true ? `\uFEFF${text}` : text;
}

/** Like `toCsv`, as a `Blob` of type `text/csv;charset=utf-8`, with a BOM unless `bom: false`. */
export function toCsvBlob(source: Sheet | CellInput[][], options?: CsvWriteOptions): BlobType {
  const Ctor = (globalThis as unknown as { Blob?: new (parts: string[], options: { type: string }) => BlobType }).Blob;
  if (typeof Ctor !== "function") {
    throw new EnvironmentError("ENVIRONMENT_UNSUPPORTED", "Blob is not available in this runtime; use toCsv instead.", { details: { api: "Blob" } });
  }
  const text = serialize(source, writeConfig(options));
  return new Ctor([options?.bom === false ? text : `\uFEFF${text}`], { type: CSV_MIME });
}

function writeConfig(options: CsvWriteOptions | undefined): WriteConfig {
  const o = options ?? {};
  const quote = o.quote ?? "auto";
  if (quote !== "auto" && quote !== "all") throw new TypeError(`quote must be 'auto' or 'all'`);
  return {
    delimiter: o.delimiter ?? ",",
    newline: o.newline ?? "\r\n",
    quoteAll: quote === "all",
    escapeFormulas: o.escapeFormulas ?? true,
    dates: o.dates ?? "iso",
    dateZone: o.dateZone ?? "local",
    formulas: o.formulas ?? "value",
  };
}

function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) throw signal.reason ?? abortError();
}

function abortError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

function yieldToEventLoop(): Promise<void> {
  const st = (globalThis as unknown as { setTimeout?: (fn: () => void, ms: number) => unknown }).setTimeout;
  return new Promise((resolve) => {
    if (typeof st === "function") st(resolve, 0);
    else void Promise.resolve().then(resolve);
  });
}
