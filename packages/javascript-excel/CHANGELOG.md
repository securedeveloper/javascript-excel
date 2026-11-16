# javascript-excel

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
