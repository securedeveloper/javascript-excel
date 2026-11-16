---
"javascript-excel": minor
---

Add the workbook model types and typed errors to the core entry. The model types (`Workbook`, `Sheet`, `Cell`, `CellInput`, `CellValue`, `Style`, `Font`, `Fill`, `Border`, `Alignment`, `NumFmt`, `Color`, `Theme`, `SheetView`, `PrintSetup`, `ColumnProps`, `RowProps`, `DocProperties`, `DefinedName` and the rest) are type-only, so they add no runtime code. Optional properties accept an explicit `undefined`, for projects using `exactOptionalPropertyTypes`. The errors are `ExcelError`, `ValidationError`, `FormatError`, `LimitError`, `CsvError` and `EnvironmentError`, with the `ExcelErrorCode` union and `isExcelError`, which also recognises errors from another ESM/CJS copy of the package or another realm. Internally, the package now has its own zip reader and writer built on the native `CompressionStream`/`DecompressionStream('deflate-raw')`, with no runtime dependencies; the zip codec is not part of the public API.
