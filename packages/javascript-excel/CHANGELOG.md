# javascript-excel

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
