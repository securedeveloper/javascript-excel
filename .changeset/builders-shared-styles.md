---
"javascript-excel": patch
---

`fromDataset` shares style objects across rows (one per column, and one per column and `rowStyle` object for banding) instead of building a new one per cell. The writer then resolves each distinct style once from its identity cache. In a local run of 1M rows × 4 styled, banded columns, building went from 2.6 s to 0.5 s and writing from 11.7 s to 7.3 s.
