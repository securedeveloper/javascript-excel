/**
 * The workbook model (docs/api.md §3).
 *
 * Plain data only: objects, arrays, strings, numbers, booleans and `Date`s, so
 * a workbook can be `structuredClone`d and posted to a worker. The writer
 * accepts loose `CellInput`; the reader returns normalised `Cell`s.
 * Indices are zero-based; references and ranges are A1 strings.
 */

// ---------------------------------------------------------------- workbook

/** A workbook. `C` is the cell type: `CellInput` for writer input, `Cell` for reader output. */
export interface Workbook<C = CellInput> {
  /** At least one sheet (`NO_SHEETS` otherwise). */
  sheets: Sheet<C>[];
  /** Index into `sheets` of the sheet shown when the file opens. Default 0. Must not be hidden. */
  activeSheet?: number | undefined;
  /** Use the 1904 date system (`workbookPr/@date1904`). Default false (1900 system). */
  date1904?: boolean | undefined;
  properties?: DocProperties | undefined;
  definedNames?: DefinedName[] | undefined;
  /** Workbook default font, used for `fonts[0]` in styles.xml and for width maths. Default Calibri 11. */
  defaultFont?: Font | undefined;
  /** Reader output only: theme colours and fonts, for resolving theme colours (§3.5.6). Ignored on write in 2.0. */
  theme?: Theme | undefined;
  /** Reader output only: a custom indexed palette (ARGB, index 0..63) from styles.xml, if the file has one. */
  indexedColors?: string[] | undefined;
  /** Calculation flags (`calcPr`). `fullCalcOnLoad` write default: `'auto'`. */
  calc?: { fullCalcOnLoad?: boolean | "auto" | undefined } | undefined;
}

/** Document properties from docProps/core.xml, app.xml and custom.xml. */
export interface DocProperties {
  // docProps/core.xml (Dublin Core and OPC core properties)
  title?: string | undefined;
  subject?: string | undefined;
  creator?: string | undefined;
  keywords?: string | undefined;
  description?: string | undefined;
  lastModifiedBy?: string | undefined;
  category?: string | undefined;
  /** Write default: now. */
  created?: Date | undefined;
  /** Write default: now. Also used for zip entry timestamps. */
  modified?: Date | undefined;
  // docProps/app.xml (extended properties)
  company?: string | undefined;
  manager?: string | undefined;
  /** Write default: `'javascript-excel'`. */
  application?: string | undefined;
  /** docProps/custom.xml. An array, not an object keyed by name, so file-supplied names are never object keys. */
  custom?: Array<{ name: string; value: string | number | boolean | Date }> | undefined;
}

/** A workbook- or sheet-level defined name. */
export interface DefinedName {
  /** For example `'TaxRate'`. */
  name: string;
  /** Formula text without `=`: `"'Sheet 1'!$A$1:$B$4"`. */
  ref: string;
  /** Sheet index when the name is local to a sheet (`localSheetId`). */
  sheet?: number | undefined;
  hidden?: boolean | undefined;
  comment?: string | undefined;
}

// ------------------------------------------------------------------- sheet

/** A worksheet. */
export interface Sheet<C = CellInput> {
  /** 1–31 characters, none of `\ / ? * [ ] :`, no leading or trailing `'`, unique case-insensitively. */
  name: string;
  /** `rows[r][c]`; both levels may be sparse. Max 1,048,576 rows x 16,384 columns. */
  rows: Array<Array<C | undefined> | undefined>;
  /** Per-row properties, indexed like `rows`. */
  rowProps?: Array<RowProps | undefined> | undefined;
  /** Per-column properties, index 0 = column A. */
  colProps?: Array<ColumnProps | undefined> | undefined;
  /** Merged ranges as A1 strings, e.g. `['A1:C1']`. Must not overlap. */
  merges?: string[] | undefined;
  /** Autofilter range, e.g. `'A1:F1'`. */
  autoFilter?: string | undefined;
  view?: SheetView | undefined;
  print?: PrintSetup | undefined;
  /** Default `'visible'`. */
  state?: "visible" | "hidden" | "veryHidden" | undefined;
  tabColor?: Color | undefined;
  /** Default column width in characters (`sheetFormatPr/@defaultColWidth`). */
  defaultColWidth?: number | undefined;
  /** Default row height in points (`sheetFormatPr/@defaultRowHeight`). */
  defaultRowHeight?: number | undefined;
  /** Style applied under column, row and cell styles on write (§3.5.7). Not produced by the reader. */
  defaultStyle?: Style | undefined;
  /** Reader output only: the used range computed from the cells read, e.g. `'A1:F120'`. */
  dimension?: string | undefined;
}

/** Row properties. */
export interface RowProps {
  /** Points, 0..409. */
  height?: number | undefined;
  hidden?: boolean | undefined;
  style?: Style | undefined;
  /** 0..7. */
  outlineLevel?: number | undefined;
  collapsed?: boolean | undefined;
}

/** Column properties. */
export interface ColumnProps {
  width?: ColumnWidth | undefined;
  hidden?: boolean | undefined;
  style?: Style | undefined;
  /** 0..7. */
  outlineLevel?: number | undefined;
  collapsed?: boolean | undefined;
}

