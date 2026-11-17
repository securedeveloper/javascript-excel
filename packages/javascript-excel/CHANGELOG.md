# javascript-excel

## 2.0.0-alpha.7

### Minor Changes

- 252a056: `fromDatasets` blocks take an optional `placement: 'below' | 'right'`. `'below'` (the default) is the existing behaviour. `'right'` puts a block on the previous block's top row, `gap` empty columns after its last column, with `offset.cols` and `offset.rows` adding to that. A `'below'` block after `'right'` blocks starts below the lowest of them, so blocks do not overlap. Existing calls give the same output as before.

### Patch Changes

- 938a6c6: `read` now returns to the event loop about every 16 ms while it parses, and feeds the decompressor in slices, so reading a large file on the main thread no longer freezes the page: frames render, timers and input run, and an abort from a timer or a click takes effect while the read is in flight. The resulting model is unchanged.
- 33ba222: `toUint8Array` and `toBlob` now return to the event loop about every 16 ms while they write, so a large export on the main thread no longer freezes the page: frames render, timers and input run, and an abort from a timer or a click takes effect while the write is in flight. The output bytes are unchanged.

## 2.0.0-alpha.6

### Minor Changes

- 07706d3: `importDataset` issues now name the field as it appears in `data` rows. With a schema, `TYPE`, `ERROR_CELL` and `DATE_ORDER_AMBIGUOUS` issues use the schema field name; they used the source column key. The new optional `column` property on `ImportIssue` holds the source column key (also set by `coerceColumns` and on `applyMapping`'s `REQUIRED`). A value that doesn't convert to a forced type in a required field gives one `TYPE` issue, no longer a `REQUIRED` issue as well. Issues on columns the mapping drops are left out.
  
  Migration: if you grouped issues by the source column key, group by `issue.column`.

### Patch Changes

- 8886d76: `fromTable` with `styles: 'computed'` now maps text and background colours that browsers report as `lab()`, `lch()`, `oklab()`, `oklch()` or `color()` (for example Tailwind v4 colours), converting them to sRGB. Before, only `rgb()`, hex and named colours were kept.

## 2.0.0-alpha.5

### Minor Changes

- 3fcf25b: `javascript-excel/render`: `setRowHeights(sheet, heights)` sets measured heights for rows without a stored height (a viewer's auto-fit). It grows rows only, clamped to 409 pt, and rebuilds the offsets from the first changed row. `hasStoredRowHeight(sheet, row)` tells which rows the file sized.

## 2.0.0-alpha.4

### Minor Changes

- 6ce413a: `importDataset` and `applyMapping`: a schema field without a column is now `null` in every row, and `columns` lists every schema field. An unmapped field's column has an empty title and letter, `type: 'empty'`, and its `field`. Rows always have the schema's shape, so validators such as Zod's `.nullable()` accept them; before this change the key was missing. A required field without a column still gives one `MAPPING_MISSING` issue, and is `null` in the rows.

## 2.0.0-alpha.3

### Minor Changes

- 4669375: New entry `javascript-excel/import` turns a user's `.xlsx` or `.csv` file into `{ columns, data }` with `importDataset`. It handles:
  
  - the format, detected from the bytes
  - the sheet: the first visible one, or one picked by name or index
  - the header row, detected (title rows skipped, multi-row headers flattened)
  - column types, inferred all-or-nothing, with explicit number and date locales
  - column mapping to a schema by name or alias
  - per-row issues with their cell refs, and `maxRows` / `preview`
  
  The building blocks are exported too: `detectHeader`, `inferColumnTypes`, `coerceColumns`, `parseNumber`, `parseDate`, `mapColumns` and `applyMapping`.
  
  Other additions:
  
  - `read` gains `maxRows`. Rows past it are skipped without tokenizing them, while merges and sheet views are still read. It comes with a `ROWS_TRUNCATED` warning.
  - `toDataset` gains `headerRows` and `join` for multi-row headers.
  - The worker client gains `importDataset`.
  - New error codes: `SHEET_NOT_FOUND`, and `VALIDATION_FAILED` (reserved for react-data-import).
- 68d2df8: New entry `javascript-excel/format`: `formatValue(value, numFmt, options)` and `formatCell(cell, options)` render values the way Excel shows them in a cell. They cover number-format sections, conditions and colours, digit placeholders, grouping and scaling, percent, scientific, fractions, text, `_x` spacing and `*x` fills, General, dates and times from serials (time-zone free), elapsed time, built-in ids and locale tags. Separators, month and day names and the short date come from `Intl` for the given locale.
- 7f50ecf: New entry `javascript-excel/render`: the render model a sheet viewer draws from. `createRenderSheet(workbook, sheet, options)` returns a handle with:
  - **geometry:** row and column offsets in pixels from prefix sums, plus hit testing;
  - **cells:** the merge map, concrete `#RRGGBB` styles cached per style object, resolved border edges, display text through an optional `format` hook (`formatCell` from `/format` fits), formula-bar text and hyperlink checks;
  - **navigation:** one-cell steps and Excel's Ctrl+arrow data edges;
  - **copy:** TSV/HTML builders and a selection summary.
  
  The core entry gains `resolveColor`, which resolves theme (with tint), indexed, RGB and automatic colours to ARGB.
- f0c9cf1: `toDataset` gains `skipTotals: 'auto' | boolean`. The default `'auto'` drops a trailing row whose formulas are all `SUBTOTAL(…)`, which is the totals row `fromDataset` writes. So `toDataset(read(write(fromDataset(ds))))` no longer returns the totals as a data row. Pass `skipTotals: false` to keep it.

### Patch Changes

- f26fe0c: `read` with `maxRows` decodes shared strings lazily. They are read after the sheets, and only up to the highest index the rows read use, so previews of string-heavy files no longer parse the whole shared strings table: 412 → 166 ms on a 100,000 × 10 sheet of unique strings. Without `maxRows` nothing changes.
- 21d9d36: A full package README: install, quick starts for writing, datasets, reading, CSV, HTML tables and the worker (each type-checked in CI), what ships, runtime support and links to the new guides. `DetectedFormat` is now spelled out as a union in the published types instead of referring to an internal alias; the type is unchanged.

## 2.0.0-alpha.2

### Minor Changes

- 8e8348f: Add the dataset builders:
  - `fromDataset({ columns, data }, options)`: `key`, `path` and function accessors; header groups as merged header cells; falsy (conditional) columns skipped; per-column `type` coercion, `numFmt`, `width` (including `'auto'`), `hidden` and styles.
  - Freeze and autofilter on the header rows, and a totals row with `SUBTOTAL` formulas whose cached values are computed from the data.
  - `fromDatasets` stacks several blocks on one sheet.
  - `toDataset(sheet)` reads a sheet back into `{ columns, data }` with null-prototype rows.
- e6a4a94: Add `javascript-excel/worker`: `exposeWorker()` for the app's two-line worker file and `createWorkerClient(worker)` with `write`, `read`, `toCsv` and `parseCsv`; progress, warnings and AbortSignal work across the boundary, results are transferred, errors keep their class and code. Performance: the shared strings table is written in chunks (no long main-thread block for large tables), CRC-32 uses slicing-by-8, and `onProgress` is throttled to one event per 50 ms.

### Patch Changes

- 46ad4e1: `fromDataset` shares style objects across rows (one per column, and one per column and `rowStyle` object for banding) instead of building a new one per cell. The writer then resolves each distinct style once from its identity cache. In a local run of 1M rows × 4 styled, banded columns, building went from 2.6 s to 0.5 s and writing from 11.7 s to 7.3 s.
- 6e37bc8: `dateToSerial`, and so the writer, now accepts 1899-12-31, Excel's day 0, as serials 0 to below 1. `serialToDate` returns time-only values on that day, so a time-only cell read back by `read()` can now be written again; it used to throw `INVALID_DATE`.
- 3d1b402: The `exports` map now names the type declarations explicitly: each subpath has `import: { types: "./dist/x.d.ts", default: "./dist/x.js" }` and `require: { types: "./dist/x.d.cts", default: "./dist/x.cjs" }`. TypeScript already found the declarations next to the JavaScript files; the explicit `types` conditions don't depend on that lookup.
- 65c5275: The writer's content-keyed style cache now applies only to styles made of plain objects. A style containing an object with `toJSON` (or another non-plain object) could share a cache key with a valid style and skip validation: an invalid colour `{ toJSON: () => "FF0000" }` was written as red instead of throwing `INVALID_STYLE`. Such styles are now resolved as they are.

## 2.0.0-alpha.1

### Minor Changes

- 6a8ee72: Add `javascript-excel/csv`: `parseCsv`, `readCsv`, `toCsv` and `toCsvBlob`. RFC 4180 parsing with delimiter detection, BOM and CRLF/LF/CR handling, lenient or strict modes, optional type inference, and an async `readCsv` with encoding detection and AbortSignal support. Serialization with quoting, BOM, ISO dates and a formula-injection guard that is on by default.
- 9f81c95: Add `javascript-excel/dom`:
  - `fromTable(table, options)` turns an HTML `<table>` into a sheet. It reads the rows of `<thead>`, then `<tbody>`, then `<tfoot>`, and turns `colspan`/`rowspan` into merges (including `rowspan="0"`). It understands `data-type`, `data-value` and `data-numfmt` hints, and skips hidden and `data-export-ignore` rows and cells.
  - In a cell, `<br>` becomes a newline with wrapping, and the first link becomes the cell's hyperlink, limited to `http`, `https` and `mailto` unless `hyperlinkSchemes` allows more.
  - Optional computed-style mapping covers bold, italic, underline, strike, colour, background (including a row's background) and explicit alignment. There are also header, freeze, autofilter and auto-width options, a per-cell hook, and `onWarning` for data that cannot be coerced or for dropped links.
  - `download(data, filename)` saves bytes, a Blob or a string through a temporary `<a download>` and an object URL, with no dependencies. The module never touches globals at import.
  
  Also adds the `HYPERLINK_DROPPED` warning code and the `AutoWidthOptions` type.
- 6e84545: Add the workbook model types and typed errors to the core entry. The model types (`Workbook`, `Sheet`, `Cell`, `CellInput`, `CellValue`, `Style`, `Font`, `Fill`, `Border`, `Alignment`, `NumFmt`, `Color`, `Theme`, `SheetView`, `PrintSetup`, `ColumnProps`, `RowProps`, `DocProperties`, `DefinedName` and the rest) are type-only, so they add no runtime code. Optional properties accept an explicit `undefined`, for projects using `exactOptionalPropertyTypes`. The errors are `ExcelError`, `ValidationError`, `FormatError`, `LimitError`, `CsvError` and `EnvironmentError`, with the `ExcelErrorCode` union and `isExcelError`, which also recognises errors from another ESM/CJS copy of the package or another realm. Internally, the package now has its own zip reader and writer built on the native `CompressionStream`/`DecompressionStream('deflate-raw')`, with no runtime dependencies; the zip codec is not part of the public API.
- bf744b1: Add `javascript-excel/read`: `read`, `readSheetNames`, `detectFormat` and `DEFAULT_READ_LIMITS`. Reads .xlsx (and .xlsm, and ISO 29500 Strict) into the workbook model: values, shared/inline/rich strings, cached formula values and formula text with shared formulas expanded, styles as shared frozen objects, merges, column widths, row heights, freeze panes, views, print setup, hyperlinks, defined names, document properties and both date systems. Untrusted input is bounded by measured limits (zip sizes and ratio counted on inflated bytes, XML depth, cells, shared strings), and the streaming XML tokenizer rejects DOCTYPE. .xls, .xlsb, .ods and encrypted files are rejected with UNSUPPORTED_FORMAT.
- 54d805b: Add the xlsx writer: `toUint8Array` and `toBlob`. It writes strings (shared or inline), numbers, booleans, dates (1900 and 1904 systems), error values, rich text, formulas with cached values and styled empty cells. It also writes the full style model: fonts, pattern and gradient fills, all border styles with a colour per side, alignment, protection, and built-in and custom number formats. Styles are layered sheet → column → row → cell and deduplicated. Sheet order, names, visibility, the active sheet, the default font and document properties are written too, and the model and options are validated with typed errors. Also adds `dateToSerial`, `serialToDate`, `mergeStyles` and the A1 address helpers, and exports the shared `BinaryInput`, `BlobType`, `AbortSignalLike` and `ExcelWarning` types from the core entry.
- 8ab2b97: The xlsx writer now writes sheet features:
  - column widths (characters, pixels or the new `'auto'`), column and row styles, row heights, hidden rows and columns, outline levels;
  - merges, autofilter, freeze panes and the sheet view (right-to-left, zoom, gridlines, selection), tab colours and default sizes;
  - hyperlinks, external or internal. External URLs are limited to `http`, `https` and `mailto` unless `hyperlinkSchemes` allows more;
  - defined names, and print setup: orientation, paper size, fit to page, scale, margins, print area and titles, headers and footers.
  
  These model fields are no longer ignored, and they are validated with the new `INVALID_SHEET_PROPERTY` and `INVALID_DEFINED_NAME` codes. An invalid sheet `state` now reports `INVALID_SHEET_PROPERTY` instead of `INVALID_SHEET_NAME`. This release also adds `cellText`, `validateSheetName` and `sanitizeSheetName`.

### Patch Changes

- bc50cd3: `serialToDate` accepts serials from 0 to below 1 in the 1900 date system (Excel's day 0, used for time-only values such as 0.5 = 12:00) and returns them on 1899-12-31. It used to throw `INVALID_DATE`.
