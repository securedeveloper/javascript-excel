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
  activeSheet?: number;
  /** Use the 1904 date system (`workbookPr/@date1904`). Default false (1900 system). */
  date1904?: boolean;
  properties?: DocProperties;
  definedNames?: DefinedName[];
  /** Workbook default font, used for `fonts[0]` in styles.xml and for width maths. Default Calibri 11. */
  defaultFont?: Font;
  /** Reader output only: theme colours and fonts, for resolving theme colours (§3.5.6). Ignored on write in 2.0. */
  theme?: Theme;
  /** Reader output only: a custom indexed palette (ARGB, index 0..63) from styles.xml, if the file has one. */
  indexedColors?: string[];
  /** Calculation flags (`calcPr`). `fullCalcOnLoad` write default: `'auto'`. */
  calc?: { fullCalcOnLoad?: boolean | "auto" };
}

/** Document properties from docProps/core.xml, app.xml and custom.xml. */
export interface DocProperties {
  // docProps/core.xml (Dublin Core and OPC core properties)
  title?: string;
  subject?: string;
  creator?: string;
  keywords?: string;
  description?: string;
  lastModifiedBy?: string;
  category?: string;
  /** Write default: now. */
  created?: Date;
  /** Write default: now. Also used for zip entry timestamps. */
  modified?: Date;
  // docProps/app.xml (extended properties)
  company?: string;
  manager?: string;
  /** Write default: `'javascript-excel'`. */
  application?: string;
  /** docProps/custom.xml. An array, not an object keyed by name, so file-supplied names are never object keys. */
  custom?: Array<{ name: string; value: string | number | boolean | Date }>;
}

/** A workbook- or sheet-level defined name. */
export interface DefinedName {
  /** For example `'TaxRate'`. */
  name: string;
  /** Formula text without `=`: `"'Sheet 1'!$A$1:$B$4"`. */
  ref: string;
  /** Sheet index when the name is local to a sheet (`localSheetId`). */
  sheet?: number;
  hidden?: boolean;
  comment?: string;
}

// ------------------------------------------------------------------- sheet

/** A worksheet. */
export interface Sheet<C = CellInput> {
  /** 1–31 characters, none of `\ / ? * [ ] :`, no leading or trailing `'`, unique case-insensitively. */
  name: string;
  /** `rows[r][c]`; both levels may be sparse. Max 1,048,576 rows x 16,384 columns. */
  rows: Array<Array<C | undefined> | undefined>;
  /** Per-row properties, indexed like `rows`. */
  rowProps?: Array<RowProps | undefined>;
  /** Per-column properties, index 0 = column A. */
  colProps?: Array<ColumnProps | undefined>;
  /** Merged ranges as A1 strings, e.g. `['A1:C1']`. Must not overlap. */
  merges?: string[];
  /** Autofilter range, e.g. `'A1:F1'`. */
  autoFilter?: string;
  view?: SheetView;
  print?: PrintSetup;
  /** Default `'visible'`. */
  state?: "visible" | "hidden" | "veryHidden";
  tabColor?: Color;
  /** Default column width in characters (`sheetFormatPr/@defaultColWidth`). */
  defaultColWidth?: number;
  /** Default row height in points (`sheetFormatPr/@defaultRowHeight`). */
  defaultRowHeight?: number;
  /** Style applied under column, row and cell styles on write (§3.5.7). Not produced by the reader. */
  defaultStyle?: Style;
  /** Reader output only: the used range computed from the cells read, e.g. `'A1:F120'`. */
  dimension?: string;
}

/** Row properties. */
export interface RowProps {
  /** Points, 0..409. */
  height?: number;
  hidden?: boolean;
  style?: Style;
  /** 0..7. */
  outlineLevel?: number;
  collapsed?: boolean;
}

/** Column properties. */
export interface ColumnProps {
  width?: ColumnWidth;
  hidden?: boolean;
  style?: Style;
  /** 0..7. */
  outlineLevel?: number;
  collapsed?: boolean;
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
  freeze?: { rows?: number; cols?: number };
  /** `sheetView/@rightToLeft`: column A on the right. */
  rightToLeft?: boolean;
  /** Default true. */
  showGridLines?: boolean;
  /** Default true. */
  showRowColHeaders?: boolean;
  /** Percent, 10..400. */
  zoom?: number;
  /** For example `'B2'`. */
  activeCell?: string;
  /** For example `'B2:D5'`. */
  selection?: string;
}

/** Print setup. */
export interface PrintSetup {
  orientation?: "portrait" | "landscape";
  /** Paper size code, e.g. 1 = Letter, 9 = A4. */
  paperSize?: number;
  /** Fit to N pages wide / tall; 0 = automatic. Sets `sheetPr/pageSetUpPr/@fitToPage`. */
  fitTo?: { width?: number; height?: number };
  /** Percent, 10..400; ignored when `fitTo` is set. */
  scale?: number;
  /** Inches. */
  margins?: { left?: number; right?: number; top?: number; bottom?: number; header?: number; footer?: number };
  center?: { horizontal?: boolean; vertical?: boolean };
  gridLines?: boolean;
  headings?: boolean;
  /** Written as the `_xlnm.Print_Area` defined name, e.g. `'A1:F40'`. */
  printArea?: string;
  /** Written as `_xlnm.Print_Titles`. Rows `'1:2'`, columns `'A:B'`. */
  printTitles?: { rows?: string; cols?: string };
  /** Raw header strings with Excel's &-codes, e.g. `'&CPage &P of &N'`. */
  header?: { odd?: string; even?: string; first?: string };
  /** Raw footer strings with Excel's &-codes. */
  footer?: { odd?: string; even?: string; first?: string };
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
  font?: Font;
}

