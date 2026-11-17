---
"javascript-excel": patch
---

`detectHeader` (and `importDataset` with `header: 'auto'`) now recognises a two-row header without merges, as CSV files have: a second all-text row whose text cells all sit on columns of typed data joins the header (`Region,Sales,Sales` over `,Q1,Q2` gives `Sales / Q1`, `Sales / Q2`). Two text rows that only fill the table together (`Name,Q1,` over `,Jan,Feb`) are also a two-row header. When the row under the header is all text but only partly fits, it stays data and the confidence is `'low'`.
