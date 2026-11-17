---
"javascript-excel": patch
---

Built-in number formats 37–40 and 47 now use the codes Excel itself shows, checked in Excel for Mac: `#,##0_);(#,##0)`, `#,##0_);[Red](#,##0)`, `#,##0.00_);(#,##0.00)`, `#,##0.00_);[Red](#,##0.00)` and `mm:ss.0`. The ECMA-376 table lists other codes. This changes `BUILTIN_NUM_FMTS` and what `formatValue`/`formatCell` show for those ids: positive numbers keep a trailing space where the `)` would be (`1,234.50 `), and 47 shows `31:00.0` instead of `3100.0`. Files are unaffected, because the writer writes only the id.
