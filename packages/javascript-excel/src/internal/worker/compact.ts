/**
 * Compact transfer encoding for workbooks sent to the worker (JSE-15). Internal.
 *
 * Structured clone copies every cell as its own object graph, on the calling
 * thread. With a `{ value, style }` object and a fresh style literal per
 * cell, that was the main-thread cost of the worker path (about 1.5–1.9 s for
 * 600k cells in Node). This encoding turns each sheet's cells into a few typed
 * arrays (transferred, not copied), plus a string list, a style table
 * deduplicated by identity and content, and a list of the cells it does not
 * encode (formulas, hyperlinks, rich text, errors, ...), which still go
 * through structured clone.
 *
 * decode(encode(x)) deep-equals x for every CellInput. Shared style objects
 * stay shared; equal style literals become one shared object, which the writer
 * treats the same.
 */

import type { CellInput, Sheet, Style, Workbook } from "../../model";

const HOLE = 0;
const NUMBER = 1;
const STRING = 2;
const BOOLEAN = 3;
const OTHER = 4;
const NULL = 5;
const DATE = 6;
const UNDEFINED = 7;

/** Row markers in `rowLen`: a hole, an empty row, or a row of n cells (n + 2). */
const ROW_HOLE = 0;
const ROW_EMPTY = 1;

export interface CompactSheet {
  rowLen: Uint32Array;
  type: Uint8Array;
  num: Float64Array;
  style: Uint32Array;
  strings: string[];
  other: unknown[];
}

export interface CompactWorkbook {
  compact: 1;
  /** The workbook with every sheet's `rows` removed. */
  header: Workbook;
  sheets: CompactSheet[];
  styles: Style[];
}

function isValueCell(v: object): v is { value?: unknown; style?: Style } {
  for (const k in v) {
    if (k !== "value" && k !== "style") return false;
  }
  return Object.getPrototypeOf(v) === Object.prototype;
}

/** Encodes a workbook; returns it with the buffers to transfer. */
export function encodeWorkbook(wb: Workbook): { message: CompactWorkbook; transfer: ArrayBuffer[] } {
  const styles: Style[] = [];
  const byObject = new Map<object, number>();
  const byContent = new Map<string, number>();
  const styleIndex = (s: Style): number => {
    let i = byObject.get(s);
    if (i !== undefined) return i;
    const plain = Object.getPrototypeOf(s) === Object.prototype;
    const key = plain ? safeKey(s) : undefined;
    if (key !== undefined) i = byContent.get(key);
    if (i === undefined) {
      i = styles.push(s) - 1;
      if (key !== undefined) byContent.set(key, i);
    }
    byObject.set(s, i);
    return i;
  };

  const transfer: ArrayBuffer[] = [];
  const sheets = wb.sheets.map((sheet) => {
    const rows = sheet.rows as ReadonlyArray<ReadonlyArray<CellInput> | undefined>;
    let count = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (row) count += row.length;
    }
    const rowLen = new Uint32Array(rows.length);
    const type = new Uint8Array(count);
    const num = new Float64Array(count);
    const style = new Uint32Array(count);
    const strings: string[] = [];
    const other: unknown[] = [];
    let k = 0;
    for (let r = 0; r < rows.length; r++) {
      if (!(r in rows)) continue; // ROW_HOLE
      const row = rows[r];
      if (row === undefined) {
        rowLen[r] = ROW_HOLE;
        continue;
      }
      if (!Array.isArray(row)) {
        // Not a row array: leave the whole sheet to structured clone.
        return { fallback: sheet };
      }
      rowLen[r] = row.length + ROW_EMPTY;
      for (let c = 0; c < row.length; c++, k++) {
        if (!(c in row)) continue; // HOLE (sparse)
        let v: unknown = row[c];
        if (v !== null && typeof v === "object" && !(v instanceof Date) && isValueCell(v)) {
          const s = (v as { style?: Style }).style;
          if (s !== undefined) {
            if (typeof s !== "object" || s === null) {
              type[k] = OTHER;
              num[k] = other.push(v) - 1;
              continue;
            }
            style[k] = styleIndex(s) + 1;
          }
          if (!("value" in v)) {
            type[k] = UNDEFINED; // { style } only
            if (s === undefined) {
              type[k] = OTHER;
              num[k] = other.push(v) - 1;
            }
            continue;
          }
          v = (v as { value?: unknown }).value;
          if (v === undefined) {
            // { value: undefined, style? } is not the same as { style }: keep it exact.
            type[k] = OTHER;
            num[k] = other.push(row[c]) - 1;
            style[k] = 0;
            continue;
          }
        }
        if (style[k] === 0 && row[c] !== v) {
          // A { value } object without a style: keep the wrapper exact.
          type[k] = OTHER;
          num[k] = other.push(row[c]) - 1;
          continue;
        }
        switch (typeof v) {
          case "number":
            type[k] = NUMBER;
            num[k] = v;
            break;
          case "string":
            type[k] = STRING;
            num[k] = strings.push(v) - 1;
            break;
          case "boolean":
            type[k] = BOOLEAN;
            num[k] = v ? 1 : 0;
            break;
          case "undefined":
            type[k] = UNDEFINED;
            break;
          default:
            if (v === null) type[k] = NULL;
            else if (v instanceof Date && Object.getPrototypeOf(v) === Date.prototype) {
              type[k] = DATE;
              num[k] = v.getTime();
            } else {
              type[k] = OTHER;
              num[k] = other.push(row[c]) - 1;
              style[k] = 0;
            }
        }
      }
    }
    transfer.push(rowLen.buffer as ArrayBuffer, type.buffer as ArrayBuffer, num.buffer as ArrayBuffer, style.buffer as ArrayBuffer);
    return { compact: { rowLen, type, num, style, strings, other } };
  });

  const out: CompactSheet[] = [];
  const headerSheets = wb.sheets.map((sheet, i) => {
    const enc = sheets[i]!;
    if ("fallback" in enc) {
      out.push(FALLBACK());
      return sheet; // its rows go through structured clone
    }
    out.push(enc.compact!);
    const { rows: _rows, ...rest } = sheet;
    void _rows;
    return { ...rest, rows: [] } as Sheet;
  });
  return { message: { compact: 1, header: { ...wb, sheets: headerSheets }, sheets: out, styles }, transfer };
}

