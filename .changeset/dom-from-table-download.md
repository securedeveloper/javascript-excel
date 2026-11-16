---
"javascript-excel": minor
---

Add `javascript-excel/dom`:
- `fromTable(table, options)` turns an HTML `<table>` into a sheet. It reads the rows of `<thead>`, then `<tbody>`, then `<tfoot>`, and turns `colspan`/`rowspan` into merges (including `rowspan="0"`). It understands `data-type`, `data-value` and `data-numfmt` hints, and skips hidden and `data-export-ignore` rows and cells.
- In a cell, `<br>` becomes a newline with wrapping, and the first link becomes the cell's hyperlink, limited to `http`, `https` and `mailto` unless `hyperlinkSchemes` allows more.
- Optional computed-style mapping covers bold, italic, underline, strike, colour, background (including a row's background) and explicit alignment. There are also header, freeze, autofilter and auto-width options, a per-cell hook, and `onWarning` for data that cannot be coerced or for dropped links.
- `download(data, filename)` saves bytes, a Blob or a string through a temporary `<a download>` and an object URL, with no dependencies. The module never touches globals at import.

Also adds the `HYPERLINK_DROPPED` warning code and the `AutoWidthOptions` type.