/**
 * Column width.
 * - number or `{ wch }`: width in characters, as Excel's UI shows it (8.43 is the Calibri 11 default).
 * - `{ wpx }`: width in pixels at 96 dpi.
 *
 * Reader output is always a number in characters.
 */
export type ColumnWidth = number | { wch: number } | { wpx: number };

/** Sheet view settings. */
export interface SheetView {
  /** Frozen panes: rows above and columns left of the split stay visible. */
  freeze?: { rows?: number | undefined; cols?: number | undefined } | undefined;
  /** `sheetView/@rightToLeft`: column A on the right. */
  rightToLeft?: boolean | undefined;
  /** Default true. */
  showGridLines?: boolean | undefined;
  /** Default true. */
  showRowColHeaders?: boolean | undefined;
  /** Percent, 10..400. */
  zoom?: number | undefined;
  /** For example `'B2'`. */
  activeCell?: string | undefined;
  /** For example `'B2:D5'`. */
  selection?: string | undefined;
}

/** Print setup. */
export interface PrintSetup {
  orientation?: "portrait" | "landscape" | undefined;
  /** Paper size code, e.g. 1 = Letter, 9 = A4. */
  paperSize?: number | undefined;
  /** Fit to N pages wide / tall; 0 = automatic. Sets `sheetPr/pageSetUpPr/@fitToPage`. */
  fitTo?: { width?: number | undefined; height?: number | undefined } | undefined;
  /** Percent, 10..400; ignored when `fitTo` is set. */
  scale?: number | undefined;
  /** Inches. */
  margins?: { left?: number | undefined; right?: number | undefined; top?: number | undefined; bottom?: number | undefined; header?: number | undefined; footer?: number | undefined } | undefined;
  center?: { horizontal?: boolean | undefined; vertical?: boolean | undefined } | undefined;
  gridLines?: boolean | undefined;
  headings?: boolean | undefined;
  /** Written as the `_xlnm.Print_Area` defined name, e.g. `'A1:F40'`. */
  printArea?: string | undefined;
  /** Written as `_xlnm.Print_Titles`. Rows `'1:2'`, columns `'A:B'`. */
  printTitles?: { rows?: string | undefined; cols?: string | undefined } | undefined;
  /** Raw header strings with Excel's &-codes, e.g. `'&CPage &P of &N'`. */
  header?: { odd?: string | undefined; even?: string | undefined; first?: string | undefined } | undefined;
  /** Raw footer strings with Excel's &-codes. */
  footer?: { odd?: string | undefined; even?: string | undefined; first?: string | undefined } | undefined;
}

// ------------------------------------------------------------------- cells

/** What the writer accepts in a cell slot. */
export type CellInput = CellValue | Cell | null | undefined;

/** Bare values. A string is always text, even when it starts with `=`. Only `Cell.formula` makes a formula. */
export type CellValue = string | number | boolean | Date | CellErrorValue | RichText;

/** An error value such as `#N/A`. */
export interface CellErrorValue {
  error: ErrorCode;
}

/** Rich text: a sequence of runs, each with its own font. */
export interface RichText {
  richText: RichTextRun[];
}

/** One run of rich text. */
export interface RichTextRun {
  text: string;
  font?: Font | undefined;
}

/** The seven error values defined by ECMA-376. */
export type ErrorCode = "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A";

/** The type of a cell's value (for formulas, of the cached value). */
export type CellType = "string" | "number" | "boolean" | "date" | "error" | "richText" | "empty";

/** A cell with value, formula, style and hyperlink. */
export interface Cell {
  /** Literal value, or the cached result when `formula` is set. null/undefined = empty (styled if `style` is set). */
  value?: CellValue | null | undefined;
  /** Formula text without the leading `=`. A leading `=` is accepted on write and stripped. */
  formula?: string | undefined;
  /** Array formula (CSE) range, e.g. `'D1:D3'`; set on the anchor cell only. */
  arrayRef?: string | undefined;
  /**
   * Reader: always set; describes `value` (for formulas, the cached value).
   * Writer: optional. If set, it must match `value` (`INVALID_CELL` otherwise). It is a check, not a coercion.
   */
  type?: CellType | undefined;
  style?: Style | undefined;
  hyperlink?: Hyperlink | undefined;
}

/**
 * A cell hyperlink.
 * - string: external URL, shorthand for `{ target }`.
 * - `{ target }`: external (http, https, mailto, ...).
 * - `{ location }`: internal, `"'Sheet 2'!A1"` or a defined name.
 */
export type Hyperlink = string | { target: string; tooltip?: string | undefined } | { location: string; tooltip?: string | undefined };

// ------------------------------------------------------------------- style

/** A cell, row, column or default style. Every field is optional. */
export interface Style {
  font?: Font | undefined;
  fill?: Fill | undefined;
  border?: Border | undefined;
  alignment?: Alignment | undefined;
  numFmt?: NumFmt | undefined;
  /** Only takes effect once sheet protection exists (later release). */
  protection?: { locked?: boolean | undefined; hidden?: boolean | undefined } | undefined;
}

