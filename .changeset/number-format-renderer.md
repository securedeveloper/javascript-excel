---
"javascript-excel": minor
---

New entry `javascript-excel/format`: `formatValue(value, numFmt, options)` and `formatCell(cell, options)` render values the way Excel shows them in a cell. They cover number-format sections, conditions and colours, digit placeholders, grouping and scaling, percent, scientific, fractions, text, `_x` spacing and `*x` fills, General, dates and times from serials (time-zone free), elapsed time, built-in ids and locale tags. Separators, month and day names and the short date come from `Intl` for the given locale.
