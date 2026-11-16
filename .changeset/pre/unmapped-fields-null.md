---
"javascript-excel": minor
---

`importDataset` and `applyMapping`: a schema field without a column is now `null` in every row, and `columns` lists every schema field. An unmapped field's column has an empty title and letter, `type: 'empty'`, and its `field`. Rows always have the schema's shape, so validators such as Zod's `.nullable()` accept them; before this change the key was missing. A required field without a column still gives one `MAPPING_MISSING` issue, and is `null` in the rows.
