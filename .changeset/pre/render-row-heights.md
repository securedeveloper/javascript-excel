---
"javascript-excel": minor
---

`javascript-excel/render`: `setRowHeights(sheet, heights)` sets measured heights for rows without a stored height (a viewer's auto-fit). It grows rows only, clamped to 409 pt, and rebuilds the offsets from the first changed row. `hasStoredRowHeight(sheet, row)` tells which rows the file sized.
