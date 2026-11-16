/**
 * Column type inference and coercion for javascript-excel/import
 * (docs/api.md §5.6, "Type rules"). All-or-nothing per column.
 */

import { isoDate } from "../iso-date";
import type { ImportLocale } from "./header";
import { dateFromParts, dateParts, parseBoolean, parseDate, parseNumber, type DateOrder } from "./parse";
import { parseIsoDate } from "../csv/infer";

export type ColumnType = "string" | "number" | "boolean" | "date" | "datetime" | "mixed" | "empty";

export interface DatasetLike {
  columns: ReadonlyArray<{ key: string; title: string; letter?: string | undefined }>;
  data: ReadonlyArray<Record<string, unknown>>;
  /** Spreadsheet row of each data entry, for issues. Default: index + 2 (one header row). */
  rowNumbers?: readonly number[] | undefined;
}

export interface TypeOptions {
  locale?: ImportLocale | undefined;
  dateZone?: "local" | "utc" | undefined;
}

interface DetailedTypeOptions extends TypeOptions {
  /** false: text is never converted, so text columns are 'string' ('none' mode). Default true. */
  convertText?: boolean | undefined;
}

export interface InferredColumn {
  key: string;
  type: ColumnType;
  /** For date columns read from numeric text: the order the values are in. */
  dateOrder?: DateOrder | undefined;
}

export type ImportIssueCode = "TYPE" | "REQUIRED" | "MAPPING_MISSING" | "ERROR_CELL" | "EMPTY" | "DATE_ORDER_AMBIGUOUS";

export interface ImportIssue {
  /** Spreadsheet row (1-based); 0 for column- or file-level issues. */
  row: number;
  field?: string | undefined;
  ref?: string | undefined;
  code: ImportIssueCode;
  message: string;
  severity: "error" | "warning";
}

