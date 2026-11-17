---
"javascript-excel": patch
---

Sheet names are limited to 31 code points, as in Excel, instead of 31 UTF-16 units. `validateSheetName`, the writer and `sanitizeSheetName` now accept a name such as 30 letters plus an emoji (Excel for Mac accepts it), and `sanitizeSheetName` cuts long names to 31 code points without splitting a surrogate pair. `History` stays reserved in any case (Excel refuses it), and `sanitizeSheetName` turns it into `Sheet`.
