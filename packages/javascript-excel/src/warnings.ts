/**
 * Warnings (docs/api.md §7.3).
 *
 * The reader and the CSV parser collect warnings for damage they can recover
 * from, instead of throwing. Each warning is plain data.
 */

/** Every warning code the library reports. */
export type ExcelWarningCode =
  // xlsx reader
  | "UNSUPPORTED_PART"
  | "INVALID_STYLE_INDEX"
  | "INVALID_SHARED_STRING"
  | "CELL_OUT_OF_BOUNDS"
  | "INVALID_CELL_REF"
  | "DUPLICATE_CELL"
  | "INVALID_DATE_SERIAL"
  | "SHARED_FORMULA_UNRESOLVED"
  | "MISSING_PART"
  | "BROKEN_OPTIONAL_PART"
  | "HYPERLINK_RANGE_REDUCED"
  | "SPLIT_PANE_IGNORED"
  // builders
  | "COERCION_FAILED"
  | "NON_FINITE_NUMBER"
  | "HYPERLINK_DROPPED"
  // CSV parser
  | "CSV_UNTERMINATED_QUOTE"
  | "CSV_STRAY_QUOTE"
  | "CSV_FIELD_COUNT"
  | "CSV_INVALID_ENCODING"
  | "CSV_ROWS_TRUNCATED"
  // any collector
  | "WARNINGS_TRUNCATED";

/** A recoverable problem found while reading or building. */
export interface ExcelWarning {
  code: ExcelWarningCode;
  message: string;
  /** Zip part, e.g. `'xl/worksheets/sheet2.xml'`. */
  part?: string | undefined;
  sheet?: string | undefined;
  /** Cell or range, e.g. `'B3'`. For CSV, the cell the record and field map to. */
  ref?: string | undefined;
}