export interface CoerceResult {
  data: Array<Record<string, unknown>>;
  issues: ImportIssue[];
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function hasTime(d: Date, zone: "local" | "utc"): boolean {
  return zone === "utc"
    ? d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0
    : d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0 || d.getMilliseconds() !== 0;
}

function textOf(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "richText" in v) return (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("");
  return undefined;
}

function numberOptions(locale: ImportLocale): { decimal: "." | ","; group: NonNullable<ImportLocale["group"]> } {
  return { decimal: locale.decimal ?? ".", group: locale.group ?? "" };
}

/**
 * The date order of a column of numeric date texts, decided from the data
 * only: undefined when nothing proves an order, or the evidence conflicts.
 */
function dateOrderOf(texts: string[], requested: ImportLocale["dateOrder"]): { order?: DateOrder; ambiguous: boolean } {
  if (requested && requested !== "auto") return { order: requested, ambiguous: false };
  let ymd = 0, dmy = 0, mdy = 0, any = 0;
  for (const t of texts) {
    const p = dateParts(t);
    if (!p) continue;
    any++;
    if (p.aLen === 4) ymd++;
    else if (p.a > 12) dmy++;
    else if (p.b > 12) mdy++;
  }
  if (any === 0) return { ambiguous: false };
  if (ymd === any) return { order: "YMD", ambiguous: false };
  if (ymd > 0) return { ambiguous: true };
  if (dmy > 0 && mdy === 0) return { order: "DMY", ambiguous: false };
  if (mdy > 0 && dmy === 0) return { order: "MDY", ambiguous: false };
  return { ambiguous: true };
}

function textToDate(t: string, order: DateOrder | undefined, zone: "local" | "utc"): Date | undefined {
  const s = t.trim();
  if (s.length >= 10 && s.charCodeAt(4) === 45) {
    const iso = parseIsoDate(s, zone);
    if (iso) return iso;
  }
  if (!order) return undefined;
  const p = dateParts(s);
  return p ? dateFromParts(p, order, zone) : undefined;
}

interface Inference extends InferredColumn {
  ambiguousDates: boolean;
}

function inferOne(key: string, values: unknown[], locale: ImportLocale, zone: "local" | "utc", convertText: boolean): Inference {
  const present = values.filter((v) => !isEmpty(v) && !(v && typeof v === "object" && "error" in v));
  if (present.length === 0) return { key, type: "empty", ambiguousDates: false };
  const texts: string[] = [];
  let nums = 0, bools = 0, dates = 0, others = 0, timed = false;
  for (const v of present) {
    const t = textOf(v);
    if (t !== undefined) texts.push(t);
    else if (typeof v === "number") nums++;
    else if (typeof v === "boolean") bools++;
    else if (v instanceof Date) {
      dates++;
      if (hasTime(v, zone)) timed = true;
    } else others++;
  }
  if (others > 0) return { key, type: "mixed", ambiguousDates: false };
  const typedKinds = (nums ? 1 : 0) + (bools ? 1 : 0) + (dates ? 1 : 0);
  if (typedKinds > 1) return { key, type: "mixed", ambiguousDates: false };
  const no = numberOptions(locale);
  // Which types can every text value take?
  const textNumbers = texts.length > 0 && texts.every((t) => parseNumber(t, no) !== undefined);
  const textBools = texts.length > 0 && texts.every((t) => parseBoolean(t) !== undefined);
  const { order, ambiguous } = dateOrderOf(texts, locale.dateOrder);
  let textDates = false;
  let textTimed = false;
  if (texts.length > 0 && !textNumbers) {
    textDates = texts.every((t) => {
      const d = textToDate(t, order, zone);
      if (d && hasTime(d, zone)) textTimed = true;
      return d !== undefined;
    });
  }
  const dateType = (): ColumnType => (timed || textTimed ? "datetime" : "date");
  if (texts.length === 0) {
    return { key, type: nums ? "number" : bools ? "boolean" : dateType(), ambiguousDates: false };
  }
  if (!convertText) return { key, type: typedKinds === 0 ? "string" : "mixed", ambiguousDates: false };
  if ((nums || typedKinds === 0) && textNumbers && !bools && !dates) return { key, type: "number", ambiguousDates: false };
  if ((bools || typedKinds === 0) && textBools && !nums && !dates) return { key, type: "boolean", ambiguousDates: false };
  if ((dates || typedKinds === 0) && textDates && !nums && !bools) return { key, type: dateType(), dateOrder: order, ambiguousDates: false };
  if (typedKinds === 0) {
    // All text: it stays text. Flag a column that would have been dates with a known order.
    const looksLikeDates = ambiguous && texts.every((t) => dateParts(t) !== undefined || (t.trim().length >= 10 && parseIsoDate(t.trim(), zone)));
    return { key, type: "string", ambiguousDates: looksLikeDates };
  }
  return { key, type: "mixed", ambiguousDates: false };
}

export function inferColumnTypes(dataset: DatasetLike, options: TypeOptions = {}): InferredColumn[] {
  return inferDetailed(dataset, options).map(({ key, type, dateOrder }) => (dateOrder ? { key, type, dateOrder } : { key, type }));
}

/** @internal inferColumnTypes plus the ambiguity flag the pipeline reports. */
export function inferDetailed(dataset: DatasetLike, options: DetailedTypeOptions = {}): Inference[] {
  const locale = options.locale ?? {};
  const zone = options.dateZone ?? "local";
  const convertText = options.convertText ?? true;
  return dataset.columns.map(({ key }) => inferOne(key, dataset.data.map((row) => row[key]), locale, zone, convertText));
}

/** Converts one value to `type`; undefined when it can't be. */
function convert(v: unknown, col: InferredColumn, locale: ImportLocale, zone: "local" | "utc"): { ok: true; value: unknown } | { ok: false } {
  if (isEmpty(v)) return { ok: true, value: null };
  // Error cells kept with errorCells: 'keep' pass through whatever the column's type.
  if (col.type !== "string" && typeof v === "object" && v !== null && !(v instanceof Date) && "error" in v) return { ok: true, value: v };
  const t = textOf(v);
  switch (col.type) {
    case "string":
      if (t !== undefined) return { ok: true, value: t };
      if (v instanceof Date) return { ok: true, value: isoDate(v, zone) };
      if (typeof v === "object" && v && "error" in v) return { ok: true, value: (v as { error: string }).error };
      return { ok: true, value: String(v) };
    case "number": {
      if (typeof v === "number") return { ok: true, value: v };
      const n = t === undefined ? undefined : parseNumber(t, numberOptions(locale));
      return n === undefined ? { ok: false } : { ok: true, value: n };
    }
    case "boolean": {
      if (typeof v === "boolean") return { ok: true, value: v };
      const b = t === undefined ? undefined : parseBoolean(t);
      return b === undefined ? { ok: false } : { ok: true, value: b };
    }
    case "date":
    case "datetime": {
      if (v instanceof Date) return { ok: true, value: v };
      const order = col.dateOrder ?? (locale.dateOrder && locale.dateOrder !== "auto" ? locale.dateOrder : undefined);
      const d = t === undefined ? undefined : order ? textToDate(t, order, zone) : parseDate(t, { zone });
      return d === undefined ? { ok: false } : { ok: true, value: d };
    }
    default:
      return { ok: true, value: v };
  }
}

export function coerceColumns(dataset: DatasetLike, types: Record<string, ColumnType | InferredColumn>, options: TypeOptions = {}): CoerceResult {
  const locale = options.locale ?? {};
  const zone = options.dateZone ?? "local";
  const issues: ImportIssue[] = [];
  const plan = dataset.columns
    .map((c) => {
      const t = Object.hasOwn(types, c.key) ? types[c.key] : undefined;
      if (t === undefined) return undefined;
      return { column: c, spec: typeof t === "string" ? { key: c.key, type: t } : t };
    })
    .filter((x): x is { column: DatasetLike["columns"][number]; spec: InferredColumn } => x !== undefined);
  const data = dataset.data.map((row, i) => {
    const out = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(row)) out[k] = row[k];
    for (const { column, spec } of plan) {
      const r = convert(row[column.key], spec, locale, zone);
      if (r.ok) out[column.key] = r.value;
      else {
        const rowNumber = dataset.rowNumbers?.[i] ?? i + 2;
        out[column.key] = null;
        issues.push({
          row: rowNumber,
          field: column.key,
          ...(column.letter ? { ref: `${column.letter}${rowNumber}` } : {}),
          code: "TYPE",
          message: `${column.letter ? `${column.letter}${rowNumber}` : `Row ${rowNumber}`}: ${JSON.stringify(String(textOf(row[column.key]) ?? row[column.key]))} is not a ${spec.type}.`,
          severity: "error",
        });
      }
    }
    return out;
  });
  return { data, issues };
}
