/**
 * javascript-excel 2.0 (in progress).
 *
 * This entry exports the workbook model types (docs/api.md §3), the error
 * classes (§7), the xlsx writer (§5.1) and the address, date and style
 * helpers (§4). Builders land in later pull requests.
 *
 * @module javascript-excel
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
export { resolveColor } from "./colors";
export type { ColorContext } from "./colors";
export { cellText } from "./cells";
export { fromDataset, fromDatasets, toDataset } from "./dataset";
export type { ColumnDef, ColumnTotal, Dataset, DatasetBlock, DatasetOptions, DatasetResult, GroupColumn, LeafColumn, ToDatasetOptions } from "./dataset";
export type { AutoWidthOptions } from "./auto-width";
export type { CellTextOptions } from "./cells";
export { sanitizeSheetName, validateSheetName } from "./sheet-names";
export type { SheetNameProblem } from "./sheet-names";
export { BUILTIN_NUM_FMTS, isDateFormat } from "./numfmt";
export { decodeCell, decodeCol, decodeRange, encodeCell, encodeCol, encodeRange, MAX_COLS, MAX_ROWS } from "./address";
export type { CellAddress, RangeAddress } from "./address";

/** Package version. Set from package.json by `npm run version-packages` (scripts/sync-version.mjs); a unit test checks it. */
export const VERSION = "2.0.0-alpha.2";