/** Marks a sheet whose rows were left in the header (rows that are not arrays). */
const FALLBACK = (): CompactSheet => ({
  rowLen: new Uint32Array([0xffffffff]),
  type: new Uint8Array(0),
  num: new Float64Array(0),
  style: new Uint32Array(0),
  strings: [],
  other: [],
});

/** True when `v` is a CompactWorkbook message. */
export function isCompactWorkbook(v: unknown): v is CompactWorkbook {
  return typeof v === "object" && v !== null && (v as { compact?: unknown }).compact === 1 && Array.isArray((v as { sheets?: unknown }).sheets);
}

/** Rebuilds the workbook in the worker. */
export function decodeWorkbook(m: CompactWorkbook): Workbook {
  const sheets = m.header.sheets.map((sheet, i) => {
    const e = m.sheets[i]!;
    if (e.rowLen.length === 1 && e.rowLen[0] === 0xffffffff) return sheet; // fallback: rows were cloned
    const rows: Array<Array<CellInput> | undefined> = [];
    rows.length = e.rowLen.length;
    let k = 0;
    for (let r = 0; r < e.rowLen.length; r++) {
      const marker = e.rowLen[r]!;
      if (marker === ROW_HOLE) continue;
      const n = marker - ROW_EMPTY;
      const row: CellInput[] = [];
      row.length = n;
      for (let c = 0; c < n; c++, k++) {
        const t = e.type[k]!;
        if (t === HOLE) continue;
        let v: CellInput;
        switch (t) {
          case NUMBER:
            v = e.num[k]!;
            break;
          case STRING:
            v = e.strings[e.num[k]!]!;
            break;
          case BOOLEAN:
            v = e.num[k] === 1;
            break;
          case DATE:
            v = new Date(e.num[k]!);
            break;
          case NULL:
            v = null;
            break;
          case UNDEFINED:
            v = undefined;
            break;
          default:
            row[c] = e.other[e.num[k]!] as CellInput;
            continue;
        }
        const s = e.style[k]!;
        if (s !== 0) {
          const st = m.styles[s - 1]!;
          row[c] = t === UNDEFINED ? { style: st } : { value: v as never, style: st };
        } else row[c] = v;
      }
      rows[r] = row;
    }
    return { ...sheet, rows } as Sheet;
  });
  return { ...m.header, sheets };
}

/**
 * Content key for deduplicating style literals, or undefined when the style
 * holds anything but plain data (the writer validates it either way).
 */
function safeKey(style: Style): string | undefined {
  let plain = true;
  const key = JSON.stringify(style, function (this: unknown, k: string, v: unknown) {
    const raw = k === "" ? style : (this as Record<string, unknown>)[k];
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const proto = Object.getPrototypeOf(raw);
      if ((proto !== Object.prototype && proto !== null) || typeof (raw as { toJSON?: unknown }).toJSON === "function") plain = false;
    }
    if (typeof v === "number" && !Number.isFinite(v)) plain = false;
    if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") plain = false;
    if (v === undefined && k !== "") plain = false; // { bold: undefined } would merge with {}
    return v;
  });
  return plain ? key : undefined;
}
