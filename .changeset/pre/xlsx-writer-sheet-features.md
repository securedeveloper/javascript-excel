---
"javascript-excel": minor
---

The xlsx writer now writes sheet features:
- column widths (characters, pixels or the new `'auto'`), column and row styles, row heights, hidden rows and columns, outline levels;
- merges, autofilter, freeze panes and the sheet view (right-to-left, zoom, gridlines, selection), tab colours and default sizes;
- hyperlinks, external or internal. External URLs are limited to `http`, `https` and `mailto` unless `hyperlinkSchemes` allows more;
- defined names, and print setup: orientation, paper size, fit to page, scale, margins, print area and titles, headers and footers.

These model fields are no longer ignored, and they are validated with the new `INVALID_SHEET_PROPERTY` and `INVALID_DEFINED_NAME` codes. An invalid sheet `state` now reports `INVALID_SHEET_PROPERTY` instead of `INVALID_SHEET_NAME`. This release also adds `cellText`, `validateSheetName` and `sanitizeSheetName`.
