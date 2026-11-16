/**
 * javascript-excel/import: a user's .xlsx or .csv file -> { columns, data }
 * (docs/api.md §5.6). Header detection, type inference, locale-aware
 * parsing and column mapping, plus the `importDataset` pipeline.
 */

export { importDataset } from "./internal/import/pipeline";
export type { ImportDatasetOptions, ImportDatasetResult, ImportMeta, ImportProgress } from "./internal/import/pipeline";
export { detectHeader } from "./internal/import/header";
export type { DetectHeaderOptions, HeaderDetection, ImportLocale } from "./internal/import/header";
export { coerceColumns, inferColumnTypes } from "./internal/import/types";
export type { CoerceResult, ColumnType, DatasetLike, ImportIssue, ImportIssueCode, InferredColumn, TypeOptions } from "./internal/import/types";
export { parseDate, parseNumber } from "./internal/import/parse";
export type { DateOrder, NumberGroup } from "./internal/import/parse";
export { applyMapping, mapColumns } from "./internal/import/mapping";
export type { ColumnMapping, FieldSpec, ImportedColumn, ImportSchema, MappableDataset, MappedDataset, MappingResult } from "./internal/import/mapping";
export type { BinaryInput, BlobLike, BlobType } from "./binary";
export type { AbortSignalLike } from "./signal";
export type { ExcelWarning, ExcelWarningCode } from "./warnings";
export type { ReadLimits, SheetInfo } from "./read";
