/**
 * Dataset builders (docs/api.md §4.3): `{ columns, data }` ↔ Sheet.
 *
 * `fromDataset` lays out header rows (with header groups as merged cells),
 * data rows and an optional totals row; `fromDatasets` stacks several blocks
 * on one sheet; `toDataset` goes the other way for import.
 */

import { decodeCell, decodeRange, encodeCell, encodeCol, MAX_COLS, MAX_ROWS } from "./address";
import { type AutoWidthOptions } from "./auto-width";
import { cellText } from "./cells";
import { dateToSerial } from "./dates";
import { ValidationError } from "./errors";
import { isoDate, parseIsoDate } from "./internal/iso-date";
import { AUTO_WIDTH, textWidth } from "./internal/write/sheet-features";
import type { Cell, CellInput, CellValue, ColumnProps, ColumnWidth, NumFmt, RichText, Sheet, Style } from "./model";
import { validateSheetName } from "./sheet-names";
import { mergeStyles } from "./styles";
import type { ExcelWarning } from "./warnings";

// ------------------------------------------------------------------ types

/** A dataset: column definitions and rows (objects or arrays). */
export interface Dataset<T> {
  /** Falsy entries are skipped (conditional columns). Omitted: inferred from the keys of the first object row. */
  columns?: Array<ColumnDef<T> | null | false | undefined> | undefined;
  /** Objects (picked by key, path or value) or arrays (picked by index). */
  data: readonly T[];
}

/** A column definition: a leaf (one sheet column) or a header group. */
export type ColumnDef<T> = LeafColumn<T> | GroupColumn<T>;

/** A header group: its title spans its leaf columns (a merged header cell). */
export interface GroupColumn<T> {
  title: string | RichText | Cell;
  headerStyle?: Style | undefined;
  children: Array<ColumnDef<T> | null | false | undefined>;
}

/** What a totals cell may be: a built-in, a fixed cell, or a function of the column's data. */
export type ColumnTotal = "sum" | "average" | "count" | "min" | "max" | CellInput | ((ctx: { range: string; values: CellValue[] }) => CellInput);

/** A leaf column: one sheet column. */
export interface LeafColumn<T> {
  /** Header cell. Default: the key or path, or '' for value/index accessors. */
  title?: string | RichText | Cell | undefined;
  /** Own property name, taken literally ('a.b' is a key containing a dot). */
  key?: string | undefined;
  /** Path into nested data: 'a.b', 'items[0].name', "a['x.y']". */
  path?: string | undefined;
  /** Computed value. */
  value?: ((row: T, ctx: { rowIndex: number }) => CellInput) | undefined;
  /** Array rows: index into the row. */
  index?: number | undefined;
  /** Coerce data cells. Default 'auto': take values as they are. */
  type?: "auto" | "string" | "number" | "boolean" | "date" | "datetime" | undefined;
  numFmt?: NumFmt | undefined;
  /** Style of this column's data cells. */
  style?: Style | undefined;
  /** Merged over options.headerStyle. */
  headerStyle?: Style | undefined;
  width?: ColumnWidth | undefined;
  hidden?: boolean | undefined;
  /** Totals row entry for this column. */
  total?: ColumnTotal | undefined;
}

/** Options for `fromDataset` and `fromDatasets`. */
export interface DatasetOptions<T> {
  /** Sheet name, default 'Sheet1'. An invalid name throws INVALID_SHEET_NAME (§12 Q19). */
  name?: string | undefined;
  /** Top-left cell of the block, default 'A1'. */
  origin?: string | undefined;
  /** Write header rows, default true. */
  header?: boolean | undefined;
  /** Default { font: { bold: true } }. */
  headerStyle?: Style | undefined;
  /** Freeze all header rows. */
  freezeHeader?: boolean | undefined;
  /** Autofilter from the last header row through the last data row (totals excluded). */
  autoFilter?: boolean | undefined;
  /** Estimate column widths from the text. Columns with their own width keep it. */
  autoWidth?: boolean | AutoWidthOptions | undefined;
  rightToLeft?: boolean | undefined;
  /** Totals row label (in the first leaf column, if it has no total) and style. */
  totals?: { label?: string | undefined; style?: Style | undefined } | undefined;
  rowStyle?: ((row: T, rowIndex: number) => Style | undefined) | undefined;
  /** COERCION_FAILED and NON_FINITE_NUMBER. */
  onWarning?: ((w: ExcelWarning) => void) | undefined;
}

