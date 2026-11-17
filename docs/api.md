# javascript-excel 2.0: API design

Status: **approved** (2026-11-16). This is the design that implementation follows. §12 records the decisions taken in review. Any change to the design is made by editing this document in a PR.

Conventions in this document:

- `[to verify]` marks an OOXML or platform fact that must be checked against ECMA-376 or a real file before the code relies on it. Most are resolved by the one-time manual check in [conformance.md](conformance.md), which names the corpus file that checks each one.
- `[placeholder, set in JSE-n]` marks a number that has not been measured. The task named sets it.
- `JSE-n` names the implementation task of this rewrite that owns a decision (JSE-2 zip and model, JSE-3 writer, JSE-4 sheet features, JSE-5 CSV, JSE-6 reader, JSE-7 DOM, JSE-8 performance and worker, JSE-9 conformance).
- ECMA-376 references are to Part 1 (Fundamentals and Markup Language Reference), 5th edition, transitional schema, unless stated otherwise.

## Contents

1. [Goals, non-goals, out of scope](#1-goals-non-goals-out-of-scope)
2. [Entry points](#2-entry-points)
3. [Data model](#3-data-model)
4. [Builders and helpers](#4-builders-and-helpers)
5. [Write, read, CSV, DOM, worker, import, format and render APIs](#5-write-read-csv-dom-worker-import-format-and-render-apis)
6. [Zip codec](#6-zip-codec)
7. [Errors and warnings](#7-errors-and-warnings)
8. [Security model](#8-security-model)
9. [Versioning, compatibility, runtime support](#9-versioning-compatibility-runtime-support)
10. [Worked examples](#10-worked-examples)
11. [Appendix: OOXML reference tables](#11-appendix-ooxml-reference-tables)
12. [Design decisions](#12-design-decisions)
13. [Roadmap beyond 2.0](#13-roadmap-beyond-20)

---

## 1. Goals, non-goals, out of scope

### Goals

1. **Read and write `.xlsx`** (Office Open XML SpreadsheetML, transitional) **and `.csv`** (RFC 4180) from one typed model.
2. **100% TypeScript**, strict mode, with the public types as the primary documentation.
3. **Zero runtime dependencies.** Zip container and CRC-32 in-house; deflate/inflate through the platform's `CompressionStream` / `DecompressionStream`.
4. **Runs everywhere modern JS runs:** browsers, Web Workers, Node. No framework dependency, and no access to `window`, `document` or any other global at import time (SSR-safe).
5. **Tree-shakable:** a writer-only user never ships the reader, the CSV code or the DOM code (§2).
6. **Safe on untrusted input:** the reader enforces zip-bomb, XML and memory limits by default (§8).
7. **Serve the consumers:** dataset export (`{ columns, data }`), HTML table export, file import back to `{ columns, data }`, and a future read-only viewer that needs styles, merges, sizes, freeze panes, number formats and formula text with cached values.
8. **Faithful output:** files open in Excel (Windows and Mac), LibreOffice, Numbers and Google Sheets without a repair prompt.

### Non-goals for 2.0

The first two are later phases (§13), not permanent exclusions.

- **Lossless round-trip of arbitrary files.** `write(read(file))` keeps everything in the model below. Parts the model does not cover (charts, drawings, pivots, comments, and so on) are dropped, with a warning on read. There is no "pass unknown parts through" mode in 2.0; preserving unknown parts is planned for 2.x.
- **Formula evaluation.** Formulas are stored as text with their cached values. Evaluation is a separate, later module (3.x).
- **A synchronous API.** All file I/O is `async` (§6).
- **Pixel-exact layout.** Column widths, auto-width and row heights use the spec's character-width formulas, not font metrics.
- **Compatibility with the 1.x API.** 2.0 is a rewrite. The 1.x constructor that took injected `jszip` / `saveAs` instances is gone.

### Out of scope for 2.0

The project's end goal is to read, write and view every kind of Excel and CSV file. Everything below is therefore a **phase boundary, not a permanent non-goal**: §13 places each item in a later phase, and 2.0's design must not close the door on any of them.

| Feature | Notes |
|---|---|
| `.xls` (BIFF8, Excel 97–2003) | The reader detects it and throws `UNSUPPORTED_FORMAT`. |
| `.xlsb` (binary workbook) | Detected, `UNSUPPORTED_FORMAT`. |
| `.ods` (OpenDocument) | Detected, `UNSUPPORTED_FORMAT`. |
| Charts, images, drawings, shapes | Dropped on read with a warning. |
| Pivot tables, slicers, timelines | Dropped on read with a warning. |
| Macros (`.xlsm` VBA projects) | An `.xlsm` file is read as a workbook without its VBA part; the writer never produces `.xlsm`. |
| Encrypted or password-protected files | Detected (they are CFB containers, not zip), `UNSUPPORTED_FORMAT`. |
| Formula evaluation | Stored formulas and cached values only. |
| Also not in 2.0 (planned later) | Data validation, conditional formatting, comments/notes, Excel tables (ListObjects), sheet/workbook protection, sparklines, external links, streaming row-by-row reader and writer. |

---

## 2. Entry points

One npm package, `javascript-excel`, with subpath exports. `package.json` declares `"sideEffects": false`. Every module is free of top-level side effects, so bundlers can drop anything not imported.

| Entry | Exports | Pulls in | Tree-shaking intent |
|---|---|---|---|
| `javascript-excel` | Model types; address, date, colour and style helpers; `fromDataset`, `fromDatasets`, `toDataset`; xlsx writer: `toUint8Array`, `toBlob`; error classes and `isExcelError` | Zip writer, XML writer | The default "build a file" path. No reader, no CSV, no DOM. |
| `javascript-excel/read` | `read`, `readSheetNames`, `detectFormat`, `ReadOptions`, `ReadLimits`, `DEFAULT_READ_LIMITS` | Zip reader, XML pull tokenizer | Only apps that open files pay for the reader. |
| `javascript-excel/csv` | `parseCsv`, `readCsv`, `toCsv`, `toCsvBlob`, option types | Nothing from the xlsx code | CSV-only apps ship a few kB of CSV code and the model types. |
| `javascript-excel/dom` | `fromTable`, `download` | DOM APIs, called only inside functions | The only module that touches `document`. Safe to import during SSR; calling it without a DOM throws `ENVIRONMENT_UNSUPPORTED`. |
| `javascript-excel/worker` | `exposeWorker` (worker side), `createWorkerClient` (main-thread side) | Writer and reader, inside the worker only | Moves big jobs off the main thread. Main-thread code that imports only `createWorkerClient` does not ship the engine. |
| `javascript-excel/import` | `importDataset`, `detectHeader`, `inferColumnTypes`, `coerceColumns`, `parseNumber`, `parseDate`, `mapColumns`, `applyMapping`, option and result types | Reader and CSV reader | Importing user files into `{ columns, data }` (§5.6). Apps that only write never load it. |
| `javascript-excel/format` | `formatValue`, `formatCell`, `FormatOptions`, `FormattedValue` | Format-code parser and renderer; locale data from `Intl` | Only apps that show formatted values (viewers, previews) pay for it. |
| `javascript-excel/render` | `createRenderSheet` and its geometry, cell, navigation and copy functions (§5.8) | Nothing from the reader or writer; number formatting only through the `format` option | Only viewers pay for it. |

Rules:

- Deep imports (`javascript-excel/dist/...`) are not part of the API, and the `exports` map blocks them.
- Both ESM and CJS builds ship. Because of the dual-package hazard, `instanceof ExcelError` can fail when ESM and CJS copies are mixed in one app, so the documented check is `isExcelError(err)` or `err.code` (§7).
- Types are exported from the entry that uses them. Shared model types are re-exported from every entry, so `import type { Workbook } from 'javascript-excel/read'` works.

---

## 3. Data model

### 3.1 Principles

- **Plain data, no classes.** A `Workbook` is a tree of plain objects, arrays, strings, numbers, booleans and `Date`s. It is therefore `structuredClone`-able and can be sent to a worker with `postMessage`. Behaviour lives in free functions.
- **One model for read and write.** The writer accepts loose input (`CellInput`). The reader returns the normalised form (`Cell`), which is also valid writer input.
- **Zero-based indices, A1 strings for references.** `rows[0][0]` is cell `A1`. Ranges and references in the model are A1 strings (`'A1:C3'`). Helpers convert between them (§4.1).
- **Sparse by design.** `rows` and each row's cells are arrays that may have holes. A hole is "no cell".
- **Unknown fields are ignored** by the writer, so the model can grow in minor releases (§9).
- **Optional means `undefined` is allowed:** every optional property is declared `prop?: T | undefined`, so consumers with `exactOptionalPropertyTypes` can pass an explicit `undefined`, which the writer treats as absent. Declarations below omit the `| undefined` for brevity.

### 3.2 Workbook

```ts
/** C is the cell type: CellInput for writer input, Cell for reader output. */
export interface Workbook<C = CellInput> {
  sheets: Sheet<C>[];                 // at least one sheet (NO_SHEETS otherwise)
  /** Index into `sheets` of the sheet shown when the file opens. Default 0. Must not be hidden. */
  activeSheet?: number;
  /** Use the 1904 date system (workbookPr/@date1904). Default false (1900 system). */
  date1904?: boolean;
  properties?: DocProperties;
  definedNames?: DefinedName[];
  /** Workbook default font, used for fonts[0] in styles.xml and for width maths. Default Calibri 11. */
  defaultFont?: Font;
  /** Reader output only: theme colours and fonts, for resolving theme colours (§3.5.6). Ignored on write in 2.0. */
  theme?: Theme;
  /** Reader output only: a custom indexed palette from styles.xml/colors, if the file has one. */
  indexedColors?: string[];           // ARGB, index 0..63
  /** Calculation flags (calcPr). */
  calc?: { fullCalcOnLoad?: boolean | 'auto' }; // write default 'auto', see §5.1
}

export interface DocProperties {
  // docProps/core.xml (Dublin Core and OPC core properties)
  title?: string;
  subject?: string;
  creator?: string;
  keywords?: string;
  description?: string;
  lastModifiedBy?: string;
  category?: string;
  created?: Date;                      // write default: now
  modified?: Date;                     // write default: now
  // docProps/app.xml (extended properties)
  company?: string;
  manager?: string;
  application?: string;                // write default 'javascript-excel'
  // docProps/custom.xml. An array (not an object keyed by name) so file-supplied names are never object keys.
  custom?: Array<{ name: string; value: string | number | boolean | Date }>;
}

export interface DefinedName {
  name: string;                        // e.g. 'TaxRate', '_xlnm.Print_Area'
  /** Formula text without '=': "'Sheet 1'!$A$1:$B$4" */
  ref: string;
  /** Sheet index when the name is local to a sheet (localSheetId). */
  sheet?: number;
  hidden?: boolean;
  comment?: string;
}
```

**Defined names** follow Excel's rules (`INVALID_DEFINED_NAME` otherwise): the name starts with a letter, `_` or `\`, continues with letters, digits, `.`, `_`, `\` or `?`, is at most 255 characters, and is not a cell reference (`A1`, `XFD1048576`), an R1C1 reference or `R`/`C` on its own. Names are unique per scope (workbook, or `sheet`), case-insensitively, and `ref` is formula text, not validated further. Names starting with `_xlnm.` are reserved for the writer.

Print areas, print titles and the autofilter database are defined names in OOXML (`_xlnm.Print_Area`, `_xlnm.Print_Titles`, `_xlnm._FilterDatabase`). The model exposes them as sheet properties (§3.6, §3.7). The writer generates those defined names, and the reader maps them back and does not repeat them in `definedNames`.

### 3.3 Sheet

```ts
export interface Sheet<C = CellInput> {
  /** Validated on write, see "Sheet names" below. */
  name: string;
  /** rows[r][c]; both levels may be sparse. Max 1,048,576 rows x 16,384 columns. */
  rows: Array<Array<C | undefined> | undefined>;
  /** Per-row properties, indexed like `rows`. */
  rowProps?: Array<RowProps | undefined>;
  /** Per-column properties, index 0 = column A. */
  colProps?: Array<ColumnProps | undefined>;
  /** Merged ranges, A1 strings: ['A1:C1']. Must not overlap. */
  merges?: string[];
  autoFilter?: string;                 // range, e.g. 'A1:F1'
  view?: SheetView;
  print?: PrintSetup;
  state?: 'visible' | 'hidden' | 'veryHidden';  // default 'visible'
  tabColor?: Color;
  /** Default column width in characters (sheetFormatPr/@defaultColWidth). */
  defaultColWidth?: number;
  /** Default row height in points (sheetFormatPr/@defaultRowHeight). */
  defaultRowHeight?: number;
  /** Style applied under column, row and cell styles on write (§3.5.7). Not produced by the reader. */
  defaultStyle?: Style;
  /** Reader output only: the used range computed from the cells read, e.g. 'A1:F120'. */
  dimension?: string;
}

export interface RowProps {
  height?: number;                     // points, 0..409
  hidden?: boolean;
  style?: Style;
  outlineLevel?: number;               // 0..7
  collapsed?: boolean;
}

export interface ColumnProps {
  width?: ColumnWidth;
  hidden?: boolean;
  style?: Style;
  outlineLevel?: number;               // 0..7
  collapsed?: boolean;
}

/**
 * number or { wch } = width in characters, as Excel's UI shows it (8.43 is the Calibri 11 default).
 * { wpx }           = width in pixels at 96 dpi.
 * 'auto'            = estimated by the writer from the column's text.
 * Reader output is always a number in characters.
 */
export type ColumnWidth = number | { wch: number } | { wpx: number } | 'auto';
```

**Column width conversion** (ECMA-376 §18.3.1.13, `col/@width`). The file stores the width including padding. With the maximum digit width `MDW` of the default font:

- characters to file width: `width = Truncate((wch * MDW + 5) / MDW * 256) / 256`
- pixels to file width: `width = Truncate(((wpx - 5) / MDW) * 100 + 0.5) / 100`, then the formula above
- file width to pixels (reader): `wpx = Truncate(((256 * width + Truncate(128 / MDW)) / 256) * MDW)`

`MDW = 7` px for Calibri 11, the default font. With it, the formula turns Excel's default 8.43 characters into `width="9.140625"`, the value Excel files carry for default-width columns (unit-tested). The manual check in [conformance.md](conformance.md) (`13-columns-rows`) confirms it in Excel itself. The writer uses `MDW = 7` whatever the default font is `[to verify for other default fonts]`. The model's character unit is the one Excel's UI shows. The maximum width is 255 characters.

- **`'auto'`** measures `cellText()` of every cell in the column (the widest line; East Asian wide characters and emoji count two), adds 2 characters of padding and clamps the result to 8.43..60 characters. 60 is a readability choice made in JSE-4, not a measurement. It writes `bestFit="1"`. Number formats and fonts are not taken into account.
- **Width 0** also writes `hidden="1"`, as Excel does for a zero-width column. A row `height` of 0 likewise hides the row.
- **Columns without `colProps`** get no `<col>` element, unless the sheet has a `defaultStyle`, which is written as a `<col>` covering those columns through `XFD`. Consecutive columns with identical properties share one `<col min max>`. Column and row styles are written on `<col style>` and `<row s customFormat>` as well as being merged into the cells (§3.5.7).
- Every `colProps` and `rowProps` field is validated (`INVALID_SHEET_PROPERTY`): widths 0..255 characters, heights 0..409 points, `outlineLevel` 0..7, booleans. `sheetFormatPr` carries the default sizes and the highest outline levels.

**Sheet names.** The writer throws `INVALID_SHEET_NAME` unless the name:

- is 1 to 31 characters long `[to verify: whether Excel counts UTF-16 code units or code points for astral characters; conformance.md, 17-workbook]`;
- contains none of `\ / ? * [ ] :`;
- does not start or end with an apostrophe `'`;
- is not `History`, which Excel reserves `[to verify: conformance.md, 17-workbook]`.

Names must be unique, compared case-insensitively (`DUPLICATE_SHEET_NAME`). `sanitizeSheetName()` (§4.6) makes any string valid.

### 3.4 Cells

```ts
/** What the writer accepts in a cell slot. */
export type CellInput = CellValue | Cell | null | undefined;

/** Bare values. A string is always text, even when it starts with '='. Only `Cell.formula` makes a formula. */
export type CellValue = string | number | boolean | Date | CellErrorValue | RichText;

export interface CellErrorValue { error: ErrorCode }
export interface RichText { richText: RichTextRun[] }
export interface RichTextRun { text: string; font?: Font }

export type ErrorCode =
  | '#NULL!' | '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#NUM!' | '#N/A';

export type CellType = 'string' | 'number' | 'boolean' | 'date' | 'error' | 'richText' | 'empty';

export interface Cell {
  /** Literal value, or the cached result when `formula` is set. null/undefined = empty (styled if `style` is set). */
  value?: CellValue | null;
  /** Formula text without the leading '='. A leading '=' is accepted on write and stripped. */
  formula?: string;
  /** Array formula (CSE) range, e.g. 'D1:D3'; set on the anchor cell only. */
  arrayRef?: string;
  /**
   * Reader: always set; describes `value` (for formulas, the cached value).
   * Writer: optional. If set, it must match `value` (INVALID_CELL otherwise). It is a check, not a coercion.
   */
  type?: CellType;
  style?: Style;
  hyperlink?: Hyperlink;
}

export type Hyperlink =
  | string                                         // external URL, shorthand for { target }
  | { target: string; tooltip?: string }           // external: http(s), mailto, ...
  | { location: string; tooltip?: string };        // internal: "'Sheet 2'!A1" or a defined name
```

How each value is written:

| Input | SpreadsheetML | Notes |
|---|---|---|
| `string` | `t="s"` (shared string) or `t="inlineStr"` | Text, never parsed. Max 32,767 characters (`STRING_TOO_LONG`). |
| `number` | `t="n"` | Must be finite (`INVALID_NUMBER` for `NaN`, `±Infinity`). |
| `boolean` | `t="b"` | |
| `Date` | `t="n"` + date `numFmt` | Converted to a serial (§3.4.1). If the cell has no `numFmt`, built-in id 14 is used. |
| `{ error }` | `t="e"` | Only the seven codes above. Other `#...` strings are not accepted in 2.0 `[to verify: how newer Excel errors such as #SPILL! are stored in files; conformance.md, open items]`. |
| `{ richText }` | shared string with `<r>` runs | |
| `Cell` with `formula` | `<f>` + cached `<v>` when `value` is set | §3.4.2 |
| `null` / `undefined` / hole | no `<c>`, or a styled empty `<c>` if the `Cell` has a `style` | |

Text encoding follows ECMA-376 `ST_Xstring`: characters not allowed in XML 1.0, and `\r`, which XML parsers turn into `\n`, are written as `_xHHHH_`. Text that already contains `_xHHHH_` literally is escaped as `_x005F_xHHHH_`. The reader reverses both. Leading and trailing whitespace is kept with `xml:space="preserve"`.

The reader returns each cell as a `Cell` with `type` set. Bare values are never returned. `cellText(cell)` (§4.5) gives the plain text of any cell.

#### 3.4.1 Dates

Excel stores dates as serial numbers. The writer converts `Date` to a serial and the reader converts back, both in the time zone set by `dateZone` (default `'local'`, see §12 Q2).

- **1900 system** (default): serial 1 = 1900-01-01. Excel treats 1900 as a leap year, so serial 60 is the non-existent 1900-02-29 and every serial from 61 onwards is offset by one. The writer writes dates from 1900-03-01 onwards with the epoch 1899-12-30, and earlier dates with epoch 1899-12-31, which matches Excel. The reader returns serial 60 as a number with warning `INVALID_DATE_SERIAL`. Serials from 0 to below 1 are Excel's day 0 ("1900-01-00"), which is how time-only values such as 0.5 (12:00) are stored. `serialToDate` returns them on 1899-12-31, and `serialToDate(60)` returns 1900-03-01; flagging serial 60 is the reader's job.
- **1904 system** (`date1904: true`): serial 0 = 1904-01-01.
- Range: 1899-12-31 (1904 system: 1904-01-01) to 9999-12-31. Outside it, or for an invalid `Date`, the writer throws `INVALID_DATE`. 1899-12-31 is Excel's day 0 ("1900-01-00"), where time-only values live as serials 0 to below 1. `serialToDate` returns them on that day, so `dateToSerial` accepts it too and time-only cells round-trip.
- Fractions are times of day; the writer keeps millisecond precision.

**Date detection on read.** A numeric cell is returned as `type: 'date'` with a `Date` value when its number format is a date or time format:

- built-in ids 14–22, 45 and 47 (46 is `[h]:mm:ss`, an elapsed time);
- built-in ids 27–36 and 50–58 (locale-dependent East Asian date formats) `[to verify: conformance.md, 11-number-formats-locale]`;
- custom codes that, after removing quoted literals, backslash escapes and bracketed sections other than the elapsed-time tokens `[h]`, `[m]`, `[s]`, contain a date/time token (`y`, `m`, `d`, `h`, `s`, `AM/PM`, `A/P`, `e`, `g`, `b`) `[to verify against more real-world files; the reader tests cover the common codes]`.

Elapsed-time formats (`[h]:mm:ss`) are durations, not dates. The reader returns them as `type: 'number'` and leaves formatting to the caller. With `ReadOptions.dates: 'serial'`, no conversion happens and date cells come back as `type: 'number'`.

#### 3.4.2 Formulas

- `formula` is stored verbatim in `<f>`, after the leading `=` is stripped and the text is XML-escaped. The library does not parse or validate it.
- `value` on a formula cell is the **cached result**, written to `<v>`. Excel recalculates on open. LibreOffice, by default, and file previewers, mail previews and the future viewer show the cached value, so callers should supply one when they know it. `fromDataset` totals compute it (§4.3).
- When any formula cell has no cached value and `calc.fullCalcOnLoad` is `'auto'` (the default), the writer sets `calcPr/@fullCalcOnLoad="1"`.
- Functions added after Excel 2007 must carry the `_xlfn.` prefix in the file (for example `_xlfn.XLOOKUP`), or Excel shows `#NAME?`. In 2.0 the writer stores text verbatim and the reader returns it verbatim, prefix included (§12 Q11). A later 2.x minor adds opt-in auto-prefixing for post-2007 functions, plus a reader option that strips the prefixes for display.
- **Shared formulas** (`<f t="shared">`): the reader expands them into per-cell formula text by shifting relative A1 references (§12 Q6). **Array formulas** come back as `formula` plus `arrayRef` on the anchor cell; the other cells of the range carry only cached values. Dynamic-array metadata (`metadata.xml`) is not modelled.
- Maximum formula length is 8,192 characters (Excel limit). The writer does not enforce it.

### 3.5 Style

One canonical style model, used for cells, rows, columns, rich-text runs and the defaults. Every field is optional. The writer deduplicates complete styles into `cellXfs` (one `xf` per distinct style).

```ts
export interface Style {
  font?: Font;
  fill?: Fill;
  border?: Border;
  alignment?: Alignment;
  numFmt?: NumFmt;
  protection?: { locked?: boolean; hidden?: boolean }; // only takes effect once sheet protection exists (later)
}
```

#### 3.5.1 Font

```ts
export interface Font {
  name?: string;                       // 'Calibri'
  size?: number;                       // points
  color?: Color;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting'; // true = 'single'
  strike?: boolean;
  vertAlign?: 'superscript' | 'subscript' | 'baseline';
  /** Font family class: 0 n/a, 1 Roman, 2 Swiss, 3 Modern, 4 Script, 5 Decorative. */
  family?: number;
  charset?: number;
  scheme?: 'major' | 'minor' | 'none';
  outline?: boolean;                   // Mac-only rendering
  shadow?: boolean;                    // Mac-only rendering
  condense?: boolean;
  extend?: boolean;
}
```

In rich-text runs the writer emits `rFont` instead of `name`, as `CT_RPrElt` requires.

#### 3.5.2 Fill

```ts
/** A string is shorthand for a solid fill in that colour: fill: 'FFFF00'. */
export type Fill = string | PatternFill | GradientFill;

export interface PatternFill {
  type?: 'pattern';
  pattern: PatternType;
  /** Pattern colour. For 'solid' this is the cell colour (OOXML puts a solid fill in fgColor). */
  fgColor?: Color;
  bgColor?: Color;
}

export type PatternType =
  | 'none' | 'solid' | 'mediumGray' | 'darkGray' | 'lightGray'
  | 'darkHorizontal' | 'darkVertical' | 'darkDown' | 'darkUp' | 'darkGrid' | 'darkTrellis'
  | 'lightHorizontal' | 'lightVertical' | 'lightDown' | 'lightUp' | 'lightGrid' | 'lightTrellis'
  | 'gray125' | 'gray0625';            // ST_PatternType, all 19 values

export interface GradientFill {
  type: 'gradient';
  gradient: 'linear' | 'path';
  degree?: number;                     // linear only
  left?: number; right?: number; top?: number; bottom?: number; // path only, 0..1
  stops: Array<{ position: number; color: Color }>;           // position 0..1
}
```

The writer always reserves `fills[0] = none` and `fills[1] = gray125`, which Excel requires. User fills start at index 2.

#### 3.5.3 Border

```ts
export interface Border {
  left?: BorderSide;
  right?: BorderSide;
  top?: BorderSide;
  bottom?: BorderSide;
  diagonal?: BorderSide;
  diagonalUp?: boolean;
  diagonalDown?: boolean;
}

export interface BorderSide {
  style: BorderStyle;
  color?: Color;                       // default: automatic (black)
}

/** ST_BorderStyle, all 14 values. */
export type BorderStyle =
  | 'none' | 'thin' | 'medium' | 'thick' | 'double' | 'hair'
  | 'dotted' | 'dashed' | 'dashDot' | 'dashDotDot'
  | 'mediumDashed' | 'mediumDashDot' | 'mediumDashDotDot' | 'slantDashDot';
```

Each side is independent, with its own style and colour. The writer emits the sides in schema order (`left`, `right`, `top`, `bottom`, `diagonal`), because Excel rejects out-of-order elements. `borderAll(side)` (§4.4) builds the common "all four sides" border (issue #34).

#### 3.5.4 Alignment

```ts
export interface Alignment {
  horizontal?: 'general' | 'left' | 'center' | 'right' | 'fill' | 'justify' | 'centerContinuous' | 'distributed';
  vertical?: 'top' | 'center' | 'bottom' | 'justify' | 'distributed';
  wrapText?: boolean;
  shrinkToFit?: boolean;
  /** Indent level, in steps of about three character widths. Excel shows it for left, right and distributed. */
  indent?: number;                     // Excel UI caps at 250 [to verify: conformance.md, 09-alignment]
  /** Degrees, -90..90, positive = counter-clockwise; or 'vertical' for stacked text. */
  rotation?: number | 'vertical';
  readingOrder?: 'context' | 'ltr' | 'rtl';
  justifyLastLine?: boolean;
}
```

Mapping to `CT_CellAlignment`:

| Model | OOXML |
|---|---|
| `rotation: 0..90` | `textRotation="0".."90"` |
| `rotation: -1..-90` | `textRotation="91".."180"` (that is, `90 - rotation`) |
| `rotation: 'vertical'` | `textRotation="255"` |
| `readingOrder: 'context' / 'ltr' / 'rtl'` | `readingOrder="0" / "1" / "2"` |

#### 3.5.5 Number formats

```ts
/** number = built-in format id (0..163); string = format code. */
export type NumFmt = number | string;
```

- **Numbers are built-in ids.** The writer emits `numFmtId` with no `<numFmt>` element. Ids that the spec does not define, or defines only per locale, are accepted but render differently by locale (§11.2).
- **Strings are custom codes**, written as `<numFmt>` with ids allocated from 164 upward, one per distinct code. The one exception is `'General'`, which maps to id 0. The writer does not map other strings to built-in ids, because a built-in id such as 14 renders in the user's locale while the string `'mm-dd-yy'` should render literally (§12 Q5).
- The reader returns built-in ids as numbers and custom codes as strings, so `read` then `write` keeps formats unchanged.
- `BUILTIN_NUM_FMTS` exports the spec table (§11.2), `isDateFormat(fmt)` the detection rule from §3.4.1.
- `javascript-excel/format` (§5.7) renders number formats: `1234.5` with `#,##0.00` shows as `1,234.50` (§12 Q14).

#### 3.5.6 Colour

```ts
/**
 * string: 'RRGGBB', 'AARRGGBB', '#RRGGBB' or '#AARRGGBB' (case-insensitive) = { rgb }.
 * The writer normalises to upper-case ARGB, with alpha FF when omitted.
 */
export type Color =
  | string
  | { rgb: string }                    // ARGB 'FF336699'
  | { theme: number; tint?: number }   // theme colour index 0..11, tint -1..1
  | { indexed: number }                // legacy palette 0..63, 64 = system foreground, 65 = system background [to verify 64/65: conformance.md, 12-colours]
  | { auto: true };                    // automatic colour
```

All four forms map one to one to `CT_Color` attributes (`rgb`, `theme` + `tint`, `indexed`, `auto`), and the reader returns the same form the file used. The reader returns object forms only, never the string shorthand. Notes:

- **Alpha.** Excel ignores the alpha byte of `rgb`; the writer still writes it.
- **Theme index order.** The index refers to the theme's `clrScheme` with the first two pairs swapped: 0 = `lt1` (Background 1), 1 = `dk1` (Text 1), 2 = `lt2`, 3 = `dk2`, 4–9 = `accent1`–`accent6`, 10 = `hlink`, 11 = `folHlink` `[to verify: conformance.md, 12-colours]`.
- **Tint** is applied to the HSL luminance as in ECMA-376 §18.8.19 (`CT_Color/@tint`).
- **Resolving.** `resolveColor(color, { theme, indexedColors })` (§4.4) returns a concrete ARGB string. It uses the file's theme and palette, or the defaults (the Office theme and the standard 64-colour palette) when the file has none. The viewer and `fromTable` need it.
- On write, theme colours refer to the default Office theme that the writer embeds as `xl/theme/theme1.xml`. Custom themes are not written in 2.0.

```ts
export interface Theme {
  /** ARGB in clrScheme order: dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink. */
  colors: string[];
  majorFont?: string;                  // latin typeface
  minorFont?: string;
}
```

#### 3.5.7 Style resolution on write

A cell's written style is a deep merge, with later layers winning field by field:

`sheet.defaultStyle` → `colProps[c].style` → `rowProps[r].style` → `cell.style`

`font`, `alignment`, `protection` and each `border` side merge by field. `fill` and `numFmt` replace as a whole. Excel itself does not inherit like this: each cell's `xf` is complete, and row and column styles only apply to cells created later. The writer therefore resolves each cell's full style. It also writes the row and column styles themselves (`row/@s`, `col/@style`), so new cells typed in Excel pick them up (§12 Q4).

The reader does the reverse: `cell.style` is the cell's own complete `xf`, and `rowProps`/`colProps` carry the row and column styles. It does not try to factor shared parts back out. Cells that use the same `xf` share one frozen (`Object.freeze`) `Style` object (§12 Q8). To change a style, copy it first: `{ ...cell, style: mergeStyles(cell.style, change) }`. A cell whose `xf` is the default (index 0) has no `style`.

### 3.6 Sheet view, freeze panes, RTL, autofilter, merges, hyperlinks

```ts
export interface SheetView {
  /** Frozen panes: rows above and columns left of the split stay visible. */
  freeze?: { rows?: number; cols?: number };
  rightToLeft?: boolean;               // sheetView/@rightToLeft: column A on the right
  showGridLines?: boolean;             // default true
  showRowColHeaders?: boolean;         // default true
  zoom?: number;                       // percent, 10..400
  activeCell?: string;                 // 'B2'
  selection?: string;                  // 'B2:D5'
}
```

- `freeze: { rows: 1 }` writes `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`, with `xSplit`, `topLeftCell` and `activePane` adjusted when `cols` is set. The reader reads only `state="frozen"` or `"frozenSplit"` panes into `freeze`; plain split panes are ignored with a warning.
- `rightToLeft` flips the sheet. It is separate from `alignment.readingOrder`, which sets text direction per cell.
- `autoFilter: 'A1:F1'` writes `<autoFilter ref>` and the hidden defined name `_xlnm._FilterDatabase`, local to the sheet. Filter criteria are not modelled.
- `merges`: the writer throws `OVERLAPPING_MERGE` when ranges overlap, which Excel would otherwise repair. Values in covered cells (every cell but the top-left) are written as given. Excel keeps them hidden.
- `view.activeCell` and `view.selection` write a `<selection>` element, in the active pane when panes are frozen (the active cell defaults to the pane's top-left cell). `zoom` writes `zoomScale` and `zoomScaleNormal`.
- `tabColor` takes any `Color` and is written in `sheetPr`.
- Hyperlinks are set per cell (`Cell.hyperlink`). The writer collects them into `<hyperlinks>`. External targets go to the sheet's relationships (`xl/worksheets/_rels/sheetN.xml.rels`, one relationship per distinct URL) with `TargetMode="External"`. Internal locations use `@location`. The cell's value is the display text, and the cell keeps its own style (no automatic blue underline). External targets must have a scheme in `WriteOptions.hyperlinkSchemes`, matched case-insensitively (default `http`, `https`, `mailto`). URLs without a scheme (relative paths), and URLs with control characters, throw `INVALID_HYPERLINK`. A hyperlink in a file whose `ref` spans a range is attached to its top-left cell, with warning `HYPERLINK_RANGE_REDUCED`.

### 3.7 Print setup

```ts
export interface PrintSetup {
  orientation?: 'portrait' | 'landscape';
  /** ST paper size code, e.g. 1 = Letter, 9 = A4. */
  paperSize?: number;
  /** Fit to N pages wide / tall; 0 = automatic. Sets sheetPr/pageSetUpPr/@fitToPage. */
  fitTo?: { width?: number; height?: number };
  scale?: number;                      // percent, 10..400; ignored when fitTo is set
  margins?: { left?: number; right?: number; top?: number; bottom?: number; header?: number; footer?: number }; // inches
  center?: { horizontal?: boolean; vertical?: boolean };
  gridLines?: boolean;
  headings?: boolean;
  /** Written as the _xlnm.Print_Area defined name. */
  printArea?: string;                  // 'A1:F40'
  /** Written as _xlnm.Print_Titles. Rows '1:2', columns 'A:B'. */
  printTitles?: { rows?: string; cols?: string };
  /** Raw header/footer strings with Excel's &-codes, e.g. '&CPage &P of &N'. */
  header?: { odd?: string; even?: string; first?: string };
  footer?: { odd?: string; even?: string; first?: string };
}
```

"Fit to width" is `fitTo: { width: 1 }`. A `fitTo` side that is omitted is written as 0 (automatic). Excel's own default for a missing attribute is 1, so the writer always writes both. `<pageMargins>` is always written, with Excel's "Normal" margins (0.7, 0.7, 0.75, 0.75, 0.3, 0.3 inches) for any side not given. `<pageSetup>`, `<printOptions>` and `<headerFooter>` are written only when set. An even header or footer sets `differentOddEven`, and a first-page one sets `differentFirst`.

---

## 4. Builders and helpers

All helpers are pure functions exported from `javascript-excel`.

### 4.1 Addresses

```ts
export interface CellAddress { row: number; col: number }       // zero-based
export interface RangeAddress { start: CellAddress; end: CellAddress }

export function encodeCol(col: number): string;                  // 0 -> 'A', 16383 -> 'XFD'
export function decodeCol(letters: string): number;
export function encodeCell(a: CellAddress): string;              // { row: 0, col: 1 } -> 'B1'
export function decodeCell(ref: string): CellAddress;            // accepts '$B$1'
export function encodeRange(r: RangeAddress): string;
export function decodeRange(ref: string): RangeAddress;          // 'A1:C3'; 'A1' = single cell
```

Out-of-bounds or malformed refs throw `INVALID_REF`.

### 4.2 Cell access

```ts
export function getCell<C>(sheet: Sheet<C>, ref: string | CellAddress): C | undefined;
export function setCell<C>(sheet: Sheet<C>, ref: string | CellAddress, cell: C): void;   // mutates sheet.rows
export function cellText(cell: CellInput, options?: { dateZone?: 'local' | 'utc' }): string; // rich text joined, errors as '#N/A', dates ISO 8601, formulas as their cached value
```

### 4.3 `fromDataset`: the `{ columns, data }` shape

This is the main builder. It serves react-data-export's dataset export and any vanilla or Vue user.

```ts
export function fromDataset<T>(dataset: Dataset<T>, options?: DatasetOptions<T>): Sheet;

/** Several blocks stacked on one sheet (replaces the old xSteps/ySteps). */
export function fromDatasets(
  blocks: Array<DatasetBlock<any>>,                // Dataset & { offset?: { rows?: number; cols?: number } }
  options?: DatasetOptions<any> & { gap?: number }, // empty rows between blocks, default 1
): Sheet;

export interface Dataset<T> {
  /** Falsy entries are skipped (conditional columns). Omitted: inferred from the keys of the first object row. */
  columns?: Array<ColumnDef<T> | null | false | undefined>;
  /** Objects (picked by key/path/value) or arrays (picked by index). */
  data: readonly T[];
}

export type ColumnDef<T> = LeafColumn<T> | GroupColumn<T>;

export interface GroupColumn<T> {
  /** Header group: its title spans its leaf columns (a merged header cell). */
  title: string | RichText | Cell;
  headerStyle?: Style;
  children: Array<ColumnDef<T> | null | false | undefined>;
}

export interface LeafColumn<T> {
  title?: string | RichText | Cell;    // header cell; default: key/path, or '' for value/index accessors
  // Accessor: use exactly one. With none: array rows use the leaf position, object rows throw INVALID_COLUMN.
  /** Own property name, taken literally ('a.b' is a key containing a dot). */
  key?: string;
  /** Path into nested data: 'a.b', 'items[0].name', "a['x.y']". */
  path?: string;
  /** Computed value. */
  value?: (row: T, ctx: { rowIndex: number }) => CellInput;
  /** Array rows: index into the row. */
  index?: number;

  /** Coerce data cells (see the table below). Default 'auto': take values as they are. */
  type?: 'auto' | 'string' | 'number' | 'boolean' | 'date' | 'datetime';
  numFmt?: NumFmt;
  style?: Style;                       // data cells of this column
  headerStyle?: Style;                 // overrides options.headerStyle
  width?: ColumnWidth | 'auto';
  hidden?: boolean;
  /** Totals row entry for this column. */
  total?: ColumnTotal; // 'sum' | 'average' | 'count' | 'min' | 'max' | CellInput | ((ctx: { range: string; values: CellValue[] }) => CellInput)
}

export interface DatasetOptions<T> {
  name?: string;                       // sheet name, default 'Sheet1'; an invalid name throws (§12 Q19)
  origin?: string;                     // top-left cell of the block, default 'A1'
  header?: boolean;                    // write header rows, default true
  headerStyle?: Style;                 // default { font: { bold: true } }
  freezeHeader?: boolean;              // freeze all header rows, default false
  autoFilter?: boolean;                // last header row through last data row (totals excluded), default false
  autoWidth?: boolean | AutoWidthOptions; // default false
  rightToLeft?: boolean;
  totals?: { label?: string; style?: Style }; // label goes in the first leaf column if it has no total
  rowStyle?: (row: T, rowIndex: number) => Style | undefined;
  onWarning?: (w: ExcelWarning) => void;
}

export interface AutoWidthOptions {
  min?: number;                        // characters, default 8.43 (Excel default)
  max?: number;                        // characters, default 60 (a readability choice made in JSE-4, not a measurement); cap 255
  sampleRows?: number;                 // rows measured, default all (JSE-8: measuring every row of 1M cells cost no more than run-to-run noise)
}
```

Behaviour:

- **Header groups.** The header depth is the deepest `children` nesting. A group's title is merged across its leaf columns. A leaf that sits higher than the deepest level is merged down to the last header row (rowspan). Example: `[{ title: 'Name', key: 'name' }, { title: 'Q1', children: [{ title: 'Jan', key: 'jan' }, { title: 'Feb', key: 'feb' }] }]` gives `A1:A2` merged ("Name"), `B1:C1` merged ("Q1"), and "Jan" and "Feb" in row 2.
- **Cells.** An accessor may return a bare value or a full `Cell` (`{ value, style, formula, hyperlink }`). Styles merge as data layer, then `column.style`, then `rowStyle(row)`, then the cell's own style. `numFmt` goes into the column style.
- **Path accessor safety.** Paths read own properties only. The segments `__proto__`, `prototype` and `constructor` throw `INVALID_COLUMN`.
- **Coercion by `type`:**

  | `type` | Accepts | Unconvertible values |
  |---|---|---|
  | `'string'` | anything; `String(v)`, dates as ISO 8601 | — |
  | `'number'` | numbers; strings that fully match a plain decimal or exponent number (no thousands separators, no locale) | written as text, warning `COERCION_FAILED` |
  | `'boolean'` | booleans; `'true'`/`'false'` in any case | written as text, warning |
  | `'date'` | `Date`; ISO 8601 strings; numbers taken as epoch milliseconds | written as text, warning; default `numFmt` 14 |
  | `'datetime'` | as `'date'` | default `numFmt` 22 |

  Non-finite numbers (`NaN`, `±Infinity`) become empty cells with warning `NON_FINITE_NUMBER`, whatever the `type`.
- **Auto width** measures `cellText()` of the header and data cells per column. East Asian wide characters count as two, and a 2-character padding is added; the result is clamped to `[min, max]`. It is an estimate without font metrics. Header-group titles do not widen their leaf columns.
- **Totals.** If any column has `total`, one row follows the data. The built-ins write `SUBTOTAL(109|101|103|105|104, range)` formulas: sum, average, count (`COUNTA`), min, max. Unlike `SUM`, `SUBTOTAL` ignores rows hidden by the autofilter. Each formula gets a **cached value** that the builder computes from the data, so viewers and LibreOffice show the right number without recalculating. The function form receives the column's data range (`'C2:C101'`) and values.
- **Freeze and filter** refer to the actual header rows, so they work with `origin` and header groups.
- **Shared style objects.** Cells of a column share one style object, and banded rows share one merged object per column and `rowStyle` object. The writer's identity cache therefore resolves each distinct style once, however many rows there are. Only a cell's own style makes a new object. As with reader output (§12 Q8), copy a style before editing it.
- **Inferred columns.** Without `columns`, object rows give one column per key of the first object (title = key). Array rows give one column per index and **no header row**.
- **Header styles** layer `options.headerStyle`, then the column's or group's `headerStyle`, then the style of a `Cell` title. A leaf's default title is its `key` or `path`, else `''`.
- **Totals details.**
  - Dates count as their serials.
  - `average` with no numbers caches `#DIV/0!`; `min`/`max` with no numbers cache 0.
  - `count` is `COUNTA` (every non-empty cell, including `''`), and its cell drops the column's number format.
  - A totals cell is styled with the column style, then `totals.style`, then its own style.
  - With no data rows there is no range, so built-ins write their value without a formula.
  - Any other string, such as `'n/a'`, is a literal cell.
- **`fromDatasets`.** The first block starts at `origin` (plus `offset.rows`). Each later block starts `gap` empty rows below the previous block's last row (totals included), or `offset.rows` rows when given. `offset.cols` shifts a block right of the origin. Freeze and filter use the first block that has header rows. A column's width is the first explicit width, or the widest auto measurement across blocks. Gap rows are holes in `rows`.

```ts
/** Inverse direction, for import: a sheet back to { columns, data }. */
export function toDataset(sheet: Sheet<Cell> | Sheet, options?: ToDatasetOptions): DatasetResult;

export interface ToDatasetOptions {
  headerRow?: number | false;          // zero-based row index, default 0; false = keys are column letters
  range?: string;                      // default: sheet.dimension, else the used range
  values?: 'value' | 'cell';           // 'value' (default): CellValue (a formula gives its cached value); 'cell': the full Cell
  skipTotals?: 'auto' | boolean;       // drop a trailing totals row; default 'auto' (see below)
  headerRows?: number;                 // header rows from headerRow on, flattened into one title; default 1
  join?: string;                       // joins the parts of a multi-row title; default ' / '
}
export interface DatasetResult { columns: Array<{ title: string; key: string }>; data: Array<Record<string, unknown>> }
```

`toDataset` builds keys from header text (trimmed), deduplicated with `_2`, `_3` suffixes; an empty header gives the column letter. Empty cells are `null`, rows with no values are skipped, and with `values: 'cell'` a bare value is returned as `{ value }`. It also accepts a builder-made `Sheet`, so `toDataset(fromDataset(ds))` gives the flat data back.

**Totals rows.** With `skipTotals: 'auto'` (the default), the last data row is dropped when it contains at least one formula and every formula in it is `SUBTOTAL(…)`. That is the totals row `fromDataset` writes, and a label such as "Total" may sit next to the formulas. So `toDataset(read(write(fromDataset(ds))))` returns the data rows only. `true` always drops the last row, and `false` keeps every row. A sheet whose genuine last data row is all `SUBTOTAL` formulas needs `skipTotals: false`. Rows are **null-prototype objects** (`Object.create(null)`), so a header named `__proto__` from an untrusted file is just a key.

**Multi-row headers.** With `headerRows: n`, the title of each column joins the text of rows `headerRow` to `headerRow + n - 1` with `join`, skipping empty parts. Merged cells are expanded first, so a group title merged over three columns prefixes all three ("Q1 / Jan", "Q1 / Feb", "Q1 / Mar"), and a title merged down through the header rows appears once ("Name"). That reads back the header groups `fromDataset` writes. Data starts after the last header row. Header detection, type inference and column mapping are in `javascript-excel/import` (§5.6).

### 4.4 Style and colour helpers

```ts
export function mergeStyles(...styles: Array<Style | undefined>): Style;   // the §3.5.7 merge
export function borderAll(side: BorderSide): Border;                     // same side on left/right/top/bottom
export function resolveColor(color: Color, ctx?: { theme?: Theme; indexedColors?: string[] }): string; // ARGB
export const BUILTIN_NUM_FMTS: Readonly<Record<number, string>>;
export function isDateFormat(fmt: NumFmt): boolean;
```

### 4.5 Dates

```ts
export function dateToSerial(d: Date, opts?: { date1904?: boolean; dateZone?: 'local' | 'utc' }): number;
export function serialToDate(serial: number, opts?: { date1904?: boolean; dateZone?: 'local' | 'utc' }): Date;
```

### 4.6 Names

```ts
/** Replaces forbidden characters with '_', trims apostrophes, truncates to 31, falls back to 'Sheet'. */
export function sanitizeSheetName(name: string): string;
/** Returns null when valid, or the reason. */
export function validateSheetName(name: string): null | 'empty' | 'too-long' | 'forbidden-char' | 'apostrophe' | 'reserved';
```

---

## 5. Write, read, CSV, DOM, worker, import, format and render APIs

### 5.1 Write (`javascript-excel`)

```ts
export function toUint8Array(wb: Workbook, options?: WriteOptions): Promise<Uint8Array>;
export function toBlob(wb: Workbook, options?: WriteOptions): Promise<BlobType>; // type: XLSX_MIME
// BlobType, BinaryInput and AbortSignalLike are shared by every entry point; see "Shared types" at the end of §5.3.

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface WriteOptions {
  /** 'deflate' (default) or 'store' (no compression; faster, bigger). */
  compression?: 'deflate' | 'store';
  /** Shared strings table (default true) or inline strings (false: less memory, larger files). */
  sharedStrings?: boolean;
  /** Time zone used to turn Date into serials. Default 'local'. */
  dateZone?: 'local' | 'utc';
  /** Allowed URL schemes for external hyperlinks. Default ['http', 'https', 'mailto']. */
  hyperlinkSchemes?: string[];
  signal?: AbortSignalLike;
  onProgress?: (p: Progress) => void;
}

export interface Progress {
  phase: 'prepare' | 'styles' | 'sheets' | 'zip' | 'unzip' | 'parse';
  sheet?: string;
  /** Overall progress estimate 0..1, non-decreasing. */
  ratio: number;
}
```

- Invalid input throws `ValidationError` (§7), and no bytes are returned. Workbook-level checks (sheet names, active sheet, document properties) run first. Cells and styles are checked as their sheet is written, which is still before the archive is complete. The writer emits no warnings: any input it cannot write faithfully is an error.
- Parts written: `[Content_Types].xml`, `_rels/.rels`, `docProps/core.xml`, `docProps/app.xml`, `docProps/custom.xml` (if any), `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml`, `xl/theme/theme1.xml`, `xl/sharedStrings.xml` (if used), `xl/worksheets/sheetN.xml` and `xl/worksheets/_rels/sheetN.xml.rels` (for hyperlinks).
- XML is produced as chunk arrays and fed to the compressor in pieces; the whole sheet is never built as one string. The output is assembled in memory, so peak memory is roughly the model plus the compressed file.
- **Deterministic output:** the same model and options give identical bytes when `properties.created` and `properties.modified` are set. Zip entry timestamps come from `modified`.
- Abort: rejects with `signal.reason` (a `DOMException` named `AbortError` by default), the same as `fetch`. The writer checks the signal between sheet XML chunks (about 64 K characters each). Every chunk goes through the platform's `CompressionStream`, which already returns to the event loop, so no explicit yielding is added: JSE-8 measured the longest main-thread block of a 1M-cell write at 11–18 ms on an Apple-silicon laptop and 22–28 ms on a GitHub Actions runner (unique strings and per-cell style objects included), and of a read at 3–10 ms and 7–18 ms. That is under the 50 ms long-task threshold, and the README has the full table. The shared strings table is written in chunks too. Before JSE-8 it was built as one string, which blocked for 161 ms at 1M unique strings. For heavy jobs that must not touch the UI thread at all, use `/worker` (§5.5).
- `onProgress` is throttled to one event per 50 ms. The first event, every change of `phase` or `sheet`, and the final `ratio: 1` are always delivered, and `ratio` never decreases. Unthrottled, the reader emitted an event every 0.3 ms and the writer every 7 ms (2,011 and 105 events for 1M cells), which a UI cannot use and which a worker would turn into as many messages. The reader uses the same throttle.

### 5.2 Read (`javascript-excel/read`)

```ts
export type BinaryInput = Uint8Array | ArrayBuffer | BlobType;   // Node Buffer is a Uint8Array; BlobType: §5.3

export function read(input: BinaryInput, options?: ReadOptions): Promise<ReadResult>;
export function readSheetNames(input: BinaryInput, options?: Pick<ReadOptions, 'limits' | 'signal'>): Promise<SheetInfo[]>;
export function detectFormat(input: BinaryInput): Promise<DetectedFormat>;   // never throws for unreadable input

export interface SheetInfo { name: string; index: number; state: 'visible' | 'hidden' | 'veryHidden' }
export type DetectedFormat = 'xlsx' | 'xlsm' | 'xltx' | 'xltm' | 'xlsb' | 'ods' | 'cfb' | 'zip' | 'unknown'; // 'cfb' = .xls or an encrypted OOXML file

export interface ReadResult {
  workbook: Workbook<Cell>;
  warnings: ExcelWarning[];
}

export interface ReadOptions {
  /** Only parse these sheets (by name or index); the others are listed with empty rows. Default: all. */
  sheets?: Array<string | number>;
  /** Parse styles (default true). false is faster: no cell.style, but date detection still uses numFmt. */
  styles?: boolean;
  /** Return formula text (default true). false: cached values only. */
  formulas?: boolean;
  /** 'date' (default): date-formatted numbers become Date. 'serial': leave as numbers. */
  dates?: 'date' | 'serial';
  dateZone?: 'local' | 'utc';          // default 'local'
  /** Rich text as runs (default) or flattened to a plain string. */
  richText?: 'runs' | 'plain';
  /** Read only rows 0..maxRows-1 of each parsed sheet; later rows are skipped (ROWS_TRUNCATED). Default: all. */
  maxRows?: number;
  limits?: Partial<ReadLimits>;
  signal?: AbortSignalLike;            // a DOM or Node AbortSignal (§5.3)
  onProgress?: (p: Progress) => void;
  onWarning?: (w: ExcelWarning) => void; // called as warnings occur, in addition to ReadResult.warnings
}

export interface ReadLimits {
  maxInputBytes: number;
  maxEntries: number;
  maxEntryBytes: number;               // decompressed bytes of one part
  maxTotalBytes: number;               // decompressed bytes of all parts read
  maxRatio: number;                    // decompressed / compressed, per entry
  maxXmlDepth: number;
  maxCells: number;                    // all sheets together
  maxSharedStrings: number;
  maxWarnings: number;                 // then a single WARNINGS_TRUNCATED
}

export const DEFAULT_READ_LIMITS: Readonly<ReadLimits>;
```

Defaults, measured in JSE-6 (method below):

| Limit | Default | Evidence |
|---|---|---|
| `maxInputBytes` | 256 MiB | 2,000,000 dense random numbers are a 26 MB file, so 256 MiB is roughly 20M dense cells, beyond `maxCells` |
| `maxEntries` | 10,000 | 250 sheets are 258 parts; ordinary files have 9–15 |
| `maxEntryBytes` | 512 MiB | 2M dense cells are a 96 MB sheet part (about 48 bytes per cell), so a sheet at `maxCells` fits |
| `maxTotalBytes` | 1 GiB | Twice `maxEntryBytes`; the largest corpus file inflates to 96 MB |
| `maxRatio` | 1,000, per entry, checked once the entry has produced more than 1 MiB | Real files: 4–27 when cells carry `r` references (openpyxl); 412 for `<row><c><v>1</v></c></row>` repeated (JSE-2) and 686 for `<row/>` repeated, from writers that omit `r`. Raw DEFLATE peaks at about 1,028 (20 MB of zeros). So 1,000 accepts every legitimate shape and stops near-maximal bombs. The ratio is inflated bytes over the entry's whole compressed size, so no entry inflates to more than 1,000 times its stored size, whatever `maxEntryBytes` allows |
| `maxXmlDepth` | 64 | Deepest part in the corpus: 7 |
| `maxCells` | 10,000,000 | The reader's model costs 94–275 bytes of heap per cell (108 for dense numbers, 275 with unique strings), so 10M cells is about 1–2.7 GB, the most a browser tab or a default Node heap holds |
| `maxSharedStrings` | 5,000,000 | About 260 bytes of heap per short unique string with its cell (unique-strings file); stops a part of tiny `<si>` items (up to 44M in 512 MiB) before it exhausts memory |
| `maxWarnings` | 1,000 | Then a single `WARNINGS_TRUNCATED` |

Method: `test/fixtures/read/generate_corpus.py` (openpyxl 3.1.5) writes dense, repetitive-number, repetitive-string, styled-empty, many-sheet, long-text and unique-string workbooks of 0.5–2M cells; `test/fixtures/read/measure_limits.mjs` reports entries, sizes, ratios, XML depth and read time for each, and heap per cell was measured with `--expose-gc` around `read()`. Reading 2M dense cells took 1.8 s on an Apple-silicon laptop (Node 24); performance proper is JSE-8.

Spreadsheet format limits are always enforced and cannot be configured: 1,048,576 rows, 16,384 columns (`XFD`). A cell reference beyond them is skipped with warning `CELL_OUT_OF_BOUNDS`.

How the reader works, as far as the API is concerned:

- The whole archive is held in memory, because the zip central directory sits at the end of the file. Parts are inflated one at a time and streamed through the XML pull tokenizer, so a sheet's XML is never held whole. The shared strings table is held whole.
- Parts are found through relationships (`_rels/.rels` → workbook → sheets), never by fixed path, so files from Google Sheets, Numbers and LibreOffice, which use different part names, work. Part names are compared case-insensitively, as OPC requires. Absolute and relative relationship targets are both resolved.
- Cells and rows without an `r` attribute (allowed by the schema) are placed by position. A missing or wrong `<dimension>` is ignored; `sheet.dimension` is computed from the cells.
- ISO/IEC 29500 Strict files are read like transitional ones (§12 Q9): the tokenizer reports names without namespace prefixes, relationship types are matched by their last path segment (`/worksheet`, `/sharedStrings`, …), which Strict and transitional share, and `t="d"` (ISO 8601 date) cells are read. The writer writes transitional only.
- **Formats.** Detection is a table: the container signature (CFB, zip), then the content type of the workbook part, each entry naming the decoder that reads it. `.xlsx`, `.xltx`, `.xlsm` and `.xltm` share the SpreadsheetML decoder; for the macro-enabled two, one `UNSUPPORTED_PART` warning says the VBA macros are not read or run. Formats without a decoder in 2.0 throw `UNSUPPORTED_FORMAT` with `details.format`: `'cfb'` (`.xls`, or an encrypted/password-protected `.xlsx`, which is a CFB container), `'xlsb'`, `'ods'`, `'unknown'` (no zip signature). They are a phase boundary, not a design limit: supporting `.xlsb` or `.xls` later is a new decoder plus its table row. A zip without a workbook part is `NOT_XLSX`. A workbook part with a missing or unknown content type is read as SpreadsheetML (`.bin` as `.xlsb`).
- **Unread parts are not lost at the zip level.** The reader parses only the parts the model represents, but the archive stays addressable by part name until the read ends, and an internal (not yet public) option returns every unparsed part byte for byte. A later release can use it to carry drawings, comments, VBA or custom XML through a read-modify-write.
- Unsupported content (drawings, charts, comments, pivot tables, tables, OLE objects, form controls, VBA, external links, chart sheets, …) gives one `UNSUPPORTED_PART` warning per kind. Chart, dialog and macro sheets are not worksheets: they are left out of `sheets` and `readSheetNames`, and defined names local to them are dropped.
- Styles: each `cellXfs` entry is one frozen `Style` (§12 Q8). Pattern fills come back with `type: 'pattern'`, so `fill.type` tells pattern and gradient fills apart. A style records only what differs from the defaults: font 0 (the workbook default font), fills 0 and 1 (the required `none` and `gray125` placeholders) and border 0 are left out, and `numFmtId` 0 (General) gives no `numFmt`. `applyFont` and the other apply flags are ignored, as Excel does for cell formats.
- Values: `t="s"`, `"inlineStr"` and `"str"` are strings (or rich text), with `_xHHHH_` escapes decoded; `"b"` booleans; `"e"` errors, including codes newer than the seven of ECMA-376 (`#SPILL!`, `#CALC!`, …), returned as written; `"d"` ISO dates; numbers otherwise, converted to `Date` when their number format is a date format (§3.4.1). A formula's cached value sets `value` and `type`; without one the cell is `type: 'empty'` with its `formula`. Shared formulas are expanded (§12 Q6); data-table formulas (`t="dataTable"`) give their cached values only.
- **`maxRows`** (for previews and import limits, §5.6):
  - **Rows:** on the first row at or beyond `maxRows`, the sheet parser jumps to the end of `<sheetData>` with a plain text search, without tokenizing the skipped rows. The elements after it (merges, hyperlinks, views, autofilter, print setup) are still read, and one `ROWS_TRUNCATED` warning is reported per sheet. Rows are stored in ascending order (ECMA-376 §18.3.1.73 `[to verify]`), so nothing below the limit is lost.
  - **Shared strings:** the table is decoded after the sheets, and only up to the highest index the rows read use; the rest of the part is skipped the same way. So `maxSharedStrings` only applies to the entries decoded. A string index past the table gives `INVALID_SHARED_STRING`, as on the full path; the sheet's `dimension` was already computed by then and may still include that dropped cell.
  - **Still read in full:** the sheet and shared-string parts are still inflated to the end.
  - **Without `maxRows`,** shared strings are parsed before the sheets, as always.
  - **Measured** on a 100,000 × 10 sheet (`styles: false`, median of 7 reads, Node 26 on an Apple M2 under light load):

    | sheet | full read | `maxRows: 25` |
    |---|---|---|
    | numbers only | 517 ms | 77 ms |
    | 1M unique strings | 941 ms | 166 ms (412 ms before the shared strings were decoded lazily) |
- Column widths: the file stores characters plus padding (ECMA-376 §18.3.1.13); the reader converts back to the characters Excel's UI shows, the unit `ColumnWidth` uses, so a width of 20 written by the writer reads back as 20. Files from tools that store the UI value directly (openpyxl writes `30` for 30) read as Excel shows them (29.29).
- Print setup: the `_xlnm.Print_Area` and `_xlnm.Print_Titles` defined names become `sheet.print.printArea` and `printTitles` and are not repeated in `definedNames`; `_xlnm._FilterDatabase` is implied by `sheet.autoFilter` and dropped.

### 5.3 CSV (`javascript-excel/csv`)

```ts
export function parseCsv(text: string, options?: CsvParseOptions): CsvParseResult;
export function readCsv(input: string | BinaryInput, options?: CsvReadOptions): Promise<CsvParseResult>;
export function toCsv(source: Sheet | CellInput[][], options?: CsvWriteOptions): string;
export function toCsvBlob(source: Sheet | CellInput[][], options?: CsvWriteOptions): BlobType; // type: CSV_MIME

export const CSV_MIME = 'text/csv;charset=utf-8';

export interface CsvParseOptions {
  /** A single character, or 'auto' (default): picks from , ; TAB | by field-count consistency over the first records. */
  delimiter?: string | 'auto';
  quote?: string;                      // default '"'; a quote inside a quoted field is doubled (RFC 4180)
  /**
   * Default false: every field is a string. true: unquoted fields that are numbers, TRUE/FALSE
   * (or true/false) or ISO 8601 dates become numbers, booleans and Dates. No locale guessing.
   * Quoted fields always stay strings.
   */
  inferTypes?: boolean;
  dateZone?: 'local' | 'utc';          // ISO dates without an offset (inferTypes); default 'local' (§12 Q2)
  skipEmptyLines?: boolean;            // default false: a blank line gives an empty row []
  /** 'lenient' (default): malformed input gives warnings. 'strict': throws CsvError. */
  mode?: 'lenient' | 'strict';
  maxRows?: number;                    // default unlimited; stops reading with warning CSV_ROWS_TRUNCATED
  maxFieldBytes?: number;              // default 1,048,576 (1 MiB of UTF-8); a bigger field throws LimitError
}

export interface CsvReadOptions extends CsvParseOptions {
  encoding?: string;                   // used without a BOM; any TextDecoder label; default 'utf-8'
  signal?: AbortSignalLike;            // a DOM or Node AbortSignal
}

export interface CsvParseResult {
  rows: CellValue[][];                 // string[][] unless inferTypes
  delimiter: string;                   // the one used (detected or given)
  newline: '\r\n' | '\n' | '\r';       // the first one seen; '\r\n' when the input has none
  bom: boolean;                        // input started with a BOM (removed from the data)
  warnings: ExcelWarning[];            // CSV_UNTERMINATED_QUOTE, CSV_STRAY_QUOTE, CSV_FIELD_COUNT, CSV_INVALID_ENCODING, CSV_ROWS_TRUNCATED
}

export interface CsvWriteOptions {
  delimiter?: string;                  // default ','
  newline?: '\r\n' | '\n';             // default '\r\n' (RFC 4180), also after the last record
  quote?: 'auto' | 'all';              // 'auto' (default): quote fields containing delimiter, quote, CR or LF
  /** Prepend a UTF-8 BOM so Excel detects UTF-8. toCsvBlob default true, toCsv default false. */
  bom?: boolean;
  /** Formula-injection guard, default true. See below. */
  escapeFormulas?: boolean;
  /** Dates: 'iso' (default; YYYY-MM-DD, or YYYY-MM-DDTHH:mm:ss, plus .sss when there are milliseconds) or a function. */
  dates?: 'iso' | ((d: Date) => string);
  dateZone?: 'local' | 'utc';
  /** Formula cells: write the cached value (default) or the formula text ('formula', which still passes the guard). */
  formulas?: 'value' | 'formula';
}
```

**Shared types.** `BinaryInput`, `BlobType`, `BlobLike`, `AbortSignalLike` and `ExcelWarning` are one set of declarations (`src/binary.ts`, `src/signal.ts`, `src/warnings.ts`), exported from the core entry and from `/csv`, and later from `/read`. `BinaryInput` is `Uint8Array | ArrayBuffer | BlobType`. The package compiles without DOM types, so `BlobType` resolves to the platform `Blob` when the consumer's TypeScript setup declares one (lib `dom` or `@types/node`) and to a structural `BlobLike` (`size`, `type`, `arrayBuffer()`) otherwise. `AbortSignalLike` is the structural `{ aborted, reason }` part of `AbortSignal`.

- **Parsing:** one pass, hand-written scanner, no recursion, linear time. RFC 4180 fields and quoting; CRLF, LF and CR are all record separators, and quoted fields may contain any of them. A trailing newline does not add a record. A blank line is an empty row (`[]`), which is never a `CSV_FIELD_COUNT` mismatch.
- **Malformed input** (lenient): an unclosed quote runs to the end of the input (`CSV_UNTERMINATED_QUOTE`); a quote inside an unquoted field is kept, and text after a closing quote is appended to the field, as Python's `csv` module does (`CSV_STRAY_QUOTE`); a record whose field count differs from the first record's is kept (`CSV_FIELD_COUNT`). Warnings carry `ref`, the A1 cell of the record and field, and a message with the line number. At most 1,000 warnings are kept, then one `WARNINGS_TRUNCATED`. `mode: 'strict'` throws `CsvError` `CSV_MALFORMED` instead, with `details: { warning, ref, line }`. `CSV_ROWS_TRUNCATED` is not malformed input and is reported in both modes.
- **Delimiter detection:** over the first 20 records (at most 64 KiB), quote-aware. The candidate whose most common field count (above 1) covers the most records wins; ties go to the earlier of `, ; TAB |`. A single-column file gives `,`.
- **Type inference** (`inferTypes`): numbers in plain decimal or exponent form (`-1.5`, `.5`, `1e3`), but not `007`, `1.`, `0x10`, `Infinity` or integers beyond 2^53, which stay text; `TRUE`/`FALSE`/`true`/`false`; ISO 8601 `YYYY-MM-DD` and `YYYY-MM-DDTHH:mm[:ss[.sss]]` (`T` or space) with optional `Z` or `±HH:mm`, validated (no 2023-02-29). Quoted and empty fields stay strings.
- **Decoding** (`readCsv`): a UTF-8, UTF-16LE or UTF-16BE BOM wins. Otherwise `encoding` applies (any label `TextDecoder` accepts; an unknown label is a `TypeError`), default `'utf-8'`. Invalid bytes become U+FFFD with warning `CSV_INVALID_ENCODING` (strict mode: `CSV_MALFORMED`).
- **Async:** `readCsv` parses in chunks of about 1M characters, yields to the event loop between them and checks `signal`; an abort rejects with `signal.reason`, as `fetch` does. `parseCsv` is synchronous.
- **Options** that are not valid (a delimiter that is not one character, or is CR, LF or the quote; an unknown enum value) throw `TypeError`.
- **Serialising values:** numbers as `String(n)` (shortest round-trip, never locale-formatted; `NaN`/`±Infinity` throw `INVALID_NUMBER`), booleans as `TRUE`/`FALSE`, errors as their code, rich text as plain text, empty cells as empty fields, invalid `Date`s throw `INVALID_DATE`. A `Sheet` is serialised from `A1` to its last used cell as a rectangle (a cell is used when it has a value or a formula; style alone does not count); merges, styles and hyperlinks are dropped. A `CellInput[][]` is written as given, so ragged rows stay ragged.
- **Formula-injection guard (on by default).** A **string** field that starts with `=`, `+`, `-`, `@`, TAB (`\t`) or CR (`\r`) is written with a leading `'`, so a spreadsheet app opening the CSV treats it as text. This covers plain strings, rich text, string cached values of formula cells, and formula text with `formulas: 'formula'`. Numbers, booleans and dates from the model are not strings and are never prefixed, so `-5` stays `-5`; the output of a custom `dates` function is not prefixed either. `escapeFormulas: false` turns the guard off. The guard is one-way: reading the file back gives the prefixed text. It applies to `toCsv` and `toCsvBlob` only; the xlsx writer does not need it, because xlsx cells have explicit types (§3.4).

### 5.4 DOM (`javascript-excel/dom`)

```ts
export function fromTable(table: TableElement, options?: FromTableOptions): Sheet;
export function download(data: Uint8Array | BlobType | string, filename: string, options?: DownloadOptions): void;
export const DOWNLOAD_REVOKE_DELAY_MS: number; // 40 000

/** HTMLTableElement / HTMLTableCellElement when the consumer has DOM types, else `object`. */
export type TableElement = typeof globalThis extends { HTMLTableElement: { prototype: infer T } } ? T : object;
export type TableCellElement = typeof globalThis extends { HTMLTableCellElement: { prototype: infer T } } ? T : object;

export interface FromTableOptions {
  name?: string;                       // sheet name, default 'Sheet1'; an invalid name throws (§12 Q19)
  /** Which rows are header rows: 'thead' (default) or a fixed row count, or false. Header rows get headerStyle. */
  header?: 'thead' | number | false;
  headerStyle?: Style;                 // default { font: { bold: true } }
  includeFooter?: boolean;             // <tfoot>, default true
  /** Skip rows and cells with the `hidden` attribute or inline display:none. With styles: 'computed', also the computed style. Default true. */
  skipHidden?: boolean;
  /** Rows/cells matching this selector are skipped. Default '[data-export-ignore]'. */
  ignore?: string;
  /** 'none' (default) or 'computed': map getComputedStyle to Style (see below). */
  styles?: 'none' | 'computed';
  /** Infer numbers/booleans from text (default false: text stays text unless a data-type hint says otherwise). */
  inferTypes?: boolean;
  /** The first <a href> in a cell becomes Cell.hyperlink (default true). */
  links?: boolean;
  /** Link schemes kept (default ['http', 'https', 'mailto']); others are dropped with HYPERLINK_DROPPED. */
  hyperlinkSchemes?: string[];
  freezeHeader?: boolean;
  autoFilter?: boolean;
  autoWidth?: boolean | AutoWidthOptions;
  /** Per-cell hook: return a CellInput to override, or undefined to keep the default mapping. */
  cell?: (el: TableCellElement, ctx: { row: number; col: number; header: boolean }) => CellInput | undefined;
  /** Data problems that do not stop the conversion: COERCION_FAILED, HYPERLINK_DROPPED (§7.3). */
  onWarning?: (w: ExcelWarning) => void;
}

export interface DownloadOptions {
  /** Default: a Blob keeps its type; otherwise from the extension (.xlsx, .csv), else text/plain;charset=utf-8 for strings and application/octet-stream for bytes. */
  mimeType?: string;
}
```

- **No globals at import.** The module is safe to import during SSR. `fromTable` reads styles through the table's own window (`ownerDocument.defaultView`), so tables in iframes work. Calling either function without a DOM throws `ENVIRONMENT_UNSUPPORTED`. A non-`<table>` element throws `TypeError`.
- **Structure.** Rows come from `<thead>`, then each `<tbody>` (and bare `<tr>`), then `<tfoot>`, whatever their order in the markup. `colspan`/`rowspan` are laid out on an occupancy grid and become `merges` (issue #28). `rowspan="0"` spans to the end of its row group. Spans are clamped to HTML's limits (1000 / 65534) and to the table. Nested tables are read as text of their cell, not as rows. Skipped cells (hidden, ignored) are left out, so the cells after them move left.
- **Hints on `<td>`/`<th>`:**
  - `data-value="..."` gives the raw value instead of the text.
  - `data-type="string|number|boolean|date"` coerces it. `number` takes plain decimals and `1,234.5`-style grouping. `boolean` takes true/false, yes/no and 1/0. `date` takes ISO 8601: date-only and zone-less values are local wall-clock time, and `Z` or `±hh:mm` are honoured. A value that doesn't fit stays text with warning `COERCION_FAILED`.
  - `data-numfmt="0.00"` sets the number format; all digits means a built-in id (`data-numfmt="14"`).
  - `data-export-ignore` on a row or cell skips it.
- **Text:** child text, ignoring `<script>`, `<style>`, `<template>` and `<noscript>`. Whitespace, including `&nbsp;`, is collapsed per line. `<br>` becomes a newline and turns on `wrapText`.
- **Links:** the first `<a href>` becomes the cell's hyperlink, resolved to an absolute URL (`a.href`). In-page `#anchors` are ignored. Schemes outside `hyperlinkSchemes` are dropped with `HYPERLINK_DROPPED`, so the sheet always passes the writer's allowlist (§3.6).
- **Header rows** get `headerStyle`. Computed styles are merged over it, field by field. `freezeHeader` freezes the header rows, and `autoFilter` covers the last header row through the last row; both need at least one header row. `autoWidth` sets numeric widths from `cellText` (§4.3 bounds).
- **`styles: 'computed'`** maps:
  - `font-weight` ≥ 600 (or `bold`/`bolder`) to bold;
  - `font-style` italic/oblique;
  - `text-decoration` underline and line-through;
  - `color`, except black, which is Excel's automatic colour;
  - the first non-transparent `background-color` of the cell, its row, its section or the table (what the reader sees), as a solid fill;
  - explicit `text-align` left/right/center/justify (including the vendor `center` that `<th>` computes to);
  - `vertical-align` top/bottom;
  - `white-space` `pre-wrap`/`pre-line`/`break-spaces` to `wrapText`.

  These are not mapped: `text-align: start/end`, the computed default (Excel's general alignment follows the sheet direction); `vertical-align: middle`, the HTML table default; and borders, fonts and sizes, in 2.0. Colours are parsed from `rgb()`/`rgba()` (comma or space syntax), hex and the basic named colours.
- **RTL:** `dir="rtl"` on the table or an ancestor, or computed `direction: rtl` with `styles: 'computed'`, sets `view.rightToLeft`.
- **`download`** creates an object URL, clicks a temporary hidden `<a download rel="noopener">` and removes it. It revokes the URL after `DOWNLOAD_REVOKE_DELAY_MS` (40 s, the delay FileSaver.js uses, because Safari needs the URL after the click; not measured here), and also when the click throws. A string `data` is encoded as UTF-8. A Blob is passed through, re-typed only when `mimeType` differs.

### 5.5 Worker (`javascript-excel/worker`)

```ts
// excel.worker.ts (two lines the app writes)
import { exposeWorker } from 'javascript-excel/worker';
exposeWorker();                                   // serves on `self`; pass an endpoint to serve elsewhere

// main thread
export function createWorkerClient(worker: WorkerLike): WorkerClient;   // a DOM `Worker` fits WorkerLike

export interface WorkerClient {
  write(wb: Workbook, options?: WriteOptions & TransferOption): Promise<Uint8Array>;
  read(input: BinaryInput, options?: ReadOptions & TransferOption): Promise<ReadResult>;
  toCsv(source: Sheet | CellInput[][], options?: CsvWriteOptions): Promise<string>;
  parseCsv(input: string | BinaryInput, options?: CsvParseOptions & { encoding?: string; signal?: AbortSignalLike } & TransferOption): Promise<CsvParseResult>;
  importDataset(input: string | BinaryInput, options?: ImportDatasetOptions & TransferOption): Promise<ImportDatasetResult>;  // §5.6
  terminate(): void;
}
export interface TransferOption { transfer?: boolean }
export interface MessageEndpoint {               // a Worker, the worker's self, or a MessagePort
  postMessage(message: unknown, transfer?: unknown[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}
export interface WorkerLike extends MessageEndpoint { terminate(): void }
```

- The app owns the worker file and creates it with `new Worker(new URL('./excel.worker.ts', import.meta.url), { type: 'module' })`. This is the pattern Vite, webpack 5 and Next.js all bundle correctly, and avoids shipping a prebuilt worker URL (§12 Q15).
- `onProgress`, `onWarning` and `signal` work across the boundary. Aborting rejects the call at once with `signal.reason` (as `fetch` does) and sends a cancel message; the worker stops at its next check, and its queue moves on. `terminate()` rejects the calls in flight with an `AbortError`.
- Errors keep their class and `code`: an `ExcelError` thrown in the worker is rebuilt on the main thread, so `isExcelError(err)` and `err.code` work. `TypeError` and `RangeError` stay what they are.
- **Transfer:** results (`Uint8Array`) are transferred back, not copied. Inputs are copied by default. With `transfer: true`, an input `ArrayBuffer` or `Uint8Array` is transferred and becomes detached in the caller. `Blob`s are always cheap to send.
- The model crosses the boundary through structured clone, which is why it is plain data (§3.1). Functions cannot cross: an option holding a function (other than `onProgress`/`onWarning`), for example `toCsv`'s `dates` formatter, is rejected with a `TypeError` before anything is sent. `fromDataset` and `fromTable` run on the main thread and the resulting `Sheet` is sent to the worker.
- **Sending cost** (JSE-15). `postMessage` serializes the model on the calling thread, and the worker deserializes it on its own thread. For 600k cells in Chromium 150 (Apple-silicon laptop, `bench/browser/worker-send.bench.test.ts`), the calling thread is busy for 6 ms with numbers only, 13 ms with unique strings, 64–78 ms with `{ value, style }` cells sharing style objects, and 193–254 ms with a new style literal per cell. Node worker threads measure the same (`bench/worker.mjs`). A compact transfer encoding was tried: typed arrays transferred, plus a string list and a deduplicated style table. It cut the end-to-end time for styled sheets (1,340 → 749 ms), but it **raised** the calling thread's cost where it matters most: 193 → 320 ms for a new style per cell, and 54 → 105 ms for a mix of numbers, strings and styled cells. Encoding in JavaScript is slower than the browser's native serializer. It only won with shared style objects (64 → 20 ms). Since the point of the worker is a free main thread, it was not shipped. The code and measurements are on the `jse-15-compact-experiment` branch. To keep the send cheap, share style objects between cells (`const bold = { font: { bold: true } }`) rather than writing a new literal per cell.
- Several calls may be in flight on one client; they run one after another in the worker. The library's messages carry a tag, so the app can use the same worker for its own messages.
- Code that imports only `createWorkerClient` does not ship the engine: the smoke test bundles it alone and finds no writer, reader, CSV or import code (5.3 KiB unminified).
- Node `worker_threads` is not supported by `/worker` in 2.0 out of the box (its `Worker` is an `EventEmitter`, not an `EventTarget`). A three-line adapter works, and the tests use one. Node users usually call `read`/`toUint8Array` directly.

### 5.6 Import (`javascript-excel/import`)

Turns a user's `.xlsx` or `.csv` file into a dataset, `{ columns, data }`, the shape `fromDataset` writes. This is the framework-free part of react-data-import (its docs/api.md, decided 2026-11-16), so a Vue or vanilla app gets the same import. Everything here is built on `read`, `readCsv` and `toDataset`.

```ts
export function importDataset(input: string | BinaryInput, options?: ImportDatasetOptions): Promise<ImportDatasetResult>;

// building blocks, usable on their own
export function detectHeader(sheet: Sheet<CellInput>, options?: DetectHeaderOptions): HeaderDetection;
export function inferColumnTypes(dataset: DatasetLike, options?: TypeOptions): InferredColumn[];
export function coerceColumns(dataset: DatasetLike, types: Record<string, ColumnType | InferredColumn>, options?: TypeOptions): CoerceResult;
export function parseNumber(text: string, options?: { decimal?: '.' | ','; group?: NumberGroup }): number | undefined;
export function parseDate(text: string, options?: { order?: 'YMD' | 'DMY' | 'MDY'; zone?: 'local' | 'utc' }): Date | undefined;
export function mapColumns(columns: ReadonlyArray<{ key: string; title: string }>, schema: ImportSchema, mapping?: ColumnMapping): MappingResult;
export function applyMapping(dataset: DatasetLike, mapping: ColumnMapping, schema: ImportSchema): MappedDataset;

export interface ImportDatasetOptions {
  format?: 'auto' | 'xlsx' | 'csv';            // default 'auto' (below)
  fileName?: string;                           // for bytes without a name: CSV detection and meta.fileName
  mimeType?: string;
  sheet?: number | string | 'first-visible';   // default 'first-visible'
  header?: 'auto' | number | { row?: number; rows: number; join?: string } | false;  // default 'auto'
  range?: string;                              // e.g. 'B3:H200'; default: the used range
  types?: 'infer' | 'none' | Record<string, ColumnType>;  // by key or title; default 'infer'
  locale?: ImportLocale;
  delimiter?: string | 'auto';                 // CSV; default 'auto'
  encoding?: string;                           // CSV without a BOM; default 'utf-8'
  skipTotals?: 'auto' | boolean;               // default 'auto' (toDataset)
  errorCells?: 'null' | 'keep';                // default 'null'
  dates?: 'date' | 'serial';                   // xlsx; default 'date'
  dateZone?: 'local' | 'utc';                  // default 'local'
  schema?: ImportSchema;
  mapping?: ColumnMapping;                     // overrides the automatic mapping, field by field
  maxRows?: number;                            // data rows; more is LIMIT_EXCEEDED
  preview?: number;                            // read only the first N data rows; no mapping
  limits?: Partial<ReadLimits>;
  signal?: AbortSignalLike;
  onProgress?: (p: ImportProgress) => void;
  onWarning?: (w: ExcelWarning) => void;
}

export interface ImportDatasetResult {
  columns: ImportedColumn[];                   // with a schema: one per schema field, in schema order (unmapped: letter '', type 'empty')
  data: Array<Record<string, unknown>>;        // null-prototype objects
  rowNumbers: number[];                        // spreadsheet row (1-based) of each data entry
  issues: ImportIssue[];
  warnings: ExcelWarning[];                    // from the reader or CSV parser
  meta: ImportMeta;
}

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'mixed' | 'empty';
export interface ImportedColumn { key: string; title: string; letter: string; type: ColumnType; field?: string }

export interface ImportMeta {
  format: 'xlsx' | 'xlsm' | 'xltx' | 'xltm' | 'csv';
  fileName?: string;
  sheet?: { name: string; index: number };
  sheets?: SheetInfo[];                        // every worksheet, for a sheet picker (xlsx)
  header: { rows: number[]; detected: boolean; confidence?: 'high' | 'low' };  // zero-based sheet rows
  range: string;                               // what became the dataset, e.g. 'A3:H120'
  delimiter?: string;                          // CSV
  encoding?: string;                           // CSV: from the BOM, else the encoding option
  bom?: boolean;                               // CSV
  totalsRowSkipped: boolean;
  truncated: boolean;                          // preview: more rows exist
  mapping?: ColumnMapping;                     // the mapping applied
  unmappedColumns?: string[];                  // file column keys no field took
}

export interface ImportIssue {
  row: number;                                 // spreadsheet row (1-based); 0 for column- or file-level issues
  field?: string;                              // the key in data rows: field name, or column key without a schema
  column?: string;                             // source column key, for cell- and column-level issues
  ref?: string;                                // 'C17'
  code: ImportIssueCode;
  message: string;
  severity: 'error' | 'warning';
}
export type ImportIssueCode = 'TYPE' | 'REQUIRED' | 'MAPPING_MISSING' | 'ERROR_CELL' | 'EMPTY' | 'DATE_ORDER_AMBIGUOUS';

export interface ImportLocale {
  decimal?: '.' | ',';                         // default '.'
  group?: NumberGroup;                         // default '': no group separators
  dateOrder?: 'auto' | 'YMD' | 'DMY' | 'MDY';  // numeric dates such as 15/01/2024; default 'auto'
}
export type NumberGroup = ',' | '.' | ' ' | "'" | '';

export interface ImportSchema {
  fields: Record<string, FieldSpec>;
  unmapped?: 'drop' | 'keep';                  // default 'drop'
}
export interface FieldSpec { aliases?: string[]; required?: boolean; type?: ColumnType }
export type ColumnMapping = Record<string, string | null>;   // field -> column key, or null

export interface ImportProgress { phase: 'unzip' | 'parse' | 'dataset'; ratio: number }

export interface DatasetLike {
  columns: ReadonlyArray<{ key: string; title: string; letter?: string }>;
  data: ReadonlyArray<Record<string, unknown>>;
  rowNumbers?: readonly number[];              // for issue rows; default: index + 2
}
export interface TypeOptions { locale?: ImportLocale; dateZone?: 'local' | 'utc' }
export interface InferredColumn { key: string; type: ColumnType; dateOrder?: 'YMD' | 'DMY' | 'MDY' }
export interface CoerceResult { data: Array<Record<string, unknown>>; issues: ImportIssue[] }
export interface DetectHeaderOptions { range?: string; maxScan?: number; locale?: ImportLocale }
export interface HeaderDetection { rows: number[]; confidence: 'high' | 'low' }
export interface MappingResult { mapping: ColumnMapping; missing: string[]; unmapped: string[] }
export interface MappedDataset { columns: ImportedColumn[]; data: Array<Record<string, unknown>>; rowNumbers: number[]; issues: ImportIssue[] }
```

**The pipeline.** `importDataset` runs these steps, each one a function above or an existing API:

1. **Format.** A string is CSV text. Bytes are checked with `detectFormat`. A zip goes to `read`, and `read` rejects what it can't read (`NOT_XLSX`, `UNSUPPORTED_FORMAT` for `.xls`/encrypted (`'cfb'`), `.xlsb`, `.ods`). Bytes with no signature are CSV only when the file name (`.csv`, `.tsv`, `.txt`), the MIME type (`text/csv`, `text/plain`, `text/tab-separated-values`) or `format: 'csv'` says so. Otherwise they are rejected with `UNSUPPORTED_FORMAT`, `details.format: 'unknown'`. A `File`'s own `name` and `type` are used when `fileName` and `mimeType` are not given.
2. **Read.**
   - xlsx: `readSheetNames` lists the sheets, then `read` parses only the chosen one. It uses `styles: false` and `richText: 'plain'`, and keeps formulas only so that `skipTotals: 'auto'` can see the totals row.
   - CSV: `readCsv` with `inferTypes: false`, so step 5 applies the same rules to both formats.
   - With `maxRows` or `preview`, the reader stops early: `ReadOptions.maxRows` (§5.2) for xlsx, `maxRows` for `readCsv`.
3. **Sheet.** `'first-visible'` takes the first sheet whose state is `visible`. Hidden sheets are only read when named or indexed. A name or index that doesn't exist throws `SHEET_NOT_FOUND`.
4. **Header.** `'auto'` runs `detectHeader`. A number is the header row. `{ row, rows, join }` is a multi-row header, flattened by `toDataset`'s `headerRows` (§4.3), with `row` defaulting to the detected row. `false` means no header (keys are column letters). Then `toDataset` builds the rows.
5. **Types** ([below](#type-rules)): `inferColumnTypes` + `coerceColumns`. Explicit `types` and schema field `type`s force a conversion.
6. **Mapping**, with a schema: `mapColumns`, then `applyMapping`. It is skipped in preview.

**Behaviour.**

- **Empty input** resolves with no columns and one `EMPTY` issue (severity `warning`), not an error.
- **Error cells** (`#N/A`, `#REF!`, …) become `null` with an `ERROR_CELL` warning per cell (`errorCells: 'null'`), or stay `{ error }` (`'keep'`). Formulas are never evaluated: a formula cell gives its cached value.
- **`maxRows`** counts data rows. A bigger sheet or file is rejected with `LIMIT_EXCEEDED` (`details.limit: 'maxRows'`), found while reading, so the rest of the file isn't parsed. The reader stops after the header area (the 25 rows `detectHeader` scans with `header: 'auto'`, or the given header rows) plus `maxRows` rows. A sheet that runs past that point is rejected even if some of its rows turn out empty.
- **`preview: n`** reads the header area plus `n` data rows, returns at most `n` rows, sets `meta.truncated` when more exist, and doesn't map.
- **Progress** comes from the reader (`unzip`, `parse`), then `dataset` while rows are converted. CSV reports `dataset` only, because `readCsv` has no progress events.
- **Abort** works as everywhere: `signal` reaches `read`/`readCsv` and is checked between steps. An abort rejects with `signal.reason`.
- **Worker.** `WorkerClient.importDataset(input, options)` runs the same function in the worker (§5.5). The options hold no functions apart from `onProgress`/`onWarning`, so they all cross.

#### Header detection

`detectHeader(sheet, { range, maxScan = 25, locale })` returns `{ rows, confidence }`. `rows` holds zero-based sheet rows, one entry for a single header row and several for a multi-row one. It is deterministic and has no weights to tune:

- It scans the first `maxScan` rows of the range (default 25, a choice, not a measurement; react-data-import's fixtures (RDI-6) check it).
- Each cell counts as **text**, **other** (numbers, booleans, dates, errors) or empty. Text that parses as a number, `TRUE`/`FALSE` or a date under `locale` counts as other, so an all-text CSV row of numbers isn't taken for a header.
- The **table width** is the most common count of filled cells among the scanned rows that have more than one. A cell counts as filled when it has a value or is covered by a horizontal merge.
- **Title rows** are skipped: rows with at most one filled cell when the table is wider than one column, and rows whose one merge spans the table's full width.
- The **header row** is the first remaining row whose cells are all text and which fills at least the table width, provided some column has an "other" value in one of the next five non-empty rows. That gives `confidence: 'high'`. When no row qualifies (an all-text table), it's the first row that is all text and fills the width, with `confidence: 'low'`. If there is none, the first row of the range is used, also `'low'`.
- **Multi-row headers:** rows directly above the header row join it while they are all text and either start a merge that reaches down into the next row (a vertically merged "Name") or hold a horizontal merge narrower than the table (a group title such as "Q1"). That is the header react-data-export's header groups write.

#### Type rules

`inferColumnTypes(dataset, { locale, dateZone })` returns one `InferredColumn` per column, `{ key, type, dateOrder? }`. **All-or-nothing**: a column gets a type only if **every** non-empty value is of that type or is text that converts to it.

- **Typed values come first.** Numbers, booleans and `Date`s from the reader keep their type. Dates are `'datetime'` if any has a time part in `dateZone`, else `'date'`.
- **Text conversion,** tried in order on all text values:
  1. `parseNumber` with the locale
  2. `TRUE`/`FALSE` (any case)
  3. `parseDate`: ISO 8601 always, and numeric dates in the column's date order
- **Result:** if every value converts, the column takes that type. Otherwise it is `'string'` when all values are text, `'mixed'` when typed values of different kinds meet, and `'empty'` when it has no values. Text is trimmed for the test, and strings that stay strings are never trimmed.
- **Date order** with `dateOrder: 'auto'` is decided per column, from the data only:
  - A 4-digit first part means YMD.
  - A first part above 12 means DMY; a second part above 12 means MDY.
  - With no evidence, or evidence both ways, the column stays text with one `DATE_ORDER_AMBIGUOUS` issue (row 0, severity `warning`) naming the column. The browser's locale is never consulted.

`coerceColumns(dataset, types, options)` converts the values and returns `{ data, issues }`. With an inferred type every value converts by construction. With a forced type (`types`, or a schema field's `type`), a value that doesn't convert becomes `null` with a `TYPE` issue (severity `error`), whose `field` and `column` are the column key. `'string'` writes `String(v)`, with dates as ISO 8601. `'mixed'` and `'empty'` leave values alone.

**`parseNumber(text, { decimal, group })`**

- Accepts an optional sign, digits with the group separator in groups of three after the first group, an optional decimal part, and an exponent (`1e3`, only when `decimal` is `'.'`). Surrounding whitespace is trimmed.
- With `group: ' '`, the no-break spaces U+00A0 and U+202F (French style) also count as group separators.
- Plain digits without separators are always accepted.
- Rejected, giving `undefined`:
  - leading zeros (`007`, but `0.5` is fine)
  - integers beyond 2^53
  - percent signs, currency symbols, parentheses for negatives
  - a decimal separator equal to `group`, and misplaced groups (`1,23,456` with `group: ','`)
- The defaults (`decimal: '.'`, `group: ''`) accept exactly what `readCsv`'s `inferTypes` accepts (§5.3).

**`parseDate(text, { order, zone })`**

- ISO 8601 as in §5.3.
- With `order`, numeric dates `d/m/yyyy`, `d.m.yyyy` and `d-m-yyyy` (one separator throughout), optionally followed by ` HH:mm[:ss]`.
- Two-digit years are not accepted: the century would be a guess.
- Calendar-checked (no 31/04), in `zone` (default `'local'`).

#### Column mapping

`mapColumns(columns, schema, mapping?)` matches file columns to schema fields and returns `{ mapping, missing, unmapped }`:
- Titles, keys, field names and aliases are compared after normalisation: Unicode NFKD, combining marks removed, lower case, and whitespace, `_`, `-` and `.` removed. So `E-mail`, `email` and `E MAIL` match.
- Fields are matched in schema order. Each takes the first matching column in file order, and a column goes to one field at most. There is no fuzzy matching.
- `mapping` entries override the automatic result, field by field. An entry naming a column that doesn't exist is a `TypeError`.
- `missing` lists required fields without a column.

`applyMapping(dataset, mapping, schema)` returns `{ columns, data, rowNumbers, issues }`:
- Rows are keyed by field names, in schema order, and **every row has every schema field**: a field without a column is `null` in each row (JSE-21), so rows always have the schema's shape and a validator such as Zod's `.nullable()` accepts them. `columns` has one entry per schema field; an unmapped field's entry has `title: ''`, `letter: ''`, `type: 'empty'` and its `field`.
- With `unmapped: 'keep'`, the file's other columns follow under their own keys, suffixed `_2`, `_3` if a key equals a field name.
- A required field without a column gives one `MAPPING_MISSING` issue (row 0, severity `error`) and is `null` in the rows; there is no per-row `REQUIRED` issue for it. The rows are still returned, so a UI can fix the mapping and apply it again without reading the file.
- A required field that is empty in a row gives a `REQUIRED` issue (severity `error`) with the row, cell and source `column`. `applyMapping` sees only the values it is given, so a value that `coerceColumns` turned into `null` also counts as empty here; `importDataset` reports such a cell once, as `TYPE` (see "Issues" below).

#### Issues

`importDataset` reports problems in `issues`, never by throwing:
- **`field` is the key the value has in `data` rows**: the schema field with a schema (a kept column's key, `_2` suffix included, with `unmapped: 'keep'`), the column key without one. **`column`** is the source column's key, as in `ColumnMapping` and `meta.unmappedColumns`. It is set on cell- and column-level issues (`TYPE`, `REQUIRED`, `ERROR_CELL`, `DATE_ORDER_AMBIGUOUS`), not on `MAPPING_MISSING` or `EMPTY`. The cell itself is `ref`.
- **One error per cell.** A value that doesn't convert to a forced type gives `TYPE` only, even in a required field: the cell wasn't empty. An error cell in a required field gives its `ERROR_CELL` warning and the `REQUIRED` error.
- **Issues on columns the mapping drops** (`unmapped: 'drop'`, the default) are left out: they describe values that are not in the result.

Validation of rows (functions, Standard Schema, async checks) is react-data-import's. javascript-excel reserves its error code, `VALIDATION_FAILED`.
### 5.7 Format (`javascript-excel/format`)

Renders a value with an Excel number format, as Excel shows it in a cell: `1234.5` with `#,##0.00` is `1,234.50`, serial `45306` with `dddd, mmmm d, yyyy` is `Monday, January 15, 2024`. It is used by viewers, previews and anything that needs a cell's displayed text. Part of 2.0, from 2.0.0-alpha.3 (§12 Q14).

```ts
export function formatValue(value: FormatInput, numFmt?: NumFmt, options?: FormatOptions): FormattedValue;
export function formatCell(cell: CellInput, options?: FormatOptions): FormattedValue;   // value + cell.style.numFmt

export type FormatInput = number | string | boolean | Date | CellErrorValue | RichText | null | undefined;

export interface FormatOptions {
  locale?: string;                 // BCP 47; default 'en-US'
  date1904?: boolean;              // workbook.date1904
  dateZone?: 'local' | 'utc';      // only for Date inputs; default 'local', as the writer
  generalWidth?: number;           // characters for General; default 11
  indexedColors?: readonly string[]; // workbook.indexedColors, for [ColorN]
}

export interface FormattedValue {
  text: string;                    // without the repeat characters of a *x fill
  color?: string;                  // ARGB from [Red], [Color10], ...; overrides the font colour
  fill?: { char: string; at: number }; // *x: repeat char at index `at` until the cell is full
  align: 'left' | 'center' | 'right';  // Excel's 'general' alignment for the value type
}
```

**Inputs.**
- **Numbers are serials for date formats.** Formatting is pure arithmetic on the serial, never a `Date` in the local zone, so the output is the same in every time zone. For exact results, a viewer reads with `dates: 'serial'` (§5.2). A `Date` input is first converted with `dateToSerial`, using `dateZone` and `date1904`, which is what the writer stores for it.
- **Text** uses the format's text section: the fourth section, or a section with `@`. Without one, text is shown as is.
- **Booleans** show `TRUE`/`FALSE`, errors as written, rich text as its plain text, whatever the format.
- **`formatCell`** formats a cell's value with its own `numFmt`. A formula cell shows its cached value; without one the text is empty.

**Never throws.** Format codes come from files. Characters the parser does not recognise are shown as literal text, unbalanced quotes and brackets end at the end of the section, and at most four sections are used. Parsing is linear in the code's length. Compiled codes are cached (up to 1,000).

#### 5.7.1 What is rendered

| Feature | Codes | Notes |
|---|---|---|
| Sections | `pos;neg;zero;text` | One section: all numbers, with a minus sign for negatives. Two: non-negative; negative without its sign. Three: positive; negative; zero. The fourth is for text |
| Conditions | `[>100]`, `[<=-5]`, `[=0]`, `[<>1]` | The first section whose condition holds wins, and the next section without a condition takes the rest. A section whose condition only admits negatives (`[<0]`) drops the minus sign, like the implicit negative section; other conditional sections keep it `[to verify]` |
| Colours | `[Black] [Blue] [Cyan] [Green] [Magenta] [Red] [White] [Yellow]`, `[Color1]`–`[Color56]` | Returned as `color` (ARGB). `[ColorN]` is indexed colour N + 7, from `indexedColors` or the default palette (§3.5.6) |
| Digit placeholders | `0 # ?` | `0` pads with zeros, `?` with spaces, `#` with nothing; extra integer digits go to the leftmost placeholder; literals between placeholders stay in place (`000-00-0000`) |
| Decimal point, grouping, scaling | `.` `,` | A comma between integer placeholders groups thousands; commas after the last placeholder divide by 1,000 each (`0.0,,` shows millions) |
| Percent | `%` | Multiplies by 100 per `%` |
| Scientific | `E+ E- e+ e-` | `0.00E+00`; with `#` in a multi-digit integer part, the exponent is a multiple of its length (`##0.0E+0`, engineering) |
| Fractions | `# ?/?`, `# ??/??`, `?/8`, `# ??/16` | Best approximation with at most as many denominator digits as placeholders, or a fixed denominator; a whole number blanks the fraction |
| Text | `@`, `"…"`, `\x`, and characters Excel shows unquoted | |
| Spacing and fill | `_x`, `*x` | `_x` gives one space; `*x` is returned as `fill`, not repeated in `text` |
| General | `General`, also inside a section (`"Total: "General`) | Up to `generalWidth` (11) characters: rounded to fit, scientific from 1E+11 and below 1E-04 |
| Dates | `d dd ddd dddd`, `m mm mmm mmmm mmmmm`, `yy yyyy` | `m`/`mm` are minutes right after an hour or right before seconds. Day 0 of the 1900 system shows as `1900-01-00`, serial 60 as `1900-02-29`, and weekdays follow Excel (serial 1 is a Sunday) |
| Times | `h hh m mm s ss`, `AM/PM am/pm A/P a/p`, `.0`–`.000` | Times are rounded to the shown precision before splitting, so `0.99999999` days is the next day `00:00` |
| Elapsed time | `[h] [hh] [m] [mm] [s] [ss]` | Totals beyond 24 hours / 60 minutes; negative values get a minus sign |
| Dates Excel can't show | negative serials, past 9999-12-31 | `text: ''` with `fill: { char: '#' }`: the cell fills with `#`, as in Excel |
| Locale tags | `[$€-407]`, `[$-409]`, `[$-F800]`, `[$-F400]`, `[$-x-sysdate]`, `[$-x-systime]` | The symbol is printed. The locale id switches month and day names for that section (common ids only, `[to verify]` per id). `F800`/`x-sysdate` is the locale's long date and `F400`/`x-systime` its time, from Intl `[to verify against Windows settings]` |
| Era and calendar tokens | `e`, `b`, `bb`, `g` | `e` is the year; `b`/`bb` the Buddhist-era year (+543); `g` era names are not rendered `[to verify]` |
| Not rendered | `[DBNum1]`, `[NatNum1]` and other bracket codes, `B1`/`B2` calendar prefixes | Ignored |

#### 5.7.2 Built-in ids

- **Fixed ids:** 1–4, 9–13, 15–21, 37–40 and 45–49 render the codes of §11.2.
- **Short-date ids:** 14 is the locale's short date, numeric with a four-digit year (`1/15/2024` in en-US, `15.01.2024` in de-DE). 22 is that plus ` h:mm`. The East Asian ids 27–31, 36 and 50–58 show the short date too, and 32–35 show `h:mm:ss` `[to verify per locale]`.
- **Currency and accounting:** ids 5–8 and 41–44 use their en-US codes (`"$"#,##0_);\("$"#,##0\)` and so on) `[to verify for other locales]`.
- **Other ids** render as General.

#### 5.7.3 Locale

- **Platform data.** Separators, month and day names and the short-date pattern come from `Intl.NumberFormat` and `Intl.DateTimeFormat` for `locale`, so the module ships no locale tables.
- **Separators.** The `.` and `,` of a format code are replaced by the locale's decimal and group separators, as Excel does with the system settings `[to verify]`. The group separator is the locale's own character; for fr-FR it is a narrow no-break space.
- **Unchanged parts.** Booleans stay `TRUE`/`FALSE`, `AM`/`PM` is shown as written in the code, and grouping is always by three digits `[to verify for locales such as en-IN]`.
- **Invalid locales.** A locale tag Intl rejects falls back to en-US.

#### 5.7.4 Reference results

Excel is the authority; LibreOffice is the automated reference.
- **The check.** The `LibreOffice` CI job writes every case of `test/format/cases.ts`, plus every number-formatted cell of the conformance files `10-number-formats` and `11-number-formats-locale`, to one workbook. It has LibreOffice export the workbook to CSV with "save cell contents as shown" in en-US, and compares each cell with `formatCell(cell, { locale: 'en-US' })` (`test/format/libreoffice.test.ts`).
- **Where LibreOffice differs.** Every case where LibreOffice is known to differ is listed in that test with LibreOffice's output. The table below records it, with what this module does and why. Each is `[to verify]` against Excel in the conformance checklist.

Result in CI (LibreOffice 26.2, en-US): 439 probes, 344 identical, 95 different for a known reason (1900 calendar 27, time rounding 27, General 12, dangling point 7, built-in ids 39/40/47 7, `?` padding 9, am/pm case 5, Buddhist year 1), 0 unexplained. Every difference has one of the known causes below. Any other difference fails the job.

| Difference | LibreOffice | `formatValue` (Excel's behaviour, `[to verify]`) |
|---|---|---|
| Serials below 61 (the 1900 calendar) | Counts from 1899-12-30: serial 1 is 1899-12-31, no 1900-02-29, no day 0 | Serial 1 is 1900-01-01, 60 is 1900-02-29, below 1 is day 0 (`1900-01-00`), as Excel |
| Time rounding | Truncates to the shown unit: 0.6458333 is `15:29:59`, `3:29 PM` | Rounds to the shown second first: `15:30:00`, `3:30 PM`; 45306.99999999 with `yyyy-mm-dd` is the next day |
| General | Up to 15 significant digits, no width limit, 3-digit exponents (`0.333333333333333`, `1E+021`) | Fits 11 characters (`0.333333333`, `1E+21`, `1.23457E+11`) |
| A decimal point with no digits after it | Dropped: `#,##0.###` shows `7` | Kept: `7.` |
| `?` padding | U+2007 FIGURE SPACE | A plain space, as text copied from Excel has |
| Built-in ids 39, 40, 47 | Excel's actual codes, `#,##0.00_);(#,##0.00)` and `mm:ss.0` | The ECMA-376 codes in §11.2 (`#,##0.00;(#,##0.00)`, `mmss.0`); conformance file 10 asks for the codes Excel shows |
| `am/pm` and `A/P` case | `AM/PM` upper-cased, `A/P` lower-cased | As written in the code |
| `b`, `bb`, `bbbb` | Not known; printed as text | The Buddhist-era year (Gregorian + 543) |

Built-in ids 32–35 are rendered as `h:mm:ss`, which matches LibreOffice in en-US: they are times in the East Asian locales that define them `[to verify]`.

### 5.8 Render model (`javascript-excel/render`)

What a spreadsheet viewer needs to draw a sheet, computed from a read workbook. It is framework-free and has no DOM access, so it runs in Node, in a worker and behind any UI (react-xlsx-viewer's design, decision Q2, puts it here). Part of 2.0, like `/format` (§5.7), from the 2.0 prerelease after its merge.

The render model provides:
- **geometry:** row and column offsets in CSS pixels, plus hit testing;
- **a merge map;**
- **concrete styles:** `#RRGGBB` colours and resolved fonts;
- **edge resolution:** the border edge between two cells;
- **display text,** through an optional number-format hook;
- **formula text** for a formula bar;
- **hyperlink checks;**
- **keyboard movement:** one cell, and Ctrl+arrow data edges;
- **copy:** TSV and HTML for the clipboard, and a selection summary.

It leaves text measurement (overflow into neighbours, `####`, shrink to fit, auto row height), RTL mirroring, zoom, focus and DOM work to the UI.

```ts
export function createRenderSheet(workbook: Workbook<CellInput>, sheet: number, options?: RenderOptions): RenderSheet; // reader output or a built workbook

export interface RenderOptions {
  /** Display text. Pass `formatCell` from javascript-excel/format; default: `cellText` (raw values). */
  format?: RenderFormatter;
  locale?: string;                  // passed to `format`; default 'en-US'
  maxDigitWidth?: number;           // px of the default font's widest digit at 100 %; default 7 (Calibri 11, §3.3)
  margin?: { rows?: number; cols?: number }; // empty rows/columns after the used range; default 50 / 10
  hyperlinkSchemes?: string[];      // external link schemes allowed; default ['http', 'https', 'mailto'] (§12 Q16)
}
/** Any function with this shape; `formatCell` from javascript-excel/format fits. */
export type RenderFormatter = (cell: Cell, options: { locale?: string; date1904?: boolean; indexedColors?: readonly string[] }) =>
  { text: string; color?: string; fill?: { char: string; at: number }; align?: 'left' | 'center' | 'right' };

/** An opaque handle. Its caches live with it; drop the handle to free them. */
export interface RenderSheet { readonly sheet: number; readonly name: string }
```

#### 5.8.1 Extent, settings and geometry

```ts
export function sheetExtent(s: RenderSheet): { rows: number; cols: number };   // used range + margin, capped at 1,048,576 x 16,384
export function sheetSettings(s: RenderSheet): {
  freeze: { rows: number; cols: number }; rightToLeft: boolean; showGridLines: boolean; showHeaders: boolean;
  zoom: number; activeCell: CellRef; selection: RangeRef | null; tabColor: string | null;
};
export function rowTop(s: RenderSheet, row: number): number;     // px from the top of row 0 at zoom 100 %; rowTop(s, extent.rows) is the total height
export function rowHeight(s: RenderSheet, row: number): number;
export function colLeft(s: RenderSheet, col: number): number;    // logical (left-to-right) offset; the UI mirrors for RTL
export function colWidth(s: RenderSheet, col: number): number;
export function rowAt(s: RenderSheet, y: number): number;        // the visible row under y (binary search); clamped to the extent
export function colAt(s: RenderSheet, x: number): number;
export function isRowHidden(s: RenderSheet, row: number): boolean;
export function isColHidden(s: RenderSheet, col: number): boolean;
export function hasStoredRowHeight(s: RenderSheet, row: number): boolean;  // the file sets this row's height
export function setRowHeights(s: RenderSheet, heights: ReadonlyArray<readonly [row: number, px: number]>): boolean; // auto-fit

export interface CellRef { row: number; col: number }
export interface RangeRef { start: CellRef; end: CellRef }       // inclusive, start <= end
```

- **Extent.** The used range is the sheet's `dimension` (or the cells, merges, row and column properties present), plus the margin. Indices outside the extent are clamped.
- **Row heights.** A row's height in points becomes CSS pixels as `pt × 96 / 72`. Missing heights use `sheet.defaultRowHeight`, else 15 pt.
- **Column widths.** A width in characters becomes pixels with the file-width formula and `maxDigitWidth` (§3.3). Missing widths use `sheet.defaultColWidth`, else 8.43 characters (64 px at the default 7).
- **Hidden rows and columns.** Hidden, or width/height 0, means size 0. `rowAt`/`colAt` never return a hidden index.
- **Cost.** Offsets are prefix sums, built once in O(rows + columns) (`Float64Array`). `rowTop`/`colLeft` are O(1), and `rowAt`/`colAt` are O(log n).
- **Auto-fit** (react-xlsx-viewer decision Q11). Excel fits rows without a stored height to their content (wrapped, rotated or larger text) when it opens a file. The render model can't measure text, so the viewer measures and calls `setRowHeights` with CSS px at zoom 100 %.
  - It only applies to rows without a stored height (`hasStoredRowHeight` is false) that aren't hidden.
  - Heights are clamped to [the default row height, 409 pt], so auto-fit only grows rows.
  - The offsets are rebuilt from the first changed row onwards, so a batch costs O(rows after it). `rowTop`, `rowHeight` and `rowAt` reflect the new heights at once.
  - The model isn't changed, only the handle's geometry. Cells don't depend on row heights, so their cache is kept.
- **Settings.** They come from `sheet.view` and `sheet.tabColor`:
  - zoom defaults to 100, the active cell to A1;
  - grid lines and headers are shown unless the file turns them off;
  - the tab colour is resolved to `#RRGGBB`.

#### 5.8.2 Cells

```ts
export function renderCell(s: RenderSheet, row: number, col: number): RenderCell | null;
export function mergeAt(s: RenderSheet, row: number, col: number): { anchor: CellRef; range: RangeRef } | null;

export interface RenderCell {
  text: string;                       // displayed text (format hook, else cellText)
  runs?: Array<{ text: string; font: RenderFont }>; // rich text, fonts merged over the cell font
  value: CellValue | null;            // the (cached) value
  type: CellType;
  formula?: string;                   // for a formula bar: '=' + text, display prefixes removed
  arrayFormula?: boolean;             // shown as {=…}
  noCachedValue?: boolean;            // a formula without a cached value: text is ''
  style: RenderStyle;                 // concrete; shared by every cell with the same style object
  edges: RenderEdges;                 // the borders this cell draws, after resolving with its neighbours
  merge?: { rows: number; cols: number }; // on a merge's anchor
  hyperlink?: RenderHyperlink;
  align: 'left' | 'center' | 'right'; // the format's alignment under 'general': numbers right, text left, booleans/errors centred
  color?: string;                     // a format section colour ([Red]) as #RRGGBB; overrides the font colour
  fill?: { char: string; at: number }; // a *x fill from the format
}
export interface RenderStyle {
  font: RenderFont;
  background:
    | { kind: 'none' }
    | { kind: 'solid'; color: string }
    | { kind: 'pattern'; pattern: PatternType; fg: string; bg: string }
    | { kind: 'gradient'; gradient: 'linear' | 'path'; degree: number; stops: Array<{ position: number; color: string }> };
  border: { top?: RenderBorder; right?: RenderBorder; bottom?: RenderBorder; left?: RenderBorder; diagonalUp?: RenderBorder; diagonalDown?: RenderBorder };
  align: {
    horizontal: 'general' | 'left' | 'center' | 'right' | 'fill' | 'justify' | 'centerContinuous' | 'distributed';
    vertical: 'top' | 'center' | 'bottom' | 'justify' | 'distributed';
    wrap: boolean; shrink: boolean; indent: number; rotation: number | 'vertical'; direction: 'auto' | 'ltr' | 'rtl';
  };
}
export interface RenderFont {
  family: string; sizePt: number; color: string; bold: boolean; italic: boolean;
  underline: 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting'; strike: boolean;
  vertAlign: 'baseline' | 'superscript' | 'subscript';
}
export interface RenderBorder { style: BorderStyle; color: string }
export interface RenderEdges { top?: RenderBorder; left?: RenderBorder; right?: RenderBorder; bottom?: RenderBorder }
export type RenderHyperlink =
  | { kind: 'external'; href: string; allowed: true; tooltip?: string }
  | { kind: 'external'; href: string; allowed: false; reason: 'scheme' | 'malformed'; tooltip?: string }
  | { kind: 'internal'; sheet: number | null; ref: string; tooltip?: string };
```

- **`renderCell` is lazy.** It returns `null` when there is nothing to draw: no value, no style from the cell, its row or its column, and no merge anchor. Covered cells of a merge return `null`; the anchor carries the value and style. Results are cached in a bounded cache, so redrawing a window costs no recomputation.
- **Style source.** A cell uses its own style (the reader's complete `xf`, §3.5.7). A cell without one takes the row style, then the column style. Fields missing from a style fall back to the workbook's default font (Calibri 11 when the file has none), black text, no fill, no borders, general/bottom alignment.
- **Shared styles.** `RenderStyle` objects are cached in a `WeakMap` keyed by the model's style object. The reader shares one frozen `Style` per `xf` (§12 Q8), so a sheet with 20 distinct formats resolves 20 styles, whatever its size.
- **Colours.** Every colour is concrete `#RRGGBB`, resolved with `resolveColor` (§4.4) against the workbook's theme and indexed palette:
  - automatic and missing font colours are black;
  - a pattern's missing foreground is black and its missing background white;
  - borders without a colour are black.
- **Border edges.** Each cell draws its top and left edges, and its right and bottom edges only at the end of the extent. The shared edge between two cells is resolved once:
  - the heavier style wins, by weight: `hair`, `dotted`, `dashDotDot`, `dashDot`, `dashed`, `thin`, `mediumDashDotDot`, `slantDashDot`, `mediumDashDot`, `mediumDashed`, `medium`, `double`, `thick` `[to verify: Excel's precedence on screen]`;
  - on a tie, the right or lower cell wins.
  - Neighbours are the next visible row or column. A merged neighbour is represented by its anchor's style.
  - Along a multi-row or multi-column merge, the edge is resolved against the neighbour at the anchor's row or column `[approximation]`.
- **Formula text.** `'=' + formula`, with the `_xlfn.`, `_xlfn._xlws.` and `_xlpm.` prefixes removed outside string literals `[to verify: the full prefix list]`. `arrayFormula` is set when the cell has `arrayRef`. A formula without a cached value has `noCachedValue: true` and empty text; the render model never calculates.
- **Hyperlinks.**
  - **External targets:** trimmed. A target with control characters or no scheme is `malformed`. One whose scheme isn't in `hyperlinkSchemes` (case-insensitive) is `scheme`. Both are `allowed: false`, so the UI shows the text without opening anything (§8).
  - **Internal locations:** a defined name, or a reference such as `'Sheet 2'!B4`, is resolved to a sheet index and an A1 reference. `sheet: null` when the sheet or name doesn't exist.
- **Display text.** With a `format` hook, it is the hook's text, colour (ARGB → `#RRGGBB`), fill and alignment. The hook gets `locale`, `date1904` and the workbook's `indexedColors`. Without one, the text is `cellText(cell)` and the alignment follows the value type. For exact dates, read with `dates: 'serial'` (§5.2).

#### 5.8.3 Navigation

```ts
export type RenderDirection = 'up' | 'down' | 'left' | 'right';
export function step(s: RenderSheet, from: CellRef, dir: RenderDirection): CellRef;  // arrow keys
export function edge(s: RenderSheet, from: CellRef, dir: RenderDirection): CellRef;  // Ctrl+arrow
export function lastUsedCell(s: RenderSheet): CellRef;                                              // Ctrl+End
```

- **`step`** moves to the next visible cell. From inside a merge it moves from the merge's edge, and landing inside a merge returns its anchor. At the extent's edge it stays put.
- **`edge`** follows Excel's rule:
  - from a non-empty cell whose next visible neighbour is non-empty, it moves to the last non-empty cell before a blank;
  - otherwise it moves to the next non-empty cell, or to the extent's edge if there is none.
  - Hidden rows and columns are skipped `[to verify against Excel]`.
  - A cell is empty when it has no value and no formula. Styles don't count.
  - The scan is linear in the rows or columns crossed.
- **`lastUsedCell`** is the last row and column of the used range, as Excel's Ctrl+End.

#### 5.8.4 Copy and selection summary

```ts
export function rangeAsTsv(s: RenderSheet, range: RangeRef, options?: { values?: 'displayed' | 'raw' }): string;
export function rangeAsHtml(s: RenderSheet, range: RangeRef): string;
export function rangeStats(s: RenderSheet, range: RangeRef, limit?: number): { count: number; numericCount: number; sum: number; average: number | null; truncated: boolean };
```

- **TSV (`text/plain`).**
  - Rows are separated by CRLF and cells by TAB, with displayed text by default.
  - A field containing a tab, a line break or a quote is quoted, with quotes doubled, as Excel writes it.
  - Merged areas contribute their anchor's text once; covered cells are empty.
  - Hidden rows and columns are included, as in Excel's default copy `[to verify]`.
  - Nothing is guarded against formulas: it is the user's own clipboard (react-xlsx-viewer decision Q15).
- **HTML (`text/html`).**
  - A `<table>` with `colspan`/`rowspan` for merges inside the range.
  - Inline styles carry font weight, style, size, family and colour, plus background colour, horizontal alignment, wrapping and solid borders.
  - Every text and attribute value is escaped, so file content can't add markup.
- **`rangeStats`** is a status-bar summary over the cached values:
  - `count`: the non-empty cells;
  - `numericCount`, `sum` and `average`: over the numbers, including date serials;
  - it scans at most `limit` cells (default 1,000,000) and sets `truncated` past that.
  - This is arithmetic on cached values, not formula evaluation.

#### 5.8.5 Measured cost

`bench/render.mjs` (`npm run bench:render`; the CI job `Benchmarks` runs it and reports to its summary) measures the costs react-xlsx-viewer's design names (its §9). The workload is 10 columns of numbers with 8 shared styles, written and read back with `dates: 'serial'`. Measured on an Apple M2 laptop, Node 26.13.1:

| cells | create (ms) | memory retained by the handle (MB) | 50 × 20 window, first draw / cached (ms) | scrolling, per window, p50 / max (ms) | Ctrl+Down, full column (ms) | TSV + HTML of 10,000 cells (ms) |
|---:|---:|---:|---:|---:|---:|---:|
| 100,000 | 1.0 | 0.11 | 1.65 / 0.09 | 0.05 / 0.73 | 1.6 | 16.2 |
| 1,000,000 | 3.6 | 0.77 | 0.22 / 0.04 | 0.05 / 0.54 | 14.3 | 15.1 |

- **Memory.** The handle costs O(rows + columns): about 8 bytes per row and per column for the offset tables. Per-cell results live in a cache capped at 20,000 cells, and styles are cached per distinct style object.
- **Measurement notes.** The first-draw figure at 100,000 cells includes JIT warm-up, since that size runs first. Ctrl+Down scans linearly: about 14 ms across 100,000 rows.


---

## 6. Zip codec

Internal. Not exported in 2.0, so its shape can still change; this is revisited when a real need appears (§12 Q10).

```ts
/** Compression only. The container format (headers, central directory, CRC-32) is in-house and not pluggable. */
interface ZipCodec {
  /** Raw DEFLATE (RFC 1951), no zlib/gzip wrapper. Input arrives in chunks. */
  deflateRaw(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, signal?: AbortSignalLike): Promise<Uint8Array>;
  /** Streams output; aborts with LIMIT_EXCEEDED as soon as maxOutputBytes or the ratio limit is passed. */
  inflateRaw(
    data: Uint8Array,
    limits: { maxOutputBytes: number; maxRatio: number },
    signal?: AbortSignalLike,
  ): AsyncIterable<Uint8Array>;
}
```

Default implementation: `new CompressionStream('deflate-raw')` and `new DecompressionStream('deflate-raw')`. Container details:

- **Writer:** zip method 8 (deflate) or 0 (store); CRC-32 computed in-house over the uncompressed bytes; sizes known before each local header, so no data descriptors; UTF-8 names (general-purpose flag bit 11). `[Content_Types].xml` is the first entry, by convention. No zip64: an archive over 4 GiB − 1 or over 65,535 entries throws `ZIP64_REQUIRED`, which no realistic workbook reaches.
- **Reader:** locates the end-of-central-directory record, then walks the central directory. Local headers are checked against it. It reads zip64 records (some tools write them for small files), supports methods 0 and 8 only (`ZIP_UNSUPPORTED_METHOD`), rejects the encryption flag (`ZIP_ENCRYPTED`) and duplicate entry names (`ZIP_INVALID`), and verifies each entry's CRC-32 (`ZIP_CRC_MISMATCH`).

What this choice implies for the API:

1. **Async only.** The compression streams have no synchronous form, so `toUint8Array`, `toBlob` and `read` return promises. There is no `writeSync`. A synchronous API could come later through an optional adapter that implements `ZipCodec` (for example on fflate), without changing the model.
2. **Runtime floor:** Node.js 22 or later (`engines: { "node": ">=22" }`), and browsers and workers that support `CompressionStream('deflate-raw')` (§9.3). Node has supported `deflate-raw` in its global `CompressionStream` since 21.2.0, so every Node 22 release has it. JSE-2 verified this on Node 22.0.0 and in CI. Other runtimes work if they have the API. The import itself never fails. The first call throws `ENVIRONMENT_UNSUPPORTED` with a clear message when the API is missing.
3. **Zero runtime dependencies**, and roughly native compression speed.
4. **Output size** depends on the platform's deflate implementation (zlib in Chromium and Node). Output can differ by a few bytes between runtimes; content is identical.

---

## 7. Errors and warnings

### 7.1 Classes

```ts
export class ExcelError extends Error {
  readonly code: ExcelErrorCode;
  readonly details?: Record<string, unknown>;   // e.g. { sheet, ref, limit, value }
  constructor(code: ExcelErrorCode, message: string, options?: { cause?: unknown; details?: Record<string, unknown> });
}
export class ValidationError extends ExcelError {}   // the model or options cannot be written
export class FormatError extends ExcelError {}       // the input is not a readable xlsx/csv
export class LimitError extends ExcelError {}        // a ReadLimits value was exceeded; details.limit names it
export class CsvError extends ExcelError {}          // malformed CSV in strict mode
export class EnvironmentError extends ExcelError {}  // a required platform API is missing

/** Works across ESM/CJS copies and realms; checks a brand, not the prototype chain. */
export function isExcelError(e: unknown): e is ExcelError;
```

Aborts are not `ExcelError`s: they reject with `signal.reason`, as `fetch` does.

### 7.2 Codes

| Code | Class | When |
|---|---|---|
| `NO_SHEETS` | Validation | Workbook has no sheets |
| `INVALID_SHEET_NAME` / `DUPLICATE_SHEET_NAME` | Validation | §3.3 |
| `INVALID_SHEET_PROPERTY` | Validation | A sheet property is out of range or of the wrong type: `colProps`, `rowProps`, default sizes, `view`, `print`, `state`; `details.path` names it |
| `INVALID_DEFINED_NAME` | Validation | A defined name breaks Excel's naming rules, is reserved (`_xlnm.`), is duplicated in its scope, or has an empty `ref` or a bad `sheet` |
| `INVALID_ACTIVE_SHEET` | Validation | Out of range, or the sheet is hidden |
| `INVALID_REF` | Validation | Malformed A1 reference or range |
| `OUT_OF_BOUNDS` | Validation | Row or column beyond the format limits |
| `INVALID_CELL` | Validation | `type` disagrees with `value`, or an unsupported value |
| `INVALID_NUMBER` | Validation | `NaN` or `±Infinity` |
| `INVALID_DATE` | Validation | Invalid or out-of-range `Date` (§3.4.1) |
| `STRING_TOO_LONG` | Validation | More than 32,767 characters in a cell |
| `INVALID_STYLE` | Validation | Bad colour string, unknown enum value, out-of-range number |
| `INVALID_NUMFMT` | Validation | Empty code, or an id outside 0..163 given as a number |
| `INVALID_HYPERLINK` | Validation | Scheme not in `hyperlinkSchemes` (e.g. `javascript:`), no scheme (a relative path), control characters, an empty target or location, or an invalid `hyperlinkSchemes` option |
| `OVERLAPPING_MERGE` | Validation | Two merges overlap |
| `INVALID_COLUMN` | Validation | `fromDataset`: no usable accessor, or a forbidden path segment |
| `TOO_MANY_STYLES` | Validation | More than 64,000 distinct cell formats, Excel's limit `[to verify: conformance.md, 18-limits]` |
| `INVALID_PROPERTY` | Validation | A document property is invalid: not a string, an invalid `Date`, a duplicate or empty custom property name, a non-finite number |
| `ZIP64_REQUIRED` | Validation | §6 |
| `UNSUPPORTED_FORMAT` | Format | `.xls`/encrypted (CFB), `.xlsb`, `.ods`, and Strict OOXML if not mapped (§5.2); `details.format` says which |
| `NOT_XLSX` | Format | A zip without a workbook part |
| `ZIP_INVALID` / `ZIP_UNSUPPORTED_METHOD` / `ZIP_ENCRYPTED` / `ZIP_CRC_MISMATCH` | Format | §6 |
| `XML_MALFORMED` | Format | Not well-formed XML in a required part |
| `XML_DTD_FORBIDDEN` | Format | Any `<!DOCTYPE` (§8) |
| `SHEET_NOT_FOUND` | Validation | `importDataset`: the `sheet` name or index doesn't exist (§5.6) |
| `VALIDATION_FAILED` | Validation | Reserved for react-data-import: row validation stopped at an invalid row; `details.issues` |
| `LIMIT_EXCEEDED` | Limit | Any `ReadLimits` value, or `importDataset`'s `maxRows`; `details: { limit, value, max }` |
| `CSV_MALFORMED` | Csv | Strict mode only |
| `ENVIRONMENT_UNSUPPORTED` | Environment | No `CompressionStream`, no DOM for `/dom` |

### 7.3 Thrown or collected

- **Writer: throw.** Anything that cannot be written faithfully is a `ValidationError`, raised before any output. The writer has no warnings, so a file that comes out is the file that was asked for. Unknown fields are ignored (forward compatibility, §9).
- **Builders** (`fromDataset`, `fromTable`) coerce where the input is data rather than structure, and report through `onWarning` (`COERCION_FAILED`, `NON_FINITE_NUMBER`). Structural mistakes (bad column definitions, bad sheet names) throw.
- **Reader: throw** when the file cannot be read as a workbook (format, zip, required XML part malformed, DTD) or a limit is exceeded. **Collect** when one feature is damaged or unsupported and the rest of the workbook is still usable:

  | Warning code | Situation and recovery |
  |---|---|
  | `UNSUPPORTED_PART` | Charts, drawings, pivots, comments, VBA, … dropped; one warning per kind |
  | `INVALID_STYLE_INDEX` | Cell refers to a missing `xf`; default style used |
  | `INVALID_SHARED_STRING` | Index out of range; cell left empty |
  | `CELL_OUT_OF_BOUNDS` / `INVALID_CELL_REF` | Cell skipped |
  | `DUPLICATE_CELL` | Same cell twice; the last one wins |
  | `INVALID_DATE_SERIAL` | Date-formatted number that is not a valid date; returned as a number |
  | `SHARED_FORMULA_UNRESOLVED` | Shared formula that could not be shifted; cached value only (§12 Q6) |
  | `MISSING_PART` | A relationship points to a missing optional part (styles, theme, shared strings); defaults used |
  | `BROKEN_OPTIONAL_PART` | Malformed XML in an optional part (docProps, theme); part skipped |
  | `HYPERLINK_RANGE_REDUCED`, `SPLIT_PANE_IGNORED` | §3.6 |
  | `ROWS_TRUNCATED` | `ReadOptions.maxRows` reached; later rows of that sheet not read (§5.2) |
  | `HYPERLINK_DROPPED` | `fromTable`: a link whose scheme is not allowed; the cell keeps its text |
  | `WARNINGS_TRUNCATED` | `maxWarnings` reached; later warnings dropped |

```ts
export interface ExcelWarning {
  code: string;                        // one of the codes above; the union is exported as ExcelWarningCode
  message: string;
  part?: string;                       // zip part, e.g. 'xl/worksheets/sheet2.xml'
  sheet?: string;
  ref?: string;                        // cell or range
}
```

- **CSV:** lenient by default (warnings `CSV_UNTERMINATED_QUOTE`, `CSV_STRAY_QUOTE`, `CSV_FIELD_COUNT`, `CSV_INVALID_ENCODING`); `mode: 'strict'` throws `CSV_MALFORMED` instead. `CSV_ROWS_TRUNCATED` (`maxRows` reached) is reported in both modes (§5.3).

---

## 8. Security model

**Threat model.** The reader and CSV parser receive files from untrusted users, often in a browser tab or on a server handling uploads. An attacker controls every byte. The goals: no code execution, no reads or requests beyond the input, no prototype pollution, bounded memory and CPU (reading fails with `LimitError` instead of exhausting them), and no surprise for downstream apps (formula injection).

| Threat | Defence |
|---|---|
| **Zip bombs** (tiny file, huge output; many entries; nested archives) | `maxInputBytes`, `maxEntries`, `maxEntryBytes`, `maxTotalBytes`, `maxRatio` (§5.2). Sizes are counted on the actual inflated stream, never trusted from headers, and inflation stops the moment a limit is passed. Nested archives are never opened. |
| **Zip structure tricks** (overlapping entries, local and central headers disagreeing, duplicate names) | Central directory is authoritative, local headers must agree, duplicates throw `ZIP_INVALID`. Entry names are opaque `Map` keys and never touch a file system, so path traversal does not apply. |
| **XXE and entity expansion** ("billion laughs") | The tokenizer rejects any `<!DOCTYPE` (`XML_DTD_FORBIDDEN`). Only the five predefined entities and numeric character references are decoded; references to invalid code points are errors. No external resource is ever fetched. |
| **Deep nesting** | `maxXmlDepth`. The tokenizer is iterative, never recursive. |
| **Memory exhaustion by content** | `maxCells`, `maxSharedStrings`, `maxWarnings`; sheets are streamed (§5.2). |
| **Prototype pollution** | Nothing read from a file becomes an object key. Lookups (styles, shared strings, relationships, defined names, custom properties) use `Map` or arrays. The only API that builds objects keyed by file content, `toDataset`, returns null-prototype objects (§4.3). `fromDataset` path accessors reject `__proto__`, `prototype` and `constructor`. |
| **Formula execution** | Formulas are never evaluated; they come back as text. |
| **Formula injection into CSV** | Guard on by default (§5.3). |
| **Malicious hyperlinks** | The writer allows only `http`, `https` and `mailto` by default, and rejects `javascript:`, `data:`, `vbscript:` and anything else not listed. The reader returns targets verbatim (it cannot know the consumer's policy): apps that render them, such as the viewer, must check the scheme. |
| **External references** | External links, OLE objects, DDE and data connections are not read or followed. The reader resolves relationships only within the package. |
| **ReDoS** | Hot paths (A1 parsing, number detection, CSV) use hand-written scanners or linear regexes with no nested quantifiers. Format codes are bounded by part size. |
| **Encrypted, legacy and macro content** | CFB containers (`.xls`, encrypted OOXML) throw `UNSUPPORTED_FORMAT`; VBA parts are dropped, never executed. |

Writer-side hygiene: all text and attributes are XML-escaped, and invalid XML characters are encoded (§3.4). A string that starts with `=` is text, never a formula. Sheet names and defined names are validated, and sheet names are quoted correctly in generated references (`'It''s'!A1`).

The limits are on by default. Raising them is an explicit `limits` option, and the README will say to keep them when the input is untrusted.

---

## 9. Versioning, compatibility, runtime support

### 9.1 Versioning

- Semantic Versioning. 2.0.0 is a breaking rewrite of 1.0.3. Pre-releases ship as `2.0.0-beta.n` on the `next` dist-tag; `latest` stays on 1.0.3 until 2.0.0 is final.
- **Public API:** the exports of the five entry points, their TypeScript types, the error codes and warning codes, and the behaviour documented here. `ZipCodec` and everything not exported are internal.
- **Breaking (major):** removing or renaming an export, option or code; a narrower accepted input type; a different default that changes output (for example the injection guard or `dateZone`); dropping a runtime from §9.3; required fields added to input types.
- **Not breaking (minor):** new exports, options and optional model fields; the reader populating new optional fields (consumers must tolerate unknown fields); new warning codes; new error codes for inputs that were previously undefined behaviour.
- **Patch:** bug fixes, including output that Excel had to repair.
- Read-limit defaults may be tuned in minors, but only upward (more permissive) when backed by measurements. Making them stricter is a major.
- Deprecations are announced in a minor with a runtime-free JSDoc `@deprecated` and removed in the next major.

### 9.2 Compatibility of files

- Writes ECMA-376 transitional SpreadsheetML that opens without repair in Excel (Windows and Mac, current), LibreOffice Calc, Apple Numbers and Google Sheets. The conformance suite (JSE-9) checks it.
- Reads files produced by those four plus common generators (SheetJS, ExcelJS, openpyxl, Apache POI).

### 9.3 Runtime support matrix

| Runtime | Support | Basis |
|---|---|---|
| Node.js 22, 24 | Supported, tested in CI | `engines: { "node": ">=22" }` |
| Node.js 20 and older | Not supported | Node 20 reached end of life on 2026-04-30 |
| Chrome, Edge | 103+ (`CompressionStream('deflate-raw')`) | MDN browser-compat-data (no browser job in CI yet) |
| Firefox | 113+ | MDN browser-compat-data (no browser job in CI yet) |
| Safari (macOS, iOS) | 16.4+ | MDN browser-compat-data (no browser job in CI yet) |
| Web Workers | Same versions as their browser | |
| Deno, Bun, Cloudflare Workers | Expected to work, untested | Same web APIs |
| TypeScript (consumers) | 5.0+, `moduleResolution` `node16`, `nodenext` or `bundler` | Types are built with TypeScript 7; CI job `Consumer TS` |
| Bundlers | Vite, webpack 5, Next.js (App Router, SSR), esbuild, Rollup | `exports` map, `sideEffects: false`, no import-time globals |

The floor is set by `deflate-raw` support in `CompressionStream`/`DecompressionStream`. For Node it is fixed at 22 (decided). The browser versions above are the earliest with `deflate-raw` in both `CompressionStream` and `DecompressionStream`, according to MDN browser-compat-data 8.1.9 (checked 2026-11-16 in JSE-2).

**TypeScript.** The library is compiled, and its `.d.ts` files generated, with TypeScript 7. The declarations in this document use only long-established type-system features: interfaces, union and literal types, generics with defaults, `Readonly`/`Record`/`Pick`/`Partial`, and classes. There are no `enum`s, no `namespace`s, no `declare global` and no ambient module augmentation. Nothing depends on compiler options or syntax that TypeScript 7 removed, which concern how code is compiled, not what declarations may contain. Consumers must resolve the package `exports` map, so their `moduleResolution` must be `node16`, `nodenext` or `bundler`. The oldest TypeScript version that can consume the published types is **5.0**, the first release with `moduleResolution: bundler`. 4.7–4.9 handle `node16`/`nodenext` but not `bundler`. The CI job `Consumer TS` enforces this floor: it type-checks a consumer fixture against the packed tarball with every TypeScript minor from 5.0 to 7.0, under all three modes, with `skipLibCheck` off. If a declaration ever needs a newer compiler, that job fails, and either the floor moves up (README and this table) or the declaration changes. There is no `typesVersions` fallback: it would only serve `moduleResolution: node` (node10), which cannot resolve the `exports` subpaths the code itself is loaded from.

---

## 10. Worked examples

### 10.1 Vanilla (browser)

```ts
import { fromDataset, toBlob, borderAll } from 'javascript-excel';
import { download } from 'javascript-excel/dom';

const sheet = fromDataset(
  {
    columns: [
      { title: 'Name', key: 'name', width: 'auto' },
      { title: 'Joined', key: 'joined', type: 'date', numFmt: 'yyyy-mm-dd' },
      {
        title: 'Sales',
        children: [
          { title: 'Q1', path: 'sales.q1', numFmt: '#,##0.00', total: 'sum' },
          { title: 'Q2', path: 'sales.q2', numFmt: '#,##0.00', total: 'sum' },
        ],
      },
    ],
    data: [
      { name: 'Ada', joined: new Date(2024, 0, 15), sales: { q1: 1200.5, q2: 980 } },
      { name: 'Grace', joined: new Date(2023, 5, 1), sales: { q1: 860, q2: 1430.25 } },
    ],
  },
  {
    name: 'People',
    freezeHeader: true,
    autoFilter: true,
    headerStyle: { font: { bold: true, color: 'FFFFFF' }, fill: '305496', border: borderAll({ style: 'thin' }) },
    totals: { label: 'Total', style: { font: { bold: true } } },
  },
);

const blob = await toBlob({ sheets: [sheet], properties: { title: 'People' } });
download(blob, 'people.xlsx');
```

Exporting an HTML table:

```ts
import { toBlob } from 'javascript-excel';
import { fromTable, download } from 'javascript-excel/dom';

const sheet = fromTable(document.querySelector('table')!, { styles: 'computed', freezeHeader: true });
download(await toBlob({ sheets: [sheet] }), 'report.xlsx');
```

### 10.2 React

The engine works directly in React. react-data-export 1.0 will wrap exactly this as `exportDataset()`, `useExcelExport()` and `<ExcelExport>`, so most apps should use it rather than the code below.

```tsx
import { fromDataset, toBlob } from 'javascript-excel';
import { download } from 'javascript-excel/dom';

export function ExportButton({ rows }: { rows: Array<{ id: number; email: string }> }) {
  const onClick = async () => {
    const sheet = fromDataset({ columns: [{ title: 'ID', key: 'id' }, { title: 'Email', key: 'email' }], data: rows });
    download(await toBlob({ sheets: [sheet] }), 'users.xlsx');
  };
  return <button onClick={onClick}>Export</button>;
}
```

Nothing in `javascript-excel` touches the DOM at import, so this component renders on the server unchanged; `download` only runs in the click handler.

### 10.3 Vue 3

```vue
<script setup lang="ts">
import { fromDataset } from 'javascript-excel';
import { toCsvBlob } from 'javascript-excel/csv';
import { download } from 'javascript-excel/dom';

const props = defineProps<{ orders: Array<{ id: string; total: number; placed: Date }> }>();

function exportCsv() {
  const sheet = fromDataset({
    columns: [{ title: 'Order', key: 'id' }, { title: 'Total', key: 'total' }, { title: 'Placed', key: 'placed' }],
    data: props.orders,
  });
  download(toCsvBlob(sheet, { delimiter: ';' }), 'orders.csv'); // BOM on, injection guard on
}
</script>

<template><button @click="exportCsv">Export CSV</button></template>
```

### 10.4 Node

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { toUint8Array } from 'javascript-excel';
import { read } from 'javascript-excel/read';

// Write
const bytes = await toUint8Array({
  sheets: [{
    name: 'Report',
    rows: [
      ['Item', 'Qty', 'Price', 'Line total'],
      ['Pens', 10, 1.5, { formula: 'B2*C2', value: 15 }],
      ['Pads', 4, 3.25, { formula: 'B3*C3', value: 13 }],
    ],
    colProps: [{ width: 20 }],
    view: { freeze: { rows: 1 } },
  }],
  properties: { creator: 'billing-service', created: new Date(), modified: new Date() },
}, { dateZone: 'utc' });
await writeFile('report.xlsx', bytes);

// Read an untrusted upload
const { workbook, warnings } = await read(await readFile('upload.xlsx'), {
  sheets: [0],
  styles: false,
  dateZone: 'utc',
  limits: { maxCells: 1_000_000 },
});
const first = workbook.sheets[0];
for (const row of first.rows) {
  // row?.[c] is a Cell: { type, value, formula?, style? }
}
if (warnings.length) console.warn(warnings);
```

### 10.5 Worker with progress and cancel

```ts
import { createWorkerClient } from 'javascript-excel/worker';

const client = createWorkerClient(new Worker(new URL('./excel.worker.ts', import.meta.url), { type: 'module' }));
const controller = new AbortController();
cancelButton.onclick = () => controller.abort();

const bytes = await client.write(workbook, {
  signal: controller.signal,
  onProgress: ({ ratio }) => (progressBar.value = ratio),
});
```

---

## 11. Appendix: OOXML reference tables

### 11.1 Format limits used by validation

| Limit | Value | Source |
|---|---|---|
| Rows per sheet | 1,048,576 | Excel specifications and limits |
| Columns per sheet | 16,384 (A..XFD) | Excel specifications and limits |
| Characters in a cell | 32,767 | Excel specifications and limits |
| Sheet name length | 31 | Excel UI; §3.3 |
| Column width | 255 characters | Excel specifications and limits |
| Row height | 409 points | Excel specifications and limits |
| Unique cell formats | 64,000 | Excel specifications and limits `[to verify: conformance.md, 18-limits]` |
| Formula length | 8,192 characters | Excel specifications and limits |
| Zoom | 10–400 % | `CT_SheetView/@zoomScale` |

### 11.2 Built-in number formats (ECMA-376 §18.8.30)

Ids defined by the spec. Ids 14–17 and 22 render according to the user's locale in Excel even though the spec lists these codes.

| Id | Code | Id | Code |
|---|---|---|---|
| 0 | `General` | 18 | `h:mm AM/PM` |
| 1 | `0` | 19 | `h:mm:ss AM/PM` |
| 2 | `0.00` | 20 | `h:mm` |
| 3 | `#,##0` | 21 | `h:mm:ss` |
| 4 | `#,##0.00` | 22 | `m/d/yy h:mm` |
| 9 | `0%` | 37 | `#,##0 ;(#,##0)` |
| 10 | `0.00%` | 38 | `#,##0 ;[Red](#,##0)` |
| 11 | `0.00E+00` | 39 | `#,##0.00;(#,##0.00)` |
| 12 | `# ?/?` | 40 | `#,##0.00;[Red](#,##0.00)` |
| 13 | `# ??/??` | 45 | `mm:ss` |
| 14 | `mm-dd-yy` | 46 | `[h]:mm:ss` |
| 15 | `d-mmm-yy` | 47 | `mmss.0` |
| 16 | `d-mmm` | 48 | `##0.0E+0` |
| 17 | `mmm-yy` | 49 | `@` |

Ids 5–8, 23–36, 41–44 and 50–163 are not in this table: they are reserved or locale-specific (currency, accounting, East Asian dates). The writer accepts them as numbers, but their rendering depends on the user's Excel locale. Prefer custom codes. `[to verify: the exact codes and spacing for 37–40 and 47; conformance.md, 10-number-formats]`

### 11.3 Mapping from xlsx-style keys

The style model keeps the familiar shape (`font`, `fill`, `border`, `alignment`, `numFmt`) but renames a few keys. The react-data-export migration guide will carry this table.

| xlsx-style / react-data-export 0.x | javascript-excel 2.0 |
|---|---|
| `font.sz` | `font.size` |
| `font.color: { rgb: 'FFFF0000' }` | `font.color: 'FF0000'`, or `{ rgb: 'FFFF0000' }` |
| `fill: { patternType: 'solid', fgColor: { rgb } }` | `fill: 'RRGGBB'`, or `{ pattern: 'solid', fgColor }` |
| `alignment.textRotation: 135` | `alignment.rotation: -45` |
| `alignment.readingOrder: 2` | `alignment.readingOrder: 'rtl'` |
| `border: { top: { style, color } }` | same; plus `'double'`, which the 0.x types lacked |
| `numFmt: '0.00%'` | same (string = custom code); numbers are built-in ids |
| `color.theme: { theme, tint }` | `{ theme: number, tint?: number }` |

---

## 12. Design decisions

These were the open questions of the review. Each one is decided, and the sections above state the outcome as the design. The numbering is kept stable so references such as "§12 Q6" stay valid.

**Q1. Node floor.** Decided (2026-11-15): **Node ≥ 22**. `engines: { "node": ">=22" }`, CI on 22 and 24 (§6, §9.3). Kept here so the question numbers stay stable.

**Q2. Date time zone default.** Decided (2026-11-16): `'local'` by default everywhere, with `dateZone: 'utc'` available on every read, write and CSV call. A `new Date(2024, 0, 15)` built in the browser shows as 15 Jan in Excel, and read-then-write round-trips in the same zone. Servers running in UTC behave the same either way.

**Q3. Plain-data model vs classes.** Decided (2026-11-16): plain data plus free functions (§3.1). The model can cross `postMessage`, and stays tree-shakable and serialisable. A fluent wrapper may come later as a separate entry if users ask for it.

**Q4. Style inheritance on write.** Decided (2026-11-16): the writer deep-merges `defaultStyle`, then column, then row, then cell into each cell's style (§3.5.7). That is what users mean by "make column B bold", and `fromDataset` relies on it.

**Q5. Number format strings.** Decided (2026-11-16): strings are never mapped to built-in ids, except `'General'` to id 0 (§3.5.5). A string always renders literally, and a number always means the built-in, locale-aware format.

**Q6. Shared formulas.** Decided (2026-11-16), implemented in JSE-6: JSE-6 builds a small A1 reference shifter that handles relative refs, `$` anchors, ranges and sheet-qualified refs, and leaves structured references and R1C1 alone. When a formula cannot be shifted safely, the cell carries the cached value only, with warning `SHARED_FORMULA_UNRESOLVED` (§3.4.2, §7.3).

**Q7. `read()` return shape.** Decided (2026-11-16): `read()` returns `{ workbook, warnings }` (§5.2). Warnings stay visible without polluting the model, and `onWarning` is there for streaming UIs.

**Q8. Shared, frozen style objects in reader output.** Decided (2026-11-16): cells with the same `xf` share one `Object.freeze`d `Style` (§3.5.7). That is cheap on memory and fast to compare. The docs say to copy before editing.

**Q9. ISO/IEC 29500 Strict files.** Decided (2026-11-16): the reader reads them by namespace mapping if JSE-6 finds that cheap. JSE-6 found it free: the tokenizer ignores namespace prefixes and relationship types are matched by their last segment, so Strict files read with no extra code (§5.2). The writer writes transitional only.

**Q10. Public `ZipCodec`.** Decided (2026-11-16): internal in 2.0, so its shape can still change (§6). It is revisited with the first real request, for example a synchronous fflate path.

**Q11. `_xlfn.` prefixes.** Decided (2026-11-16): 2.0 writes and reads formula text verbatim, and the docs explain the prefix (§3.4.2). A 2.x minor adds opt-in auto-prefixing for post-2007 functions, plus a reader option that strips the prefixes for display.

**Q12. CSV BOM default.** Decided (2026-11-16): `bom: true` for `toCsvBlob`, because that file goes to Excel, which needs the BOM to detect UTF-8. `bom: false` for `toCsv`, which returns a string for the program to use (§5.3).

**Q13. `toDataset` in 2.0.** Decided (2026-11-16): 2.0 ships the minimal version in §4.3: a fixed header row, deduplicated keys and null-prototype rows. Header auto-detection, multi-row header flattening, column mapping and type inference follow with react-data-import, and live in the engine. They shipped in JSE-19 as `javascript-excel/import` (§5.6), as decided in react-data-import's API design (2026-11-16).

**Q14. Number-format rendering.** Decided (2026-11-16): `javascript-excel/format` (§5.7) ships in 2.0, from 2.0.0-alpha.3. It was first planned for a 2.x minor; react-xlsx-viewer's design needs it for its 1.0, and Afzal moved it into 2.0 together with `/import`. `autoWidth` still measures `cellText()`, not formatted text.

**Q15. Worker packaging.** Decided (2026-11-16): the app writes a two-line worker file (§5.5). Every major bundler handles `new Worker(new URL(...))` in app code. Node `worker_threads` support may come later.

**Q16. Hyperlink scheme allowlist.** Decided (2026-11-16): by default the writer allows `http`, `https` and `mailto`, configurable through `hyperlinkSchemes` (§5.1, §8). `fromTable` uses the same list.

**Q17. `fullCalcOnLoad` default.** Decided (2026-11-16): `'auto'`. The writer sets it only when some formula has no cached value (§3.4.2), so files that carry every cached value open without a forced recalculation.

**Q18. `key` vs `path` in column definitions.** Decided (2026-11-16): separate fields, with `key` read literally and `path` for nested data (§4.3). react-data-export may still accept a single field and map it.

**Q19. Invalid sheet names in builders.** Decided (2026-11-16): `fromDataset` and `fromTable` throw `INVALID_SHEET_NAME`, like the core. `sanitizeSheetName()` is exported for callers that take names from user data (§4.6).

---

## 13. Roadmap beyond 2.0

**End goal:** read, write and view every kind of Excel and CSV file. 2.0 is the first phase. Later phases add the following, and the version that delivers each is the plan as of 2026-11-16, not a commitment.

| Phase | Adds |
|---|---|
| 2.0 | xlsx read and write (cells, styles, sheet features), CSV/TSV read and write, HTML table input |
| 2.x | `.xlsm` / `.xltx` / `.xltm` read and write-back with their extra parts preserved; preservation of unknown parts for lossless round trips; comments and notes; data validation; conditional formatting; images (read and write) |
| 3.x | formula parser and evaluator (`javascript-excel/formula`), charts and drawings (read, plus their part of the render model, §5.8) |
| 4.x | legacy `.xls` (BIFF8) read, then write; `.xlsb` read; encrypted files (password, ECMA-376 agile encryption) |

The 2.x row is designed in [design/2x.md](design/2x.md) (decided 2026-11-16: phases 2.1–2.5, dependency order, and what each phase will not do).

### Guardrails for 2.0's design

These follow from the roadmap and apply to every 2.0 change.

- **The model grows by optional fields.** The writer ignores fields it does not know (§3.1, §9.1), so later phases add optional fields to `Workbook`, `Sheet` and `Cell` in minor releases. Expected additions include sheet-level comments, data validations, conditional formats, drawings and images, and Excel tables, and workbook-level preserved parts. Their names and shapes are designed in the phase that adds them; until then no 2.0 field may use those meanings.
- **The writer's part list is open.** Parts register their content types and relationships with an internal package registry (`[Content_Types].xml` defaults and overrides, `_rels/.rels`, `workbook.xml.rels`, and a relationships builder per sheet that hyperlinks already use). A new part, such as `xl/comments1.xml`, a drawing or an image, adds itself without changing the existing ones.
- **Format detection is a table.** `detectFormat` (§5.2) identifies each container and format separately, and `UNSUPPORTED_FORMAT` names the format in `details.format`. Adding a reader for `.xls` or `.xlsb` later means adding a table entry and a reader, not removing a wall.
- **The reader can keep what it does not model.** Its part handling is designed so that a later phase can carry unmodelled parts through to the writer for lossless write-back.
- **Formula text is always preserved**, verbatim with its cached value (§3.4.2), so evaluation can come later without a model change.
- **Unions may widen in later phases.** For example, `ErrorCode` may gain newer Excel errors such as `#SPILL!` once the writer can write them (§3.4). Code that switches over model unions should keep a default branch.