/** Font. */
export interface Font {
  /** For example `'Calibri'`. */
  name?: string | undefined;
  /** Points. */
  size?: number | undefined;
  color?: Color | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  /** `true` = `'single'`. */
  underline?: boolean | "single" | "double" | "singleAccounting" | "doubleAccounting" | undefined;
  strike?: boolean | undefined;
  vertAlign?: "superscript" | "subscript" | "baseline" | undefined;
  /** Font family class: 0 n/a, 1 Roman, 2 Swiss, 3 Modern, 4 Script, 5 Decorative. */
  family?: number | undefined;
  charset?: number | undefined;
  scheme?: "major" | "minor" | "none" | undefined;
  /** Mac-only rendering. */
  outline?: boolean | undefined;
  /** Mac-only rendering. */
  shadow?: boolean | undefined;
  condense?: boolean | undefined;
  extend?: boolean | undefined;
}

/** A fill. A string is shorthand for a solid fill in that colour: `fill: 'FFFF00'`. */
export type Fill = string | PatternFill | GradientFill;

/** Pattern fill. */
export interface PatternFill {
  type?: "pattern" | undefined;
  pattern: PatternType;
  /** Pattern colour. For `'solid'` this is the cell colour (OOXML puts a solid fill in fgColor). */
  fgColor?: Color | undefined;
  bgColor?: Color | undefined;
}

/** `ST_PatternType`, all 19 values. */
export type PatternType =
  | "none"
  | "solid"
  | "mediumGray"
  | "darkGray"
  | "lightGray"
  | "darkHorizontal"
  | "darkVertical"
  | "darkDown"
  | "darkUp"
  | "darkGrid"
  | "darkTrellis"
  | "lightHorizontal"
  | "lightVertical"
  | "lightDown"
  | "lightUp"
  | "lightGrid"
  | "lightTrellis"
  | "gray125"
  | "gray0625";

/** Gradient fill. */
export interface GradientFill {
  type: "gradient";
  gradient: "linear" | "path";
  /** Linear only. */
  degree?: number | undefined;
  /** Path only, 0..1. */
  left?: number | undefined;
  /** Path only, 0..1. */
  right?: number | undefined;
  /** Path only, 0..1. */
  top?: number | undefined;
  /** Path only, 0..1. */
  bottom?: number | undefined;
  /** Positions 0..1. */
  stops: Array<{ position: number; color: Color }>;
}

/** Cell border; each side is independent. */
export interface Border {
  left?: BorderSide | undefined;
  right?: BorderSide | undefined;
  top?: BorderSide | undefined;
  bottom?: BorderSide | undefined;
  diagonal?: BorderSide | undefined;
  diagonalUp?: boolean | undefined;
  diagonalDown?: boolean | undefined;
}

/** One border side. */
export interface BorderSide {
  style: BorderStyle;
  /** Default: automatic (black). */
  color?: Color | undefined;
}

/** `ST_BorderStyle`, all 14 values. */
export type BorderStyle =
  | "none"
  | "thin"
  | "medium"
  | "thick"
  | "double"
  | "hair"
  | "dotted"
  | "dashed"
  | "dashDot"
  | "dashDotDot"
  | "mediumDashed"
  | "mediumDashDot"
  | "mediumDashDotDot"
  | "slantDashDot";

/** Cell alignment. */
export interface Alignment {
  horizontal?: "general" | "left" | "center" | "right" | "fill" | "justify" | "centerContinuous" | "distributed" | undefined;
  vertical?: "top" | "center" | "bottom" | "justify" | "distributed" | undefined;
  wrapText?: boolean | undefined;
  shrinkToFit?: boolean | undefined;
  /** Indent level, in steps of about three character widths. Excel shows it for left, right and distributed. */
  indent?: number | undefined;
  /** Degrees, -90..90, positive = counter-clockwise; or `'vertical'` for stacked text. */
  rotation?: number | "vertical" | undefined;
  readingOrder?: "context" | "ltr" | "rtl" | undefined;
  justifyLastLine?: boolean | undefined;
}

/** Number format: a number is a built-in format id (0..163), a string is a format code. */
export type NumFmt = number | string;

/**
 * A colour.
 * - string: `'RRGGBB'`, `'AARRGGBB'`, `'#RRGGBB'` or `'#AARRGGBB'` (case-insensitive), same as `{ rgb }`.
 * - `{ rgb }`: ARGB, e.g. `'FF336699'`.
 * - `{ theme, tint }`: theme colour index 0..11, tint -1..1.
 * - `{ indexed }`: legacy palette 0..63; 64 = system foreground, 65 = system background.
 * - `{ auto: true }`: automatic colour.
 */
export type Color = string | { rgb: string } | { theme: number; tint?: number | undefined } | { indexed: number } | { auto: true };

/** Theme colours and fonts read from xl/theme/theme1.xml. */
export interface Theme {
  /** ARGB in clrScheme order: dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink. */
  colors: string[];
  /** Major (headings) latin typeface. */
  majorFont?: string | undefined;
  /** Minor (body) latin typeface. */
  minorFont?: string | undefined;
}
