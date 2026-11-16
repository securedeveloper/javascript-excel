/**
 * javascript-excel 2.0 (in progress).
 *
 * This entry exports the workbook model types (docs/api.md §3), the error
 * classes (§7), the xlsx writer (§5.1) and the address, date and style
 * helpers (§4). Builders land in later pull requests.
 */

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

export {
  CsvError,
  EnvironmentError,
  ExcelError,
  FormatError,
  isExcelError,
  LimitError,
  ValidationError,
} from "./errors";
export type { ExcelErrorCode, ExcelErrorOptions } from "./errors";

export { toBlob, toUint8Array, XLSX_MIME } from "./write";
export type { Progress, WriteOptions } from "./write";
export type { BinaryInput, BlobLike, BlobType } from "./binary";
export type { AbortSignalLike } from "./signal";
export type { ExcelWarning, ExcelWarningCode } from "./warnings";
export { dateToSerial, serialToDate } from "./dates";
export type { DateOptions } from "./dates";
export { mergeStyles } from "./styles";
export { decodeCell, decodeCol, decodeRange, encodeCell, encodeCol, encodeRange, MAX_COLS, MAX_ROWS } from "./address";
export type { CellAddress, RangeAddress } from "./address";

/** Package version. Kept in sync with package.json by a unit test. */
export const VERSION = "2.0.0-alpha.0";
