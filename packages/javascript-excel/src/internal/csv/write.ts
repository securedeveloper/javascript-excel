/**
 * CSV serializer (docs/api.md §5.3).
 *
 * Values: numbers as `String(n)`, booleans as TRUE/FALSE, dates as ISO 8601,
 * errors as their code, rich text as plain text, empty cells as empty fields.
 * The formula-injection guard prefixes `'` to string fields starting with
 * = + - @ TAB or CR; numbers, booleans and dates are never prefixed.
 */

import { isoDate } from "../iso-date";
export { isoDate };
import { ValidationError } from "../../errors";
import type { Cell, CellInput, CellValue, Sheet } from "../../model";
import { checkSeparator } from "./parse";
import { cellRef } from "./ref";

export interface WriteConfig {
  delimiter: string;
  newline: "\r\n" | "\n";
  quoteAll: boolean;
  escapeFormulas: boolean;
  dates: "iso" | ((d: Date) => string);
  dateZone: "local" | "utc";
  formulas: "value" | "formula";
}

export function validateWriteConfig(cfg: WriteConfig): void {
  checkSeparator("delimiter", cfg.delimiter);
  if (cfg.delimiter === '"') throw new TypeError('delimiter must not be the quote character (")');
  if (cfg.newline !== "\r\n" && cfg.newline !== "\n") throw new TypeError(`newline must be "\\r\\n" or "\\n"`);
  if (cfg.dates !== "iso" && typeof cfg.dates !== "function") throw new TypeError(`dates must be 'iso' or a function`);
  if (cfg.dateZone !== "local" && cfg.dateZone !== "utc") throw new TypeError(`dateZone must be 'local' or 'utc'`);
  if (cfg.formulas !== "value" && cfg.formulas !== "formula") throw new TypeError(`formulas must be 'value' or 'formula'`);
}

/** Rows to write: a Sheet from A1 to its last used cell (rectangular), or an array as given. */
export function sourceRows(source: Sheet | CellInput[][]): { rows: ReadonlyArray<ReadonlyArray<CellInput> | undefined>; width: number } {
  if (Array.isArray(source)) return { rows: source, width: 0 };
  if (source === null || typeof source !== "object" || !Array.isArray(source.rows)) {
    throw new TypeError("toCsv: source must be a Sheet or an array of rows");
  }
  let lastRow = -1;
  let width = 0;
  source.rows.forEach((row, r) => {
    if (!row) return;
    let last = -1;
    row.forEach((cell, c) => {
      if (isUsed(cell)) last = c;
    });
    if (last >= 0) {
      lastRow = r;
      if (last + 1 > width) width = last + 1;
    }
  });
  return { rows: source.rows.slice(0, lastRow + 1), width };
}

function isUsed(cell: CellInput): boolean {
  if (cell === null || cell === undefined) return false;
  if (isCell(cell)) return (cell.value !== null && cell.value !== undefined) || (cell.formula !== undefined && cell.formula !== "");
  return true;
}

/** Serializes rows to CSV text (no BOM). */
export function serialize(source: Sheet | CellInput[][], cfg: WriteConfig): string {
  validateWriteConfig(cfg);
  const { rows, width } = sourceRows(source);
  const out: string[] = [];
  const n = rows.length;
  for (let r = 0; r < n; r++) {
    const row = rows[r];
    const cols = Math.max(width, row ? row.length : 0);
    const fields: string[] = new Array<string>(cols);
    for (let c = 0; c < cols; c++) {
      fields[c] = quoteField(fieldText(row ? row[c] : undefined, r, c, cfg), cfg);
    }
    out.push(fields.join(cfg.delimiter));
  }
  if (out.length === 0) return "";
  return out.join(cfg.newline) + cfg.newline;
}

function quoteField(s: string, cfg: WriteConfig): string {
  if (cfg.quoteAll || needsQuotes(s, cfg.delimiter)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function needsQuotes(s: string, delimiter: string): boolean {
  const d = delimiter.charCodeAt(0);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === d || c === 34 || c === 10 || c === 13) return true;
  }
  return false;
}

function fieldText(cell: CellInput, r: number, c: number, cfg: WriteConfig): string {
  if (cell === null || cell === undefined) return "";
  if (isCell(cell)) {
    if (cfg.formulas === "formula" && cell.formula !== undefined && cell.formula !== "") {
      // Formula text still passes the guard, so with escapeFormulas on it is written as text.
      return guard(cell.formula.startsWith("=") ? cell.formula : `=${cell.formula}`, cfg);
    }
    const v = cell.value;
    return v === null || v === undefined ? "" : valueText(v, r, c, cfg);
  }
  return valueText(cell, r, c, cfg);
}

function valueText(v: CellValue, r: number, c: number, cfg: WriteConfig): string {
  switch (typeof v) {
    case "string":
      return guard(v, cfg);
    case "number":
      if (!Number.isFinite(v)) {
        throw new ValidationError("INVALID_NUMBER", `Cell ${cellRef(r, c)} holds ${String(v)}, which CSV cannot represent as a number.`, {
          details: { ref: cellRef(r, c), value: String(v) },
        });
      }
      return String(v);
    case "boolean":
      return v ? "TRUE" : "FALSE";
    default:
      break;
  }
  if (v instanceof Date || Object.prototype.toString.call(v) === "[object Date]") return dateText(v as Date, r, c, cfg);
  if (typeof v === "object" && v !== null) {
    if ("error" in v && typeof v.error === "string") return v.error;
    if ("richText" in v && Array.isArray(v.richText)) return guard(v.richText.map((run) => run.text).join(""), cfg);
  }
  throw new ValidationError("INVALID_CELL", `Cell ${cellRef(r, c)} holds an unsupported value.`, { details: { ref: cellRef(r, c) } });
}

function guard(s: string, cfg: WriteConfig): string {
  if (!cfg.escapeFormulas || s.length === 0) return s;
  const c = s.charCodeAt(0);
  // = + - @ TAB CR
  if (c === 61 || c === 43 || c === 45 || c === 64 || c === 9 || c === 13) return `'${s}`;
  return s;
}

function dateText(d: Date, r: number, c: number, cfg: WriteConfig): string {
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError("INVALID_DATE", `Cell ${cellRef(r, c)} holds an invalid Date.`, { details: { ref: cellRef(r, c) } });
  }
  if (typeof cfg.dates === "function") return String(cfg.dates(d));
  return isoDate(d, cfg.dateZone);
}

function isCell(v: CellInput): v is Cell {
  if (typeof v !== "object" || v === null || v instanceof Date) return false;
  if ("error" in v || "richText" in v) return false;
  return true;
}
