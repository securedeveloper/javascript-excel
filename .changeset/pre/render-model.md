---
"javascript-excel": minor
---

New entry `javascript-excel/render`: the render model a sheet viewer draws from. `createRenderSheet(workbook, sheet, options)` returns a handle with:
- **geometry:** row and column offsets in pixels from prefix sums, plus hit testing;
- **cells:** the merge map, concrete `#RRGGBB` styles cached per style object, resolved border edges, display text through an optional `format` hook (`formatCell` from `/format` fits), formula-bar text and hyperlink checks;
- **navigation:** one-cell steps and Excel's Ctrl+arrow data edges;
- **copy:** TSV/HTML builders and a selection summary.

The core entry gains `resolveColor`, which resolves theme (with tint), indexed, RGB and automatic colours to ARGB.
