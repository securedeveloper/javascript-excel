---
"javascript-excel": patch
---

`read` with `maxRows` decodes shared strings lazily. They are read after the sheets, and only up to the highest index the rows read use, so previews of string-heavy files no longer parse the whole shared strings table: 412 → 166 ms on a 100,000 × 10 sheet of unique strings. Without `maxRows` nothing changes.
