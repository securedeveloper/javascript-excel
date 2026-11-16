---
"javascript-excel": minor
---

Add `javascript-excel/read`: `read`, `readSheetNames`, `detectFormat` and `DEFAULT_READ_LIMITS`. Reads .xlsx (and .xlsm, and ISO 29500 Strict) into the workbook model: values, shared/inline/rich strings, cached formula values and formula text with shared formulas expanded, styles as shared frozen objects, merges, column widths, row heights, freeze panes, views, print setup, hyperlinks, defined names, document properties and both date systems. Untrusted input is bounded by measured limits (zip sizes and ratio counted on inflated bytes, XML depth, cells, shared strings), and the streaming XML tokenizer rejects DOCTYPE. .xls, .xlsb, .ods and encrypted files are rejected with UNSUPPORTED_FORMAT.
