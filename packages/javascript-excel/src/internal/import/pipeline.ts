/**
 * importDataset: a user's .xlsx or .csv file -> { columns, data }
 * (docs/api.md §5.6). Each step is a public function or an existing API.
 */

import type { BinaryInput } from "../../binary";
import { readCsv } from "../../csv";
import { toDatasetDetailed, type DetailedDataset } from "../../dataset";
import { FormatError, LimitError, ValidationError } from "../../errors";
import type { CellInput, Sheet } from "../../model";
import { detectFormat, read, readSheetNames, type ReadLimits, type SheetInfo } from "../../read";
import type { AbortSignalLike } from "../../signal";
import type { ExcelWarning } from "../../warnings";
import { toBytes } from "../input";
import { DEFAULT_MAX_SCAN, detectHeader, type ImportLocale } from "./header";
import { applyMapping, mapColumns, type ColumnMapping, type ImportedColumn, type ImportSchema } from "./mapping";
import { coerceColumns, inferDetailed, type ColumnType, type ImportIssue, type InferredColumn } from "./types";

export interface ImportProgress {
  phase: "unzip" | "parse" | "dataset";
  ratio: number;
}

export interface ImportDatasetOptions {
  format?: "auto" | "xlsx" | "csv" | undefined;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  sheet?: number | string | "first-visible" | undefined;
  header?: "auto" | number | { row?: number | undefined; rows: number; join?: string | undefined } | false | undefined;
  range?: string | undefined;
  types?: "infer" | "none" | Record<string, ColumnType> | undefined;
  locale?: ImportLocale | undefined;
  delimiter?: string | undefined;
  encoding?: string | undefined;
  skipTotals?: "auto" | boolean | undefined;
  errorCells?: "null" | "keep" | undefined;
  dates?: "date" | "serial" | undefined;
  dateZone?: "local" | "utc" | undefined;
  schema?: ImportSchema | undefined;
  mapping?: ColumnMapping | undefined;
  maxRows?: number | undefined;
  preview?: number | undefined;
  limits?: Partial<ReadLimits> | undefined;
  signal?: AbortSignalLike | undefined;
  onProgress?: ((p: ImportProgress) => void) | undefined;
  onWarning?: ((w: ExcelWarning) => void) | undefined;
}

export interface ImportMeta {
  format: "xlsx" | "xlsm" | "xltx" | "xltm" | "csv";
  fileName?: string | undefined;
  sheet?: { name: string; index: number } | undefined;
  sheets?: SheetInfo[] | undefined;
  header: { rows: number[]; detected: boolean; confidence?: "high" | "low" | undefined };
  range: string;
  delimiter?: string | undefined;
  encoding?: string | undefined;
  bom?: boolean | undefined;
  totalsRowSkipped: boolean;
  truncated: boolean;
  mapping?: ColumnMapping | undefined;
  unmappedColumns?: string[] | undefined;
}

export interface ImportDatasetResult {
  columns: ImportedColumn[];
  data: Array<Record<string, unknown>>;
  rowNumbers: number[];
  issues: ImportIssue[];
  warnings: ExcelWarning[];
  meta: ImportMeta;
}

const CSV_NAME = /\.(csv|tsv|txt)$/i;
const CSV_MIME = new Set(["text/csv", "text/plain", "text/tab-separated-values"]);

function checkEnum(name: string, v: unknown, allowed: readonly string[]): void {
  if (v !== undefined && !allowed.includes(v as string)) throw new TypeError(`${name} must be one of ${allowed.map((a) => `'${a}'`).join(", ")}, got ${JSON.stringify(v)}`);
}

function checkCount(name: string, v: unknown, min: number): void {
  if (v !== undefined && (!Number.isInteger(v) || (v as number) < min)) throw new TypeError(`${name} must be an integer of at least ${min}, got ${String(v)}`);
}

function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

function bomEncoding(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return undefined;
}

function isError(v: unknown): v is { error: string } {
  return typeof v === "object" && v !== null && !(v instanceof Date) && "error" in v;
}

