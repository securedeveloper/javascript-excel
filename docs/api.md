# javascript-excel 2.0: API design

Status: **approved** (2026-11-16). This is the design that implementation follows. §12 records the decisions taken in review. Any change to the design is made by editing this document in a PR.

Conventions in this document:

- `[to verify]` marks an OOXML or platform fact that must be checked against ECMA-376 or a real file before the code relies on it.
- `[placeholder, set in JSE-n]` marks a number that has not been measured. The task named sets it.
- `JSE-n` names the implementation task of this rewrite that owns a decision (JSE-2 zip and model, JSE-3 writer, JSE-4 sheet features, JSE-5 CSV, JSE-6 reader, JSE-7 DOM, JSE-8 performance and worker, JSE-9 conformance).
- ECMA-376 references are to Part 1 (Fundamentals and Markup Language Reference), 5th edition, transitional schema, unless stated otherwise.

## Contents

1. [Goals, non-goals, out of scope](#1-goals-non-goals-out-of-scope)
2. [Entry points](#2-entry-points)
3. [Data model](#3-data-model)
4. [Builders and helpers](#4-builders-and-helpers)
5. [Write, read, CSV, DOM and worker APIs](#5-write-read-csv-dom-and-worker-apis)
6. [Zip codec](#6-zip-codec)
7. [Errors and warnings](#7-errors-and-warnings)
8. [Security model](#8-security-model)
9. [Versioning, compatibility, runtime support](#9-versioning-compatibility-runtime-support)
10. [Worked examples](#10-worked-examples)
11. [Appendix: OOXML reference tables](#11-appendix-ooxml-reference-tables)
12. [Design decisions](#12-design-decisions)

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

### Non-goals

- **Lossless round-trip of arbitrary files.** `write(read(file))` keeps everything in the model below. Parts the model does not cover (charts, drawings, pivots, comments, and so on) are dropped, with a warning on read. There is no "pass unknown parts through" mode in 2.0.
- **Formula evaluation.** Formulas are stored as text with their cached values. Evaluation is a separate, later module.
- **A synchronous API.** All file I/O is `async` (§6).
- **Pixel-exact layout.** Column widths, auto-width and row heights use the spec's character-width formulas, not font metrics.
- **Compatibility with the 1.x API.** 2.0 is a rewrite. The 1.x constructor that took injected `jszip` / `saveAs` instances is gone.

### Out of scope for 2.0

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
 * Reader output is always a number in characters.
 */
export type ColumnWidth = number | { wch: number } | { wpx: number };
```

**Column width conversion** (ECMA-376 §18.3.1.13, `col/@width`). The file stores the width including padding. With the maximum digit width `MDW` of the default font:

- characters to file width: `width = Truncate((wch * MDW + 5) / MDW * 256) / 256`
- pixels to file width: `width = Truncate(((wpx - 5) / MDW) * 100 + 0.5) / 100`, then the formula above
- file width to pixels (reader): `wpx = Truncate(((256 * width + Truncate(128 / MDW)) / 256) * MDW)`

`MDW = 7` px for Calibri 11, the default font `[to verify in JSE-4 against Excel's output: 8.43 characters should give width="9.140625"]`. The model's character unit is the one Excel's UI shows. The maximum width is 255 characters.

**Sheet names.** The writer throws `INVALID_SHEET_NAME` unless the name:

- is 1 to 31 characters long `[to verify: whether Excel counts UTF-16 code units or code points for astral characters]`;
- contains none of `\ / ? * [ ] :`;
- does not start or end with an apostrophe `'`;
- is not `History`, which Excel reserves `[to verify]`.

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
| `{ error }` | `t="e"` | Only the seven codes above. Other `#...` strings are not accepted in 2.0 `[to verify: how newer Excel errors such as #SPILL! are stored in files]`. |
| `{ richText }` | shared string with `<r>` runs | |
| `Cell` with `formula` | `<f>` + cached `<v>` when `value` is set | §3.4.2 |
| `null` / `undefined` / hole | no `<c>`, or a styled empty `<c>` if the `Cell` has a `style` | |

Text encoding follows ECMA-376 `ST_Xstring`: characters not allowed in XML 1.0, and `\r`, which XML parsers turn into `\n`, are written as `_xHHHH_`. Text that already contains `_xHHHH_` literally is escaped as `_x005F_xHHHH_`. The reader reverses both. Leading and trailing whitespace is kept with `xml:space="preserve"`.

The reader returns each cell as a `Cell` with `type` set. Bare values are never returned. `cellText(cell)` (§4.5) gives the plain text of any cell.

#### 3.4.1 Dates

Excel stores dates as serial numbers. The writer converts `Date` to a serial and the reader converts back, both in the time zone set by `dateZone` (default `'local'`, see §12 Q2).

- **1900 system** (default): serial 1 = 1900-01-01. Excel treats 1900 as a leap year, so serial 60 is the non-existent 1900-02-29 and every serial from 61 onwards is offset by one. The writer writes dates from 1900-03-01 onwards with the epoch 1899-12-30, and earlier dates with epoch 1899-12-31, which matches Excel. The reader returns serial 60 as a number with warning `INVALID_DATE_SERIAL`.
- **1904 system** (`date1904: true`): serial 0 = 1904-01-01.
- Range: 1900-01-01 (1904 system: 1904-01-01) to 9999-12-31. Outside it, or for an invalid `Date`, the writer throws `INVALID_DATE`.
- Fractions are times of day; the writer keeps millisecond precision.

**Date detection on read.** A numeric cell is returned as `type: 'date'` with a `Date` value when its number format is a date or time format:

- built-in ids 14–22 and 45–47;
- built-in ids 27–36 and 50–58 (locale-dependent East Asian date formats) `[to verify in JSE-6]`;
- custom codes that, after removing quoted literals, backslash escapes and bracketed sections other than the elapsed-time tokens `[h]`, `[m]`, `[s]`, contain a date/time token (`y`, `m`, `d`, `h`, `s`, `AM/PM`, `A/P`, `e`, `g`, `b`) `[to verify against the JSE-9 fixtures]`.

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
  indent?: number;                     // Excel UI caps at 250 [to verify]
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
- Number formats are not rendered (no "format 1234.5 as `#,##0.00`") in 2.0 (§12 Q14).

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
  | { indexed: number }                // legacy palette 0..63, 64 = system foreground, 65 = system background [to verify 64/65]
  | { auto: true };                    // automatic colour
```

All four forms map one to one to `CT_Color` attributes (`rgb`, `theme` + `tint`, `indexed`, `auto`), and the reader returns the same form the file used. The reader returns object forms only, never the string shorthand. Notes:

- **Alpha.** Excel ignores the alpha byte of `rgb`; the writer still writes it.
- **Theme index order.** The index refers to the theme's `clrScheme` with the first two pairs swapped: 0 = `lt1` (Background 1), 1 = `dk1` (Text 1), 2 = `lt2`, 3 = `dk2`, 4–9 = `accent1`–`accent6`, 10 = `hlink`, 11 = `folHlink` `[to verify in JSE-6 with Excel fixtures]`.
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
- Hyperlinks are set per cell (`Cell.hyperlink`). The writer collects them into `<hyperlinks>`. External targets go to the sheet's relationships with `TargetMode="External"`. Internal locations use `@location`. The cell's value is the display text. A hyperlink in a file whose `ref` spans a range is attached to its top-left cell, with warning `HYPERLINK_RANGE_REDUCED`.

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

"Fit to width" is `fitTo: { width: 1, height: 0 }`.

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
export function cellText(cell: CellInput): string;   // plain text: rich text joined, errors as '#N/A', dates ISO 8601
```

### 4.3 `fromDataset`: the `{ columns, data }` shape

This is the main builder. It serves react-data-export's dataset export and any vanilla or Vue user.

```ts
export function fromDataset<T>(dataset: Dataset<T>, options?: DatasetOptions<T>): Sheet;

/** Several blocks stacked on one sheet (replaces the old xSteps/ySteps). */
export function fromDatasets(
  blocks: Array<Dataset<any> & { offset?: { rows?: number; cols?: number } }>,
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
  total?: 'sum' | 'average' | 'count' | 'min' | 'max' | CellInput
        | ((ctx: { range: string; values: CellValue[] }) => CellInput);
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
  max?: number;                        // characters, default 60 [placeholder, set in JSE-4]; cap 255
  sampleRows?: number;                 // rows measured, default all [placeholder, set in JSE-8]
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

```ts
/** Inverse direction, for import: a sheet back to { columns, data }. */
export function toDataset(
  sheet: Sheet<Cell>,
  options?: {
    headerRow?: number | false;        // zero-based row index, default 0; false = keys are column letters
    range?: string;                    // default: sheet.dimension
    values?: 'value' | 'cell';         // 'value' (default): CellValue; 'cell': the full Cell
  },
): { columns: Array<{ title: string; key: string }>; data: Array<Record<string, unknown>> };
```

`toDataset` builds keys from header text, deduplicated with `_2`, `_3` suffixes; an empty header gives the column letter. Rows are **null-prototype objects** (`Object.create(null)`), so a header named `__proto__` from an untrusted file is just a key. Header auto-detection, multi-row header flattening and type inference are react-data-import's needs and are deferred (§12 Q13).

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

## 5. Write, read, CSV, DOM and worker APIs

### 5.1 Write (`javascript-excel`)

```ts
export function toUint8Array(wb: Workbook, options?: WriteOptions): Promise<Uint8Array>;
export function toBlob(wb: Workbook, options?: WriteOptions): Promise<Blob>; // type: XLSX_MIME

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
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
}

export interface Progress {
  phase: 'prepare' | 'styles' | 'sheets' | 'zip' | 'unzip' | 'parse';
  sheet?: string;
  /** Overall progress estimate 0..1, non-decreasing. */
  ratio: number;
}
```

- Validation runs before any output and throws `ValidationError` (§7). The writer emits no warnings: any input it cannot write faithfully is an error.
- Parts written: `[Content_Types].xml`, `_rels/.rels`, `docProps/core.xml`, `docProps/app.xml`, `docProps/custom.xml` (if any), `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml`, `xl/theme/theme1.xml`, `xl/sharedStrings.xml` (if used), `xl/worksheets/sheetN.xml` and `xl/worksheets/_rels/sheetN.xml.rels` (for hyperlinks).
- XML is produced as chunk arrays and fed to the compressor in pieces; the whole sheet is never built as one string. The output is assembled in memory, so peak memory is roughly the model plus the compressed file.
- **Deterministic output:** the same model and options give identical bytes when `properties.created` and `properties.modified` are set. Zip entry timestamps come from `modified`.
- Abort: rejects with `signal.reason` (a `DOMException` named `AbortError` by default), the same as `fetch`. The writer checks the signal and yields to the event loop between chunks of rows `[chunk size: placeholder, set in JSE-8]`.
- `onProgress` is throttled `[interval: placeholder, set in JSE-8]`.

### 5.2 Read (`javascript-excel/read`)

```ts
export type BinaryInput = Uint8Array | ArrayBuffer | Blob;   // Node Buffer is a Uint8Array

export function read(input: BinaryInput, options?: ReadOptions): Promise<ReadResult>;
export function readSheetNames(input: BinaryInput, options?: Pick<ReadOptions, 'limits' | 'signal'>):
  Promise<Array<{ name: string; index: number; state: 'visible' | 'hidden' | 'veryHidden' }>>;
export function detectFormat(input: BinaryInput):
  Promise<'xlsx' | 'xlsm' | 'xlsb' | 'ods' | 'cfb' | 'zip' | 'unknown'>; // 'cfb' = .xls or an encrypted OOXML file

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
  limits?: Partial<ReadLimits>;
  signal?: AbortSignal;
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

Proposed defaults. None is measured yet; JSE-6 sets the real values against the fixture corpus and the JSE-8 benchmarks.

| Limit | Proposed default | Status |
|---|---|---|
| `maxInputBytes` | 256 MiB | `[placeholder, set in JSE-6]` |
| `maxEntries` | 10,000 | `[placeholder, set in JSE-6]` |
| `maxEntryBytes` | 512 MiB | `[placeholder, set in JSE-6]` |
| `maxTotalBytes` | 1 GiB | `[placeholder, set in JSE-6]` |
| `maxRatio` | 100, checked only once an entry has produced more than 1 MiB | `[placeholder, set in JSE-6]` |
| `maxXmlDepth` | 64 | `[placeholder, set in JSE-6]` |
| `maxCells` | 20,000,000 | `[placeholder, set in JSE-6]` |
| `maxSharedStrings` | 5,000,000 | `[placeholder, set in JSE-6]` |
| `maxWarnings` | 1,000 | `[placeholder, set in JSE-6]` |

Spreadsheet format limits are always enforced and cannot be configured: 1,048,576 rows, 16,384 columns (`XFD`). A cell reference beyond them is skipped with warning `CELL_OUT_OF_BOUNDS`.

How the reader works, as far as the API is concerned:

- The whole archive is held in memory, because the zip central directory sits at the end of the file. Parts are inflated one at a time and streamed through the XML pull tokenizer, so a sheet's XML is never held whole. The shared strings table is held whole.
- Parts are found through relationships (`_rels/.rels` → workbook → sheets), never by fixed path, so files from Google Sheets, Numbers and LibreOffice, which use different part names, work. Part names are compared case-insensitively, as OPC requires. Absolute and relative relationship targets are both resolved.
- Cells and rows without an `r` attribute (allowed by the schema) are placed by position. A missing or wrong `<dimension>` is ignored; `sheet.dimension` is computed from the cells.
- ISO/IEC 29500 Strict files use different namespaces. JSE-6 reads them by mapping the Strict namespaces to the transitional ones, if that proves cheap. Otherwise the reader throws `UNSUPPORTED_FORMAT` with `details.format: 'strict'` (§12 Q9). The writer writes transitional only.

### 5.3 CSV (`javascript-excel/csv`)

```ts
export function parseCsv(text: string, options?: CsvParseOptions): CsvParseResult;
export function readCsv(input: string | BinaryInput, options?: CsvParseOptions & { encoding?: string }): Promise<CsvParseResult>;
export function toCsv(source: Sheet | CellInput[][], options?: CsvWriteOptions): string;
export function toCsvBlob(source: Sheet | CellInput[][], options?: CsvWriteOptions): Blob; // 'text/csv;charset=utf-8'

export interface CsvParseOptions {
  /** A single character, or 'auto' (default): picks from , ; TAB | by field-count consistency over the first records. */
  delimiter?: string | 'auto';
  quote?: string;                      // default '"'; a quote inside a quoted field is doubled (RFC 4180)
  /** Default false: every field is a string. true: numbers, TRUE/FALSE, ISO 8601 dates (no locale guessing). */
  inferTypes?: boolean;
  skipEmptyLines?: boolean;            // default false
  /** 'lenient' (default): malformed input gives warnings. 'strict': throws CsvError. */
  mode?: 'lenient' | 'strict';
  maxRows?: number;                    // default unlimited
  maxFieldBytes?: number;              // default [placeholder, set in JSE-5]
  signal?: AbortSignal;                // readCsv only
}

export interface CsvParseResult {
  rows: CellValue[][];                 // string[][] unless inferTypes
  delimiter: string;                   // the one used (detected or given)
  newline: '\r\n' | '\n' | '\r';       // the first one seen
  bom: boolean;                        // input started with a BOM (removed from the data)
  warnings: ExcelWarning[];            // CSV_UNTERMINATED_QUOTE, CSV_FIELD_COUNT, CSV_STRAY_QUOTE, ...
}

export interface CsvWriteOptions {
  delimiter?: string;                  // default ','
  newline?: '\r\n' | '\n';             // default '\r\n' (RFC 4180)
  quote?: 'auto' | 'all';              // 'auto' (default): quote fields containing delimiter, quote, CR or LF
  /** Prepend a UTF-8 BOM so Excel detects UTF-8. toCsvBlob default true, toCsv default false. */
  bom?: boolean;
  /** Formula-injection guard, default true. See below. */
  escapeFormulas?: boolean;
  /** Dates: 'iso' (default; YYYY-MM-DD, or YYYY-MM-DDTHH:mm:ss when there is a time) or a function. */
  dates?: 'iso' | ((d: Date) => string);
  dateZone?: 'local' | 'utc';
  /** Formula cells: write the cached value (default) or the formula text ('formula', which still passes the guard). */
  formulas?: 'value' | 'formula';
}
```

- **Decoding** (`readCsv`): a UTF-8, UTF-16LE or UTF-16BE BOM wins. Otherwise `encoding` applies (any label `TextDecoder` accepts), default `'utf-8'`. Invalid bytes become U+FFFD with a warning.
- **Newlines** CRLF, LF and CR are all record separators. Quoted fields may contain any of them.
- **Serialising values:** numbers as `String(n)` (shortest round-trip, never locale-formatted), booleans as `TRUE`/`FALSE`, errors as their code, rich text as plain text, empty cells as empty fields. A `Sheet` is serialised from `A1` to its last used cell; merges, styles and hyperlinks are dropped.
- **Formula-injection guard (on by default).** A **string** field that starts with `=`, `+`, `-`, `@`, TAB (`\t`) or CR (`\r`) is written with a leading `'`, so a spreadsheet app opening the CSV treats it as text. Numbers, booleans and dates from the model are not strings and are never prefixed, so `-5` stays `-5`. `escapeFormulas: false` turns the guard off. It applies to `toCsv` and `toCsvBlob` only; the xlsx writer does not need it, because xlsx cells have explicit types (§3.4).

### 5.4 DOM (`javascript-excel/dom`)

```ts
export function fromTable(table: HTMLTableElement, options?: FromTableOptions): Sheet;
export function download(data: Uint8Array | Blob | string, filename: string, options?: { mimeType?: string }): void;

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
  /** <a href> becomes Cell.hyperlink (default true). Scheme allowlist as in WriteOptions. */
  links?: boolean;
  freezeHeader?: boolean;
  autoFilter?: boolean;
  autoWidth?: boolean | AutoWidthOptions;
  /** Per-cell hook: return a CellInput to override, or undefined to keep the default mapping. */
  cell?: (el: HTMLTableCellElement, ctx: { row: number; col: number; header: boolean }) => CellInput | undefined;
}
```

- **Structure.** Rows come from `<thead>`, then each `<tbody>` (and bare `<tr>`), then `<tfoot>`. `colspan`/`rowspan` are laid out on an occupancy grid and become `merges` (issue #28). Nested tables are read as text of their cell, not as rows.
- **Hints on `<td>`/`<th>`:** `data-type="string|number|boolean|date"`, `data-value="..."` (raw value instead of `textContent`), `data-numfmt="0.00"`. `data-export-ignore` on a row or cell skips it.
- **Text:** `textContent`, whitespace collapsed; `<br>` becomes a newline and turns on `wrapText`.
- **`styles: 'computed'`** maps `font-weight >= 600` to bold, `font-style: italic`, `text-decoration` underline and line-through, `color`, a non-transparent `background-color` (solid fill), `text-align`, `vertical-align` and `white-space`. Borders are not mapped in 2.0.
- **RTL:** `dir="rtl"` on the table (or computed `direction: rtl`) sets `view.rightToLeft`.
- **`download`** creates an object URL, clicks a temporary `<a download>` and revokes the URL after a delay `[placeholder, set in JSE-7]`. A string `data` is encoded as UTF-8 (`mimeType` default `text/plain;charset=utf-8`). Without a DOM it throws `ENVIRONMENT_UNSUPPORTED`.

### 5.5 Worker (`javascript-excel/worker`)

```ts
// excel.worker.ts (two lines the app writes)
import { exposeWorker } from 'javascript-excel/worker';
exposeWorker();

// main thread
export function createWorkerClient(worker: Worker): WorkerClient;

export interface WorkerClient {
  write(wb: Workbook, options?: WriteOptions & { transfer?: boolean }): Promise<Uint8Array>;
  read(input: BinaryInput, options?: ReadOptions & { transfer?: boolean }): Promise<ReadResult>;
  toCsv(source: Sheet | CellInput[][], options?: CsvWriteOptions): Promise<string>;
  parseCsv(input: string | BinaryInput, options?: CsvParseOptions): Promise<CsvParseResult>;
  terminate(): void;
}
```

- The app owns the worker file and creates it with `new Worker(new URL('./excel.worker.ts', import.meta.url), { type: 'module' })`. This is the pattern Vite, webpack 5 and Next.js all bundle correctly, and avoids shipping a prebuilt worker URL (§12 Q15).
- `onProgress` callbacks and `signal` work across the boundary. Aborting sends a cancel message; the worker stops at its next check and the promise rejects with `signal.reason`.
- **Transfer:** results (`Uint8Array`) are transferred back, not copied. Inputs are copied by default. With `transfer: true`, an input `ArrayBuffer` or `Uint8Array` is transferred and becomes detached in the caller. `Blob`s are always cheap to send.
- The model crosses the boundary through structured clone, which is why it is plain data (§3.1). Functions (dataset accessors, `cell` hooks, `rowStyle`) cannot cross, so `fromDataset` and `fromTable` run on the main thread and the resulting `Sheet` is sent to the worker.
- Several calls may be in flight on one client; they run one after another in the worker.
- Node `worker_threads` is not supported by `/worker` in 2.0. Node users call `read`/`toUint8Array` directly, or in their own worker. Support may come in a later minor.

---

## 6. Zip codec

Internal. Not exported in 2.0, so its shape can still change; this is revisited when a real need appears (§12 Q10).

```ts
/** Compression only. The container format (headers, central directory, CRC-32) is in-house and not pluggable. */
interface ZipCodec {
  /** Raw DEFLATE (RFC 1951), no zlib/gzip wrapper. Input arrives in chunks. */
  deflateRaw(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, signal?: AbortSignal): Promise<Uint8Array>;
  /** Streams output; aborts with LIMIT_EXCEEDED as soon as maxOutputBytes or the ratio limit is passed. */
  inflateRaw(
    data: Uint8Array,
    limits: { maxOutputBytes: number; maxRatio: number },
    signal?: AbortSignal,
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
| `INVALID_ACTIVE_SHEET` | Validation | Out of range, or the sheet is hidden |
| `INVALID_REF` | Validation | Malformed A1 reference or range |
| `OUT_OF_BOUNDS` | Validation | Row or column beyond the format limits |
| `INVALID_CELL` | Validation | `type` disagrees with `value`, or an unsupported value |
| `INVALID_NUMBER` | Validation | `NaN` or `±Infinity` |
| `INVALID_DATE` | Validation | Invalid or out-of-range `Date` (§3.4.1) |
| `STRING_TOO_LONG` | Validation | More than 32,767 characters in a cell |
| `INVALID_STYLE` | Validation | Bad colour string, unknown enum value, out-of-range number |
| `INVALID_NUMFMT` | Validation | Empty code, or an id outside 0..163 given as a number |
| `INVALID_HYPERLINK` | Validation | Scheme not in `hyperlinkSchemes` (e.g. `javascript:`), or malformed |
| `OVERLAPPING_MERGE` | Validation | Two merges overlap |
| `INVALID_COLUMN` | Validation | `fromDataset`: no usable accessor, or a forbidden path segment |
| `TOO_MANY_STYLES` | Validation | More than 64,000 distinct cell formats, Excel's limit `[to verify]` |
| `ZIP64_REQUIRED` | Validation | §6 |
| `UNSUPPORTED_FORMAT` | Format | `.xls`/encrypted (CFB), `.xlsb`, `.ods`, and Strict OOXML if not mapped (§5.2); `details.format` says which |
| `NOT_XLSX` | Format | A zip without a workbook part |
| `ZIP_INVALID` / `ZIP_UNSUPPORTED_METHOD` / `ZIP_ENCRYPTED` / `ZIP_CRC_MISMATCH` | Format | §6 |
| `XML_MALFORMED` | Format | Not well-formed XML in a required part |
| `XML_DTD_FORBIDDEN` | Format | Any `<!DOCTYPE` (§8) |
| `LIMIT_EXCEEDED` | Limit | Any `ReadLimits` value; `details: { limit, value, max }` |
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

- **CSV:** lenient by default (warnings `CSV_UNTERMINATED_QUOTE`, `CSV_STRAY_QUOTE`, `CSV_FIELD_COUNT`, `CSV_INVALID_ENCODING`); `mode: 'strict'` throws `CSV_MALFORMED` instead.

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
| Unique cell formats | 64,000 | Excel specifications and limits `[to verify]` |
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

Ids 5–8, 23–36, 41–44 and 50–163 are not in this table: they are reserved or locale-specific (currency, accounting, East Asian dates). The writer accepts them as numbers, but their rendering depends on the user's Excel locale. Prefer custom codes. `[to verify in JSE-3: the exact codes and spacing for 37–40 and 47]`

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

**Q6. Shared formulas.** Decided (2026-11-16): JSE-6 builds a small A1 reference shifter that handles relative refs, `$` anchors, ranges and sheet-qualified refs, and leaves structured references and R1C1 alone. When a formula cannot be shifted safely, the cell carries the cached value only, with warning `SHARED_FORMULA_UNRESOLVED` (§3.4.2, §7.3).

**Q7. `read()` return shape.** Decided (2026-11-16): `read()` returns `{ workbook, warnings }` (§5.2). Warnings stay visible without polluting the model, and `onWarning` is there for streaming UIs.

**Q8. Shared, frozen style objects in reader output.** Decided (2026-11-16): cells with the same `xf` share one `Object.freeze`d `Style` (§3.5.7). That is cheap on memory and fast to compare. The docs say to copy before editing.

**Q9. ISO/IEC 29500 Strict files.** Decided (2026-11-16): the reader reads them by namespace mapping if JSE-6 finds that cheap. Otherwise it throws `UNSUPPORTED_FORMAT` with `details.format: 'strict'` (§5.2). The writer writes transitional only.

**Q10. Public `ZipCodec`.** Decided (2026-11-16): internal in 2.0, so its shape can still change (§6). It is revisited with the first real request, for example a synchronous fflate path.

**Q11. `_xlfn.` prefixes.** Decided (2026-11-16): 2.0 writes and reads formula text verbatim, and the docs explain the prefix (§3.4.2). A 2.x minor adds opt-in auto-prefixing for post-2007 functions, plus a reader option that strips the prefixes for display.

**Q12. CSV BOM default.** Decided (2026-11-16): `bom: true` for `toCsvBlob`, because that file goes to Excel, which needs the BOM to detect UTF-8. `bom: false` for `toCsv`, which returns a string for the program to use (§5.3).

**Q13. `toDataset` in 2.0.** Decided (2026-11-16): 2.0 ships the minimal version in §4.3: a fixed header row, deduplicated keys and null-prototype rows. Header auto-detection, multi-row header flattening, column mapping and type inference follow with react-data-import, and live in the engine.

**Q14. Number-format rendering.** Decided (2026-11-16): not in 2.0 (§3.5.5). It is planned as `javascript-excel/format` in a 2.x minor. 2.0's `autoWidth` uses `cellText()`.

**Q15. Worker packaging.** Decided (2026-11-16): the app writes a two-line worker file (§5.5). Every major bundler handles `new Worker(new URL(...))` in app code. Node `worker_threads` support may come later.

**Q16. Hyperlink scheme allowlist.** Decided (2026-11-16): by default the writer allows `http`, `https` and `mailto`, configurable through `hyperlinkSchemes` (§5.1, §8). `fromTable` uses the same list.

**Q17. `fullCalcOnLoad` default.** Decided (2026-11-16): `'auto'`. The writer sets it only when some formula has no cached value (§3.4.2), so files that carry every cached value open without a forced recalculation.

**Q18. `key` vs `path` in column definitions.** Decided (2026-11-16): separate fields, with `key` read literally and `path` for nested data (§4.3). react-data-export may still accept a single field and map it.

**Q19. Invalid sheet names in builders.** Decided (2026-11-16): `fromDataset` and `fromTable` throw `INVALID_SHEET_NAME`, like the core. `sanitizeSheetName()` is exported for callers that take names from user data (§4.6).