/** A block for `fromDatasets`, optionally offset from the previous one. */
export type DatasetBlock<T> = Dataset<T> & { offset?: { rows?: number | undefined; cols?: number | undefined } | undefined };

// ------------------------------------------------------------- accessors

function columnError(message: string, details: Record<string, unknown> = {}): ValidationError {
  return new ValidationError("INVALID_COLUMN", message, { details });
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/** Parses 'a.b', 'items[0].name', "a['x.y']" and 'a["x"]' into segments. */
export function parsePath(path: string): string[] {
  const segs: string[] = [];
  let i = 0;
  const fail = (): never => {
    throw columnError(`Invalid path ${JSON.stringify(path)}.`, { path });
  };
  if (typeof path !== "string" || path.length === 0) fail();
  while (i < path.length) {
    if (path[i] === "[") {
      const q = path[i + 1];
      if (q === "'" || q === '"') {
        const end = path.indexOf(`${q}]`, i + 2);
        if (end < 0) fail();
        segs.push(path.slice(i + 2, end));
        i = end + 2;
      } else {
        const end = path.indexOf("]", i);
        const n = path.slice(i + 1, end);
        if (end < 0 || !/^\d+$/.test(n)) fail();
        segs.push(n);
        i = end + 1;
      }
      if (path[i] === ".") i++;
      continue;
    }
    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
    if (j === i) fail();
    segs.push(path.slice(i, j));
    i = path[j] === "." ? j + 1 : j;
    if (path[j] === "." && i >= path.length) fail();
  }
  for (const s of segs) if (FORBIDDEN_SEGMENTS.has(s)) throw columnError(`Path ${JSON.stringify(path)} uses the forbidden segment ${s}.`, { path, segment: s });
  return segs;
}

const own = (o: unknown, k: string): unknown =>
  o !== null && (typeof o === "object" || typeof o === "function") && Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined;

interface Leaf<T> {
  def: LeafColumn<T>;
  /** Column index relative to the block. */
  col: number;
  get: (row: T, rowIndex: number) => CellInput;
}

function accessorOf<T>(def: LeafColumn<T>, position: number): Leaf<T>["get"] {
  const given = [def.key !== undefined, def.path !== undefined, def.value !== undefined, def.index !== undefined].filter(Boolean).length;
  if (given > 1) throw columnError(`Column ${JSON.stringify(def.title ?? def.key ?? def.path)} has more than one accessor (key, path, value, index).`);
  if (def.key !== undefined) {
    if (typeof def.key !== "string") throw columnError("key must be a string.");
    const key = def.key;
    return (row) => own(row, key) as CellInput;
  }
  if (def.path !== undefined) {
    const segs = parsePath(def.path);
    return (row) => {
      let v: unknown = row;
      for (const s of segs) {
        v = own(v, s);
        if (v === undefined) return undefined;
      }
      return v as CellInput;
    };
  }
  if (def.value !== undefined) {
    if (typeof def.value !== "function") throw columnError("value must be a function.");
    const fn = def.value;
    return (row, rowIndex) => fn(row, { rowIndex });
  }
  const index = def.index ?? position;
  if (!Number.isInteger(index) || index < 0) throw columnError(`index must be a non-negative integer, got ${String(def.index)}.`);
  const named = def.index !== undefined;
  return (row) => {
    if (Array.isArray(row)) return row[index] as CellInput;
    if (named || row === null || row === undefined) return undefined;
    throw columnError(`Column ${JSON.stringify(def.title ?? `#${position + 1}`)} has no accessor (key, path, value or index) and the data rows are objects.`);
  };
}

// --------------------------------------------------------------- coercion

const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function isCellObject(v: unknown): v is Cell {
  return typeof v === "object" && v !== null && !(v instanceof Date) && !("error" in v) && !("richText" in v);
}

type Coerced = { value: CellValue | null | undefined; failed: boolean };

function coerce(v: CellValue | null | undefined, type: LeafColumn<unknown>["type"]): Coerced {
  if (v === null || v === undefined || type === undefined || type === "auto") return { value: v, failed: false };
  switch (type) {
    case "string":
      if (v instanceof Date) return { value: Number.isFinite(v.getTime()) ? isoDate(v, "local") : "", failed: false };
      return { value: typeof v === "object" ? cellText(v) : String(v), failed: false };
    case "number":
      if (typeof v === "number") return { value: v, failed: false };
      if (typeof v === "string" && PLAIN_NUMBER.test(v.trim())) return { value: Number(v.trim()), failed: false };
      return { value: typeof v === "object" && !(v instanceof Date) ? cellText(v) : String(v instanceof Date ? isoDate(v, "local") : v), failed: true };
    case "boolean":
      if (typeof v === "boolean") return { value: v, failed: false };
      if (typeof v === "string" && /^(true|false)$/i.test(v.trim())) return { value: v.trim().toLowerCase() === "true", failed: false };
      return { value: typeof v === "object" ? cellText(v) : String(v), failed: true };
    case "date":
    case "datetime": {
      if (v instanceof Date) return Number.isFinite(v.getTime()) ? { value: v, failed: false } : { value: "Invalid Date", failed: true };
      if (typeof v === "number" && Number.isFinite(v)) return { value: new Date(v), failed: false };
      if (typeof v === "string") {
        const d = parseIsoDate(v);
        if (d) return { value: d, failed: false };
      }
      return { value: typeof v === "object" ? cellText(v) : String(v), failed: true };
    }
    default:
      throw columnError(`Unknown column type ${JSON.stringify(type)}.`, { type });
  }
}

// ------------------------------------------------------------- layout

interface Grid {
  rows: CellInput[][];
  merges: string[];
  widths: Map<number, ColumnWidth>; // absolute column → explicit width
  measured: Map<number, number>; // absolute column → widest text (for auto)
  autoCols: Set<number>;
  hidden: Set<number>;
}

const set = (g: Grid, r: number, c: number, v: CellInput): void => {
  if (r >= MAX_ROWS || c >= MAX_COLS) throw new ValidationError("OUT_OF_BOUNDS", `Dataset does not fit the sheet: ${encodeCol(Math.min(c, MAX_COLS - 1))}${r + 1} is out of bounds.`);
  (g.rows[r] ??= [])[c] = v;
};

const range = (r1: number, c1: number, r2: number, c2: number): string => {
  const a = encodeCell({ row: r1, col: c1 });
  const b = encodeCell({ row: r2, col: c2 });
  return a === b ? a : `${a}:${b}`;
};

type Node<T> = { group: GroupColumn<T>; children: Array<Node<T>> } | { leaf: LeafColumn<T> };

function normalise<T>(defs: Array<ColumnDef<T> | null | false | undefined>): Array<Node<T>> {
  const out: Array<Node<T>> = [];
  for (const d of defs) {
    if (!d) continue;
    if (typeof d !== "object") throw columnError("A column definition must be an object.");
    if ("children" in d && d.children !== undefined) {
      if (!Array.isArray(d.children)) throw columnError("children must be an array.");
      const children = normalise(d.children);
      if (children.length) out.push({ group: d, children });
    } else out.push({ leaf: d as LeafColumn<T> });
  }
  return out;
}

const depthOf = <T>(n: Node<T>): number => ("group" in n ? 1 + Math.max(...n.children.map(depthOf)) : 1);
const leafCount = <T>(n: Node<T>): number => ("group" in n ? n.children.reduce((s, c) => s + leafCount(c), 0) : 1);

function titleCell(title: string | RichText | Cell | undefined, style: Style | undefined): CellInput {
  if (title === undefined) return style ? { value: "", style } : "";
  if (isCellObject(title)) return { ...title, style: mergeStyles(style, title.style) };
  return style ? { value: title, style } : title;
}

interface BlockResult {
  headerRows: number;
  /** Last row the block uses, totals included. */
  lastRow: number;
  firstRow: number;
  lastHeaderRow: number;
  lastDataRow: number;
  firstCol: number;
  lastCol: number;
}

function layoutBlock<T>(g: Grid, dataset: Dataset<T>, options: DatasetOptions<T>, top: number, left: number, sheet: string): BlockResult {
  if (typeof dataset !== "object" || dataset === null || !Array.isArray(dataset.data)) {
    throw columnError("A dataset needs a data array.");
  }
  const data = dataset.data;
  let defs = dataset.columns;
  let inferredArrays = false;
  if (defs === undefined) {
    const first = data.find((r) => r !== null && r !== undefined);
    if (Array.isArray(first)) {
      inferredArrays = true;
      const width = data.reduce((m, r) => (Array.isArray(r) ? Math.max(m, r.length) : m), 0);
      defs = Array.from({ length: width }, (_, i) => ({ index: i }));
    } else if (first !== undefined && typeof first === "object") {
      defs = Object.keys(first as object).map((key) => ({ title: key, key }));
    } else defs = [];
  }
  if (!Array.isArray(defs)) throw columnError("columns must be an array.");
  const nodes = normalise(defs);

  // Leaves in order, with their block-relative column.
  const leaves: Array<Leaf<T>> = [];
  const collect = (n: Node<T>): void => {
    if ("group" in n) n.children.forEach(collect);
    else {
      const def = n.leaf;
      leaves.push({ def, col: leaves.length, get: accessorOf(def, leaves.length) });
    }
  };
  nodes.forEach(collect);

  const headerOn = options.header !== false && !inferredArrays && leaves.length > 0;
  const headerRows = headerOn ? Math.max(...nodes.map(depthOf)) : 0;
  const baseHeader = options.headerStyle ?? { font: { bold: true } };

  // Column properties.
  for (const { def, col } of leaves) {
    const c = left + col;
    if (def.width === "auto" || (def.width === undefined && options.autoWidth)) g.autoCols.add(c);
    else if (def.width !== undefined && !g.widths.has(c)) g.widths.set(c, def.width);
    if (def.hidden) g.hidden.add(c);
  }

  // Header rows: groups merge across their leaves; shallow leaves merge down.
  if (headerOn) {
    let next = 0;
    const place = (n: Node<T>, level: number): void => {
      if ("group" in n) {
        const span = leafCount(n);
        const c = left + next;
        set(g, top + level, c, titleCell(n.group.title, mergeStyles(baseHeader, n.group.headerStyle)));
        if (span > 1) g.merges.push(range(top + level, c, top + level, c + span - 1));
        n.children.forEach((child) => place(child, level + 1));
      } else {
        const def = n.leaf;
        const c = left + next++;
        const title = def.title ?? def.key ?? def.path ?? "";
        const cell = titleCell(title, mergeStyles(baseHeader, def.headerStyle));
        set(g, top + level, c, cell);
        if (level < headerRows - 1) g.merges.push(range(top + level, c, top + headerRows - 1, c));
        // Leaf titles count for auto width; group titles do not.
        if (g.autoCols.has(c)) g.measured.set(c, Math.max(g.measured.get(c) ?? 0, textWidth(cellText(cell))));
      }
    };
    nodes.forEach((n) => place(n, 0));
  }

  // Data rows.
  const warn = options.onWarning ?? ((): void => {});
  const dataTop = top + headerRows;
  const sampleRows = typeof options.autoWidth === "object" && options.autoWidth.sampleRows !== undefined ? options.autoWidth.sampleRows : Infinity;
  const columnValues: CellValue[][] = leaves.map(() => []);
  const columnStyles = leaves.map(({ def }) => {
    const typeFmt: Style | undefined = def.type === "date" ? { numFmt: 14 } : def.type === "datetime" ? { numFmt: 22 } : undefined;
    return mergeStyles(typeFmt, def.style, def.numFmt !== undefined ? { numFmt: def.numFmt } : undefined);
  });
  data.forEach((row, i) => {
    const r = dataTop + i;
    const rowStyle = options.rowStyle?.(row, i);
    for (const { def, col, get } of leaves) {
      const c = left + col;
      const ref = encodeCell({ row: r, col: c });
      const raw = get(row, i);
      let cell: Cell = isCellObject(raw) ? { ...raw } : { value: raw as CellValue | null | undefined };
      if (!cell.formula) {
        const { value, failed } = coerce(cell.value, def.type);
        if (failed) warn({ code: "COERCION_FAILED", message: `${sheet}!${ref}: value does not fit type '${def.type}'; written as text.`, sheet, ref });
        cell.value = value;
      }
      if (typeof cell.value === "number" && !Number.isFinite(cell.value)) {
        warn({ code: "NON_FINITE_NUMBER", message: `${sheet}!${ref}: ${String(cell.value)} cannot be stored; the cell is left empty.`, sheet, ref });
        cell = { ...cell, value: null };
      }
      const style = mergeStyles(columnStyles[col], rowStyle, isCellObject(raw) ? raw.style : undefined);
      const styled = Object.keys(style).length > 0;
      const out: CellInput = styled ? { ...cell, style } : Object.keys(cell).length === 1 && "value" in cell ? (cell.value as CellInput) : cell;
      if (out !== undefined && out !== null) set(g, r, c, out);
      const v = cell.value;
      if (v !== null && v !== undefined) columnValues[col]!.push(v);
      if (i < sampleRows && g.autoCols.has(c)) g.measured.set(c, Math.max(g.measured.get(c) ?? 0, textWidth(cellText(out))));
    }
  });
  const lastDataRow = dataTop + data.length - 1;

  // Totals row.
  const hasTotals = leaves.some(({ def }) => def.total !== undefined);
  let lastRow = Math.max(top + headerRows - 1, lastDataRow);
  if (hasTotals) {
    const r = lastDataRow + 1;
    const totalsStyle = options.totals?.style;
    leaves.forEach(({ def, col }, k) => {
      const c = left + col;
      const values = columnValues[col]!;
      const dataRange = data.length ? range(dataTop, c, lastDataRow, c) : "";
      let cell: CellInput;
      if (def.total === undefined) {
        if (k !== 0 || options.totals?.label === undefined) return;
        cell = { value: options.totals.label, ...(totalsStyle ? { style: totalsStyle } : {}) };
      } else {
        cell = totalCell(def.total, dataRange, values);
        const base = def.total === "count" ? { ...columnStyles[col], numFmt: undefined } : columnStyles[col];
        const cellStyle = isCellObject(cell) ? cell.style : undefined;
        const style = mergeStyles(base, totalsStyle, cellStyle);
        if (Object.keys(style).length) cell = isCellObject(cell) ? { ...cell, style } : { value: cell as CellValue | null, style };
      }
      set(g, r, c, cell);
      if (g.autoCols.has(c)) g.measured.set(c, Math.max(g.measured.get(c) ?? 0, textWidth(cellText(cell))));
    });
    lastRow = r;
  }
  return {
    headerRows,
    firstRow: top,
    lastHeaderRow: top + headerRows - 1,
    lastDataRow: Math.max(lastDataRow, top + headerRows - 1),
    firstCol: left,
    lastCol: left + Math.max(leaves.length, 1) - 1,
    lastRow,
  };
}

const SUBTOTAL: Record<string, number> = { sum: 109, average: 101, count: 103, min: 105, max: 104 };

function numeric(values: CellValue[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number") out.push(v);
    else if (v instanceof Date) {
      try {
        out.push(dateToSerial(v));
      } catch {
        // dates Excel cannot store are not counted
      }
    }
  }
  return out;
}

function totalCell(total: ColumnTotal, dataRange: string, values: CellValue[]): CellInput {
  if (typeof total === "function") return total({ range: dataRange, values });
  if (typeof total === "string" && total in SUBTOTAL) {
    const nums = numeric(values);
    let cached: CellValue;
    switch (total) {
      case "sum":
        cached = nums.reduce((a, b) => a + b, 0);
        break;
      case "average":
        cached = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : { error: "#DIV/0!" };
        break;
      case "count":
        cached = values.length; // COUNTA: every non-empty cell
        break;
      case "min":
        cached = nums.length ? Math.min(...nums) : 0;
        break;
      default:
        cached = nums.length ? Math.max(...nums) : 0;
    }
    // Without data rows there is no range for SUBTOTAL; the value alone is written.
    return dataRange ? { formula: `SUBTOTAL(${SUBTOTAL[total]},${dataRange})`, value: cached } : { value: cached };
  }
  return total as CellInput;
}

function finish<T>(g: Grid, options: DatasetOptions<T>, first: BlockResult | undefined, name: string): Sheet {
  const sheet: Sheet = { name, rows: g.rows };
  if (g.merges.length) sheet.merges = g.merges;
  const auto = typeof options.autoWidth === "object" ? options.autoWidth : {};
  const min = auto.min ?? AUTO_WIDTH.min;
  const max = Math.min(255, auto.max ?? AUTO_WIDTH.max);
  const cols = new Set<number>([...g.widths.keys(), ...g.autoCols, ...g.hidden]);
  if (cols.size) {
    const colProps: Array<ColumnProps | undefined> = [];
    for (const c of [...cols].sort((a, b) => a - b)) {
      const p: ColumnProps = {};
      const w = g.autoCols.has(c) ? Math.min(max, Math.max(min, (g.measured.get(c) ?? 0) + AUTO_WIDTH.padding)) : g.widths.get(c);
      if (w !== undefined) p.width = w;
      if (g.hidden.has(c)) p.hidden = true;
      colProps[c] = p;
    }
    sheet.colProps = colProps;
  }
  const view: NonNullable<Sheet["view"]> = {};
  if (options.rightToLeft) view.rightToLeft = true;
  if (options.freezeHeader && first && first.headerRows > 0) view.freeze = { rows: first.lastHeaderRow + 1 };
  if (Object.keys(view).length) sheet.view = view;
  if (options.autoFilter && first && first.headerRows > 0) {
    sheet.autoFilter = range(first.lastHeaderRow, first.firstCol, first.lastDataRow, first.lastCol);
  }
  return sheet;
}

function sheetName(options: { name?: string | undefined }): string {
  const name = options.name ?? "Sheet1";
  const problem = validateSheetName(name);
  if (problem) throw new ValidationError("INVALID_SHEET_NAME", `Sheet name ${JSON.stringify(name)} is invalid (${problem}).`, { details: { sheet: name, problem } });
  return name;
}

function originOf(options: { origin?: string | undefined }): { row: number; col: number } {
  if (options.origin === undefined) return { row: 0, col: 0 };
  return decodeCell(options.origin);
}

const newGrid = (): Grid => ({ rows: [], merges: [], widths: new Map(), measured: new Map(), autoCols: new Set(), hidden: new Set() });

/** Builds a sheet from `{ columns, data }`. */
export function fromDataset<T>(dataset: Dataset<T>, options: DatasetOptions<T> = {}): Sheet {
  const name = sheetName(options);
  const origin = originOf(options);
  const g = newGrid();
  const block = layoutBlock(g, dataset, options, origin.row, origin.col, name);
  return finish(g, options, block, name);
}

/**
 * Stacks several datasets on one sheet (replaces the old xSteps/ySteps).
 * Each block starts `gap` empty rows (default 1) below the previous one, or
 * `offset.rows` rows when given, and `offset.cols` columns right of the
 * origin. Freeze and filter apply to the first block with header rows.
 */
export function fromDatasets(blocks: Array<DatasetBlock<any>>, options: DatasetOptions<any> & { gap?: number | undefined } = {}): Sheet {
  if (!Array.isArray(blocks)) throw columnError("fromDatasets needs an array of datasets.");
  const name = sheetName(options);
  const origin = originOf(options);
  const gap = options.gap ?? 1;
  if (!Number.isInteger(gap) || gap < 0) throw columnError(`gap must be a non-negative integer, got ${String(gap)}.`);
  const g = newGrid();
  let first: BlockResult | undefined;
  let nextRow = origin.row;
  blocks.forEach((block, i) => {
    const offRows = block.offset?.rows;
    const offCols = block.offset?.cols ?? 0;
    const top = i === 0 ? origin.row + (offRows ?? 0) : nextRow + (offRows ?? gap);
    const result = layoutBlock(g, block, options, top, origin.col + offCols, name);
    if (!first && result.headerRows > 0) first = result;
    nextRow = result.lastRow + 1;
  });
  return finish(g, options, first, name);
}

// --------------------------------------------------------------- toDataset

/** Options for `toDataset`. */
export interface ToDatasetOptions {
  /** Zero-based header row, default 0; false = no header, keys are column letters. */
  headerRow?: number | false | undefined;
  /** Range to read, e.g. 'A1:F100'. Default: sheet.dimension, else the used range. */
  range?: string | undefined;
  /** 'value' (default): each field is the cell's value; 'cell': the whole Cell. */
  values?: "value" | "cell" | undefined;
}

/** The result of `toDataset`. Rows are null-prototype objects. */
export interface DatasetResult {
  columns: Array<{ title: string; key: string }>;
  data: Array<Record<string, unknown>>;
}

function usedRange(sheet: Sheet<CellInput>): { start: { row: number; col: number }; end: { row: number; col: number } } | undefined {
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  sheet.rows.forEach((row, r) =>
    row?.forEach((c, col) => {
      if (c === undefined || c === null) return;
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minC = Math.min(minC, col);
      maxC = Math.max(maxC, col);
    }),
  );
  return maxR < 0 ? undefined : { start: { row: minR, col: minC }, end: { row: maxR, col: maxC } };
}

/**
 * Reads a sheet back into `{ columns, data }` (import direction). Keys come
 * from the header text, deduplicated with _2, _3...; an empty header gives the
 * column letter. Empty rows are skipped. Rows are null-prototype objects, so
 * a header named __proto__ in an untrusted file is just a key.
 */
export function toDataset(sheet: Sheet<Cell> | Sheet, options: ToDatasetOptions = {}): DatasetResult {
  const s = sheet as Sheet<CellInput>;
  const rng = options.range ? decodeRange(options.range) : s.dimension ? decodeRange(s.dimension) : usedRange(s);
  if (!rng) return { columns: [], data: [] };
  const headerRow = options.headerRow ?? 0;
  if (headerRow !== false && (!Number.isInteger(headerRow) || headerRow < 0)) throw columnError(`headerRow must be a non-negative integer or false, got ${String(headerRow)}.`);
  const asCell = options.values === "cell";

  const columns: DatasetResult["columns"] = [];
  const used = new Map<string, number>();
  for (let c = rng.start.col; c <= rng.end.col; c++) {
    const letter = encodeCol(c);
    const title = headerRow === false ? letter : cellText(s.rows[headerRow]?.[c]).trim();
    const base = title === "" ? letter : title;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    columns.push({ title: headerRow === false ? letter : title, key: n === 1 ? base : `${base}_${n}` });
  }

  const data: DatasetResult["data"] = [];
  const firstData = headerRow === false ? rng.start.row : Math.max(rng.start.row, headerRow + 1);
  for (let r = firstData; r <= rng.end.row; r++) {
    const row = s.rows[r];
    if (!row) continue;
    let any = false;
    const obj = Object.create(null) as Record<string, unknown>;
    columns.forEach(({ key }, k) => {
      const c = row[rng.start.col + k];
      const empty = c === undefined || c === null || (isCellObject(c) && (c.value === undefined || c.value === null) && !c.formula);
      if (!empty) any = true;
      obj[key] = asCell ? (c === undefined ? null : isCellObject(c) ? c : { value: c }) : c === undefined || c === null ? null : isCellObject(c) ? (c.value ?? null) : c;
    });
    if (any) data.push(obj);
  }
  return { columns, data };
}
