/**
 * Typed errors (docs/api.md §7).
 *
 * Check errors with `isExcelError(err)` or `err.code`, not `instanceof`: when an
 * app ends up with both the ESM and the CJS build, each has its own classes.
 */

/** Every error code the library throws. */
export type ExcelErrorCode =
  // ValidationError
  | "NO_SHEETS"
  | "INVALID_SHEET_NAME"
  | "DUPLICATE_SHEET_NAME"
  | "INVALID_ACTIVE_SHEET"
  | "INVALID_REF"
  | "OUT_OF_BOUNDS"
  | "INVALID_CELL"
  | "INVALID_NUMBER"
  | "INVALID_DATE"
  | "STRING_TOO_LONG"
  | "INVALID_STYLE"
  | "INVALID_NUMFMT"
  | "INVALID_HYPERLINK"
  | "OVERLAPPING_MERGE"
  | "INVALID_COLUMN"
  | "TOO_MANY_STYLES"
  | "ZIP64_REQUIRED"
  // FormatError
  | "UNSUPPORTED_FORMAT"
  | "NOT_XLSX"
  | "ZIP_INVALID"
  | "ZIP_UNSUPPORTED_METHOD"
  | "ZIP_ENCRYPTED"
  | "ZIP_CRC_MISMATCH"
  | "XML_MALFORMED"
  | "XML_DTD_FORBIDDEN"
  // LimitError
  | "LIMIT_EXCEEDED"
  // CsvError
  | "CSV_MALFORMED"
  // EnvironmentError
  | "ENVIRONMENT_UNSUPPORTED";

/** Options accepted by every error constructor. */
export interface ExcelErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown>;
}

const BRAND: symbol = Symbol.for("javascript-excel.error");

/** Base class of every error the library throws. */
export class ExcelError extends Error {
  readonly code: ExcelErrorCode;
  declare readonly details?: Record<string, unknown>;

  constructor(code: ExcelErrorCode, message: string, options?: ExcelErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    if (options?.details !== undefined) this.details = options.details;
    Object.defineProperty(this, BRAND, { value: true });
  }
}

/** The model or options cannot be written. */
export class ValidationError extends ExcelError {}
/** The input is not a readable xlsx or zip file. */
export class FormatError extends ExcelError {}
/** A read limit was exceeded; `details.limit` names it. */
export class LimitError extends ExcelError {}
/** Malformed CSV in strict mode. */
export class CsvError extends ExcelError {}
/** A required platform API is missing. */
export class EnvironmentError extends ExcelError {}

/** True for any error thrown by this library, across ESM/CJS copies and realms. */
export function isExcelError(e: unknown): e is ExcelError {
  return typeof e === "object" && e !== null && (e as Record<symbol, unknown>)[BRAND] === true;
}