/** The seven error values defined by ECMA-376. */
export type ErrorCode = "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A";

/** The type of a cell's value (for formulas, of the cached value). */
export type CellType = "string" | "number" | "boolean" | "date" | "error" | "richText" | "empty";

/** A cell with value, formula, style and hyperlink. */
export interface Cell {
  /** Literal value, or the cached result when `formula` is set. null/undefined = empty (styled if `style` is set). */
  value?: CellValue | null;
  /** Formula text without the leading `=`. A leading `=` is accepted on write and stripped. */
  formula?: string;
  /** Array formula (CSE) range, e.g. `'D1:D3'`; set on the anchor cell only. */
  arrayRef?: string;
  /**
   * Reader: always set; describes `value` (for formulas, the cached value).
   * Writer: optional. If set, it must match `value` (`INVALID_CELL` otherwise). It is a check, not a coercion.
   */
  type?: CellType;
  style?: Style;
  hyperlink?: Hyperlink;
}

/**
 * A cell hyperlink.
 * - string: external URL, shorthand for `{ target }`.
 * - `{ target }`: external (http, https, mailto, ...).
 * - `{ location }`: internal, `"'Sheet 2'!A1"` or a defined name.
 */
export type Hyperlink = string | { target: string; tooltip?: string } | { location: string; tooltip?: string };

// ------------------------------------------------------------------- style

/** A cell, row, column or default style. Every field is optional. */
export interface Style {
  font?: Font;
  fill?: Fill;
  border?: Border;
  alignment?: Alignment;
  numFmt?: NumFmt;
  /** Only takes effect once sheet protection exists (later release). */
  protection?: { locked?: boolean; hidden?: boolean };
}

/** Font. */
export interface Font {
  /** For example `'Calibri'`. */
  name?: string;
  /** Points. */
  size?: number;
  color?: Color;
  bold?: boolean;
  italic?: boolean;
  /** `true` = `'single'`. */
  underline?: boolean | "single" | "double" | "singleAccounting" | "doubleAccounting";
  strike?: boolean;
  vertAlign?: "superscript" | "subscript" | "baseline";
  /** Font family class: 0 n/a, 1 Roman, 2 Swiss, 3 Modern, 4 Script, 5 Decorative. */
  family?: number;
  charset?: number;
  scheme?: "major" | "minor" | "none";
  /** Mac-only rendering. */
  outline?: boolean;
  /** Mac-only rendering. */
  shadow?: boolean;
  condense?: boolean;
  extend?: boolean;
}

/** A fill. A string is shorthand for a solid fill in that colour: `fill: 'FFFF00'`. */
export type Fill = string | PatternFill | GradientFill;

/** Pattern fill. */
export interface PatternFill {
  type?: "pattern";
  pattern: PatternType;
  /** Pattern colour. For `'solid'` this is the cell colour (OOXML puts a solid fill in fgColor). */
  fgColor?: Color;
  bgColor?: Color;
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
  degree?: number;
  /** Path only, 0..1. */
  left?: number;
  /** Path only, 0..1. */
  right?: number;
  /** Path only, 0..1. */
  top?: number;
  /** Path only, 0..1. */
  bottom?: number;
  /** Positions 0..1. */
  stops: Array<{ position: number; color: Color }>;
}

/** Cell border; each side is independent. */
export interface Border {
  left?: BorderSide;
  right?: BorderSide;
  top?: BorderSide;
  bottom?: BorderSide;
  diagonal?: BorderSide;
  diagonalUp?: boolean;
  diagonalDown?: boolean;
}

/** One border side. */
export interface BorderSide {
  style: BorderStyle;
  /** Default: automatic (black). */
  color?: Color;
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
  horizontal?: "general" | "left" | "center" | "right" | "fill" | "justify" | "centerContinuous" | "distributed";
  vertical?: "top" | "center" | "bottom" | "justify" | "distributed";
  wrapText?: boolean;
  shrinkToFit?: boolean;
  /** Indent level, in steps of about three character widths. Excel shows it for left, right and distributed. */
  indent?: number;
  /** Degrees, -90..90, positive = counter-clockwise; or `'vertical'` for stacked text. */
  rotation?: number | "vertical";
  readingOrder?: "context" | "ltr" | "rtl";
  justifyLastLine?: boolean;
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
export type Color = string | { rgb: string } | { theme: number; tint?: number } | { indexed: number } | { auto: true };

/** Theme colours and fonts read from xl/theme/theme1.xml. */
export interface Theme {
  /** ARGB in clrScheme order: dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink. */
  colors: string[];
  /** Major (headings) latin typeface. */
  majorFont?: string;
  /** Minor (body) latin typeface. */
  minorFont?: string;
}
