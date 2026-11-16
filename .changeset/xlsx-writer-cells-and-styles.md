---
"javascript-excel": minor
---

Add the xlsx writer: `toUint8Array` and `toBlob`. It writes strings (shared or inline), numbers, booleans, dates (1900 and 1904 systems), error values, rich text, formulas with cached values and styled empty cells. It also writes the full style model: fonts, pattern and gradient fills, all border styles with a colour per side, alignment, protection, and built-in and custom number formats. Styles are layered sheet → column → row → cell and deduplicated. Sheet order, names, visibility, the active sheet, the default font and document properties are written too, and the model and options are validated with typed errors. Also adds `dateToSerial`, `serialToDate`, `mergeStyles` and the A1 address helpers, and exports the shared `BinaryInput`, `BlobType`, `AbortSignalLike` and `ExcelWarning` types from the core entry.
