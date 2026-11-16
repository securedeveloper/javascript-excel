---
"javascript-excel": minor
---

New entry `javascript-excel/import` turns a user's `.xlsx` or `.csv` file into `{ columns, data }` with `importDataset`. It handles:

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
