---
"javascript-excel": patch
---

`dateToSerial`, and so the writer, now accepts 1899-12-31, Excel's day 0, as serials 0 to below 1. `serialToDate` returns time-only values on that day, so a time-only cell read back by `read()` can now be written again; it used to throw `INVALID_DATE`.
