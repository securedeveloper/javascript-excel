---
"javascript-excel": minor
---

`fromDatasets` blocks take an optional `placement: 'below' | 'right'`. `'below'` (the default) is the existing behaviour. `'right'` puts a block on the previous block's top row, `gap` empty columns after its last column, with `offset.cols` and `offset.rows` adding to that. A `'below'` block after `'right'` blocks starts below the lowest of them, so blocks do not overlap. Existing calls give the same output as before.
