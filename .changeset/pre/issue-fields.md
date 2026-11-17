---
"javascript-excel": minor
---

`importDataset` issues now name the field as it appears in `data` rows. With a schema, `TYPE`, `ERROR_CELL` and `DATE_ORDER_AMBIGUOUS` issues use the schema field name; they used the source column key. The new optional `column` property on `ImportIssue` holds the source column key (also set by `coerceColumns` and on `applyMapping`'s `REQUIRED`). A value that doesn't convert to a forced type in a required field gives one `TYPE` issue, no longer a `REQUIRED` issue as well. Issues on columns the mapping drops are left out.

Migration: if you grouped issues by the source column key, group by `issue.column`.
