---
"javascript-excel": patch
---

`serialToDate` accepts serials from 0 to below 1 in the 1900 date system (Excel's day 0, used for time-only values such as 0.5 = 12:00) and returns them on 1899-12-31. It used to throw `INVALID_DATE`.
