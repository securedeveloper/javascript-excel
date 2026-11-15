/**
 * javascript-excel 2.0 (in progress).
 *
 * This entry exports the workbook model types (docs/api.md §3) and the error
 * classes (§7). Builders, the xlsx writer and the output helpers land in later
 * pull requests.
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

/** Package version. Kept in sync with package.json by a unit test. */
export const VERSION = "2.0.0-alpha.0";
