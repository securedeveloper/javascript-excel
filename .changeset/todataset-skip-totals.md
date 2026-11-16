---
"javascript-excel": minor
---

`toDataset` gains `skipTotals: 'auto' | boolean`. The default `'auto'` drops a trailing row whose formulas are all `SUBTOTAL(…)`, which is the totals row `fromDataset` writes. So `toDataset(read(write(fromDataset(ds))))` no longer returns the totals as a data row. Pass `skipTotals: false` to keep it.
