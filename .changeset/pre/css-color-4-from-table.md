---
"javascript-excel": patch
---

`fromTable` with `styles: 'computed'` now maps text and background colours that browsers report as `lab()`, `lch()`, `oklab()`, `oklch()` or `color()` (for example Tailwind v4 colours), converting them to sRGB. Before, only `rgb()`, hex and named colours were kept.
