---
"javascript-excel": patch
---

`toDataset` with `headerRows` (and `importDataset` with a multi-row header) now carries a group title right across the empty upper-row cells that follow it when there are no merges, as in CSV: `Name,Q1,` over `,Jan,Feb` gives `Name`, `Q1 / Jan`, `Q1 / Feb` instead of `Name`, `Q1 / Jan`, `Feb`. Merged cells still decide where they are present, and a column with no text in the lower header rows is not filled.