/** Rows to read before stopping: the header area plus the rows asked for, plus one to see whether more exist. */
function readCap(options: ImportDatasetOptions): number | undefined {
  const rows = options.preview ?? options.maxRows;
  if (rows === undefined) return undefined;
  const h = options.header ?? "auto";
  const headerArea = h === false ? 0 : typeof h === "number" ? h + 1 : typeof h === "object" ? (h.row === undefined ? DEFAULT_MAX_SCAN : h.row) + h.rows : DEFAULT_MAX_SCAN;
  return headerArea + rows + 1;
}

export async function importDataset(input: string | BinaryInput, options: ImportDatasetOptions = {}): Promise<ImportDatasetResult> {
  const o = options;
  checkEnum("format", o.format, ["auto", "xlsx", "csv"]);
  checkEnum("types", typeof o.types === "string" ? o.types : undefined, ["infer", "none"]);
  checkEnum("errorCells", o.errorCells, ["null", "keep"]);
  checkEnum("dates", o.dates, ["date", "serial"]);
  checkEnum("dateZone", o.dateZone, ["local", "utc"]);
  checkEnum("locale.dateOrder", o.locale?.dateOrder, ["auto", "YMD", "DMY", "MDY"]);
  checkCount("maxRows", o.maxRows, 0);
  checkCount("preview", o.preview, 0);
  if (typeof o.header === "object" && o.header !== null) {
    checkCount("header.rows", o.header.rows, 1);
    checkCount("header.row", o.header.row, 0);
  } else if (o.header !== undefined && o.header !== "auto" && o.header !== false) checkCount("header", o.header, 0);
  if (o.sheet !== undefined && typeof o.sheet !== "string" && !(Number.isInteger(o.sheet) && o.sheet >= 0)) throw new TypeError("sheet must be a name, a non-negative index or 'first-visible'");
  if (o.mapping !== undefined && !o.schema) throw new TypeError("mapping needs a schema");

  const warnings: ExcelWarning[] = [];
  const warn = (w: ExcelWarning): void => {
    warnings.push(w);
    o.onWarning?.(w);
  };
  const progress = (phase: ImportProgress["phase"], ratio: number): void => o.onProgress?.({ phase, ratio });
  const zone = o.dateZone ?? "local";
  const locale = o.locale ?? {};
  throwIfAborted(o.signal);

  // 1. Format.
  const named = typeof input === "object" && input !== null ? (input as { name?: unknown; type?: unknown }) : {};
  const fileName = o.fileName ?? (typeof named.name === "string" ? named.name : undefined);
  const mimeType = (o.mimeType ?? (typeof named.type === "string" ? named.type : "")).split(";")[0]!.trim().toLowerCase();
  const csvHint = (fileName !== undefined && CSV_NAME.test(fileName)) || CSV_MIME.has(mimeType);
  let bytes: Uint8Array | undefined;
  let format: ImportMeta["format"];
  if (typeof input === "string") format = "csv";
  else {
    bytes = await toBytes(input, "importDataset", "a string, ");
    if (o.format === "csv") format = "csv";
    else if (o.format === "xlsx") format = "xlsx";
    else {
      const detected = await detectFormat(bytes);
      if (detected === "unknown") {
        if (!csvHint) {
          throw new FormatError("UNSUPPORTED_FORMAT", "The file is neither a zip-based workbook nor named or typed as CSV.", { details: { format: "unknown" } });
        }
        format = "csv";
      } else format = detected === "xlsm" || detected === "xltx" || detected === "xltm" ? detected : "xlsx";
    }
  }
  throwIfAborted(o.signal);

  // 2–3. Read the one sheet.
  const cap = readCap(o);
  let sheet: Sheet<CellInput>;
  let truncatedRead = false;
  const meta: Partial<ImportMeta> = { format, ...(fileName !== undefined ? { fileName } : {}) };
  if (format === "csv") {
    const r = await readCsv(typeof input === "string" ? input : bytes!, {
      delimiter: o.delimiter ?? "auto",
      encoding: o.encoding,
      maxRows: cap,
      signal: o.signal,
      inferTypes: false,
    });
    for (const w of r.warnings) {
      if (w.code === "CSV_ROWS_TRUNCATED") truncatedRead = true;
      warn(w);
    }
    sheet = { name: "CSV", rows: r.rows };
    meta.delimiter = r.delimiter;
    meta.bom = r.bom;
    if (bytes) meta.encoding = bomEncoding(bytes) ?? (o.encoding ?? "utf-8").toLowerCase();
  } else {
    const sheets = await readSheetNames(bytes!, { limits: o.limits, signal: o.signal });
    const want = o.sheet ?? "first-visible";
    const info =
      want === "first-visible" ? sheets.find((s) => s.state === "visible") : typeof want === "number" ? sheets[want] : sheets.find((s) => s.name === want);
    if (!info) {
      throw new ValidationError("SHEET_NOT_FOUND", want === "first-visible" ? "The workbook has no visible sheet." : `No sheet ${JSON.stringify(want)} in the workbook.`, {
        details: { sheet: want, sheets: sheets.map((s) => s.name) },
      });
    }
    const { workbook } = await read(bytes!, {
      sheets: [info.index],
      styles: false,
      richText: "plain",
      formulas: true,
      dates: o.dates ?? "date",
      dateZone: zone,
      limits: o.limits,
      signal: o.signal,
      maxRows: cap,
      onProgress: (p) => progress(p.phase === "unzip" ? "unzip" : "parse", p.ratio * 0.9),
      onWarning: (w) => {
        if (w.code === "ROWS_TRUNCATED") truncatedRead = true;
        warn(w);
      },
    });
    sheet = workbook.sheets[info.index] as Sheet<CellInput>;
    meta.sheet = { name: info.name, index: info.index };
    meta.sheets = sheets;
  }
  throwIfAborted(o.signal);
  progress("dataset", 0.9);

  // 4. Header and dataset.
  const header = o.header ?? "auto";
  let headerRows: number[];
  let detected = false;
  let confidence: "high" | "low" | undefined;
  let join: string | undefined;
  if (header === "auto") {
    const d = detectHeader(sheet, { range: o.range, locale });
    headerRows = d.rows;
    detected = true;
    confidence = d.confidence;
  } else if (header === false) headerRows = [];
  else if (typeof header === "number") headerRows = [header];
  else {
    let start = header.row;
    if (start === undefined) {
      const d = detectHeader(sheet, { range: o.range, locale });
      start = d.rows[0]!;
      detected = true;
      confidence = d.confidence;
    }
    headerRows = Array.from({ length: header.rows }, (_, i) => start! + i);
    join = header.join;
  }
  const ds: DetailedDataset = toDatasetDetailed(sheet, {
    headerRow: headerRows.length ? headerRows[0]! : false,
    headerRows: Math.max(1, headerRows.length),
    join,
    range: o.range,
    skipTotals: o.skipTotals ?? "auto",
  });
  const issues: ImportIssue[] = [];
  const base = { header: { rows: headerRows, detected, ...(confidence ? { confidence } : {}) }, range: ds.range ?? "", totalsRowSkipped: ds.totalsSkipped };

  if (ds.range === undefined || ds.columns.length === 0) {
    issues.push({ row: 0, code: "EMPTY", message: "The file has no data.", severity: "warning" });
    progress("dataset", 1);
    return { columns: [], data: [], rowNumbers: [], issues, warnings, meta: { ...(meta as ImportMeta), ...base, truncated: false } };
  }

  let data = ds.data;
  let rowNumbers = ds.rowNumbers;
  let truncated = false;
  if (o.preview !== undefined) {
    if (data.length > o.preview || truncatedRead) truncated = true;
    data = data.slice(0, o.preview);
    rowNumbers = rowNumbers.slice(0, o.preview);
  } else if (o.maxRows !== undefined && (data.length > o.maxRows || truncatedRead)) {
    throw new LimitError("LIMIT_EXCEEDED", `The file has more than maxRows (${o.maxRows}) data rows.`, {
      details: { limit: "maxRows", value: data.length, max: o.maxRows },
    });
  }
  if (data.length === 0) issues.push({ row: 0, code: "EMPTY", message: "The file has a header but no data rows.", severity: "warning" });

  // Error cells.
  if ((o.errorCells ?? "null") === "null") {
    for (let i = 0; i < data.length; i++) {
      const row = data[i]!;
      for (const c of ds.columns) {
        const v = row[c.key];
        if (!isError(v)) continue;
        row[c.key] = null;
        const ref = `${c.letter}${rowNumbers[i]}`;
        issues.push({ row: rowNumbers[i]!, field: c.key, ref, code: "ERROR_CELL", message: `${ref} holds the error ${v.error}; read as empty.`, severity: "warning" });
      }
    }
  }
  throwIfAborted(o.signal);

  // 5. Types (forced by `types` or by schema fields; inferred otherwise).
  const keyOf = (name: string): string => {
    const byKey = ds.columns.find((c) => c.key === name);
    if (byKey) return byKey.key;
    const byTitle = ds.columns.find((c) => c.title === name);
    if (byTitle) return byTitle.key;
    throw new TypeError(`types: no column with key or title ${JSON.stringify(name)}`);
  };
  const forced = new Map<string, ColumnType>();
  if (typeof o.types === "object" && o.types !== null) for (const name of Object.keys(o.types)) forced.set(keyOf(name), o.types[name]!);
  const mapped = o.schema && o.preview === undefined ? mapColumns(ds.columns, o.schema, o.mapping) : undefined;
  if (mapped) {
    for (const [field, spec] of Object.entries(o.schema!.fields)) {
      const col = mapped.mapping[field];
      if (spec.type && col) forced.set(col, spec.type);
    }
  }
  const mode = typeof o.types === "string" ? o.types : "infer";
  const dsLike = { columns: ds.columns, data, rowNumbers };
  const inferred = inferDetailed(dsLike, { locale, dateZone: zone, convertText: mode === "infer" });
  const plan: Record<string, ColumnType | InferredColumn> = Object.create(null) as Record<string, ColumnType | InferredColumn>;
  const typeOf = new Map<string, ColumnType>();
  for (const inf of inferred) {
    const f = forced.get(inf.key);
    if (f) {
      plan[inf.key] = inf.dateOrder ? { key: inf.key, type: f, dateOrder: inf.dateOrder } : f;
      typeOf.set(inf.key, f);
    } else {
      if (mode === "infer") plan[inf.key] = inf;
      typeOf.set(inf.key, inf.type);
      if (inf.ambiguousDates) {
        issues.push({ row: 0, field: inf.key, code: "DATE_ORDER_AMBIGUOUS", message: `Column "${inf.key}" looks like dates, but the day/month order can't be told from the data; set locale.dateOrder.`, severity: "warning" });
      }
    }
  }
  const coerced = coerceColumns(dsLike, plan, { locale, dateZone: zone });
  issues.push(...coerced.issues);
  const typedColumns = ds.columns.map((c) => ({ key: c.key, title: c.title, letter: c.letter, type: typeOf.get(c.key) ?? "mixed" }));
  progress("dataset", 0.97);

  // 6. Mapping.
  let result: { columns: ImportedColumn[]; data: Array<Record<string, unknown>>; rowNumbers: number[] };
  if (mapped) {
    const m = applyMapping({ columns: typedColumns, data: coerced.data, rowNumbers }, mapped.mapping, o.schema!);
    issues.push(...m.issues);
    result = m;
    meta.mapping = mapped.mapping;
    meta.unmappedColumns = mapped.unmapped;
  } else result = { columns: typedColumns, data: coerced.data, rowNumbers };
  progress("dataset", 1);
  return { ...result, issues, warnings, meta: { ...(meta as ImportMeta), ...base, truncated } };
}
