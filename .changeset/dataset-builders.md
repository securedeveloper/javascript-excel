---
"javascript-excel": minor
---

Add the dataset builders:
- `fromDataset({ columns, data }, options)`: `key`, `path` and function accessors; header groups as merged header cells; falsy (conditional) columns skipped; per-column `type` coercion, `numFmt`, `width` (including `'auto'`), `hidden` and styles.
- Freeze and autofilter on the header rows, and a totals row with `SUBTOTAL` formulas whose cached values are computed from the data.
- `fromDatasets` stacks several blocks on one sheet.
- `toDataset(sheet)` reads a sheet back into `{ columns, data }` with null-prototype rows.
