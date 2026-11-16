/**
 * javascript-excel/render: the render model a spreadsheet viewer draws from
 * (docs/api.md §5.8). Geometry, merges, concrete styles, border edges,
 * display text, formula text, hyperlinks, keyboard movement and copy, all
 * computed from a read workbook. Framework-free, no DOM. Per-cell work is
 * lazy: creating a RenderSheet costs O(rows + columns + merges).
 *
 * @module javascript-excel/render
 */

export type { BorderStyle, Cell, CellInput, CellType, CellValue, PatternType, Workbook } from "./model";

import { decodeCell, decodeRange, MAX_COLS, MAX_ROWS } from "./address";
import { cellText } from "./cells";
import { resolveColor } from "./colors";
import { dateToSerial } from "./dates";
import type { BorderSide, BorderStyle, Cell, CellInput, CellType, CellValue, Color, Font, PatternType, Sheet, Style, Workbook } from "./model";

// ---------------------------------------------------------------------------
// Public types

/** Any function with this shape; `formatCell` from javascript-excel/format fits. */
export type RenderFormatter = (
  cell: Cell,
  options: { locale?: string | undefined; date1904?: boolean | undefined; indexedColors?: readonly string[] | undefined },
) => { text: string; color?: string | undefined; fill?: { char: string; at: number } | undefined; align?: "left" | "center" | "right" | undefined };

/** Options for `createRenderSheet`. */
export interface RenderOptions {
  /** Display text. Pass `formatCell` from javascript-excel/format; default: `cellText` (raw values). */
  format?: RenderFormatter | undefined;
  /** Passed to `format`. Default 'en-US'. */
  locale?: string | undefined;
  /** Pixels of the default font's widest digit at 100 %. Default 7 (Calibri 11, §3.3). */
  maxDigitWidth?: number | undefined;
  /** Empty rows and columns after the used range. Default 50 rows, 10 columns. */
  margin?: { rows?: number | undefined; cols?: number | undefined } | undefined;
  /** External hyperlink schemes that may be opened. Default ['http', 'https', 'mailto']. */
  hyperlinkSchemes?: readonly string[] | undefined;
}

/** An opaque handle; its caches live with it. */
export interface RenderSheet {
  readonly sheet: number;
  readonly name: string;
}

export interface CellRef {
  row: number;
  col: number;
}
/** An inclusive range, start <= end. */
export interface RangeRef {
  start: CellRef;
  end: CellRef;
}

export interface RenderFont {
  family: string;
  sizePt: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: "none" | "single" | "double" | "singleAccounting" | "doubleAccounting";
  strike: boolean;
  vertAlign: "baseline" | "superscript" | "subscript";
}
export interface RenderBorder {
  style: BorderStyle;
  color: string;
}
export interface RenderEdges {
  top?: RenderBorder | undefined;
  left?: RenderBorder | undefined;
  right?: RenderBorder | undefined;
  bottom?: RenderBorder | undefined;
}
export type RenderBackground =
  | { kind: "none" }
  | { kind: "solid"; color: string }
  | { kind: "pattern"; pattern: PatternType; fg: string; bg: string }
  | { kind: "gradient"; gradient: "linear" | "path"; degree: number; stops: Array<{ position: number; color: string }> };
export interface RenderStyle {
  font: RenderFont;
  background: RenderBackground;
  border: {
    top?: RenderBorder | undefined;
    right?: RenderBorder | undefined;
    bottom?: RenderBorder | undefined;
    left?: RenderBorder | undefined;
    diagonalUp?: RenderBorder | undefined;
    diagonalDown?: RenderBorder | undefined;
  };
  align: {
    horizontal: "general" | "left" | "center" | "right" | "fill" | "justify" | "centerContinuous" | "distributed";
    vertical: "top" | "center" | "bottom" | "justify" | "distributed";
    wrap: boolean;
    shrink: boolean;
    indent: number;
    rotation: number | "vertical";
    direction: "auto" | "ltr" | "rtl";
  };
}
export type RenderHyperlink =
  | { kind: "external"; href: string; allowed: true; tooltip?: string | undefined }
  | { kind: "external"; href: string; allowed: false; reason: "scheme" | "malformed"; tooltip?: string | undefined }
  | { kind: "internal"; sheet: number | null; ref: string; tooltip?: string | undefined };

export interface RenderCell {
  text: string;
  runs?: Array<{ text: string; font: RenderFont }> | undefined;
  value: CellValue | null;
  type: CellType;
  formula?: string | undefined;
  arrayFormula?: boolean | undefined;
  noCachedValue?: boolean | undefined;
  style: RenderStyle;
  edges: RenderEdges;
  merge?: { rows: number; cols: number } | undefined;
  hyperlink?: RenderHyperlink | undefined;
  align: "left" | "center" | "right";
  color?: string | undefined;
  fill?: { char: string; at: number } | undefined;
}

export interface SheetSettings {
  freeze: { rows: number; cols: number };
  rightToLeft: boolean;
  showGridLines: boolean;
  showHeaders: boolean;
  zoom: number;
  activeCell: CellRef;
  selection: RangeRef | null;
  tabColor: string | null;
}

export interface RangeStats {
  count: number;
  numericCount: number;
  sum: number;
  average: number | null;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// State

interface Merge {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

interface State {
  wb: Workbook<CellInput>;
  sh: Sheet<CellInput>;
  rows: number;
  cols: number;
  usedRows: number;
  usedCols: number;
  rowTops: Float64Array;
  /** Default row height in px at zoom 100 %, the floor for auto-fitted rows. */
  defaultRowPx: number;
  colLefts: Float64Array;
  merges: Merge[];
  buckets: Map<number, number[]>;
  format: RenderFormatter | undefined;
  locale: string;
  schemes: Set<string>;
  defaultFont: Font;
  styles: WeakMap<object, RenderStyle>;
  plain: RenderStyle;
  cells: Map<number, RenderCell | null>;
}

const states = new WeakMap<RenderSheet, State>();
const BUCKET = 64;
const CELL_CACHE = 20_000;
const key = (r: number, c: number): number => r * MAX_COLS + c;

function state(s: RenderSheet): State {
  const st = states.get(s);
  if (!st) throw new TypeError("Not a RenderSheet: create one with createRenderSheet().");
  return st;
}

// ---------------------------------------------------------------------------
// Creation and geometry

const asCell = (c: unknown): Cell | undefined => {
  if (c === undefined || c === null) return undefined;
  if (typeof c !== "object" || c instanceof Date || "error" in c || "richText" in c) return { value: c as CellValue };
  return c as Cell;
};

function charsToPx(chars: number, mdw: number): number {
  if (!(chars > 0)) return 0;
  const fileWidth = Math.trunc(((chars * mdw + 5) / mdw) * 256) / 256;
  return Math.trunc(((256 * fileWidth + Math.trunc(128 / mdw)) / 256) * mdw);
}

/** Creates the render model of one sheet. Reader output (`Workbook<Cell>`) and built workbooks with bare values both work. */
export function createRenderSheet(workbook: Workbook<CellInput>, sheet: number, options: RenderOptions = {}): RenderSheet {
  const sh = workbook.sheets[sheet];
  if (!sh) throw new RangeError(`Sheet index ${sheet} does not exist.`);
  const mdw = options.maxDigitWidth ?? 7;
  // Used range: the reader's dimension, else the cells; merges and frozen panes extend it.
  let usedRows = 0;
  let usedCols = 0;
  let dim: { start: CellRef; end: CellRef } | undefined;
  try {
    dim = sh.dimension ? decodeRange(sh.dimension) : undefined;
  } catch {
    dim = undefined;
  }
  if (dim) {
    usedRows = dim.end.row + 1;
    usedCols = dim.end.col + 1;
  } else {
    usedRows = sh.rows.length;
    for (const row of sh.rows) if (row && row.length > usedCols) usedCols = row.length;
  }
  const merges: Merge[] = [];
  for (const ref of sh.merges ?? []) {
    try {
      const m = decodeRange(ref);
      merges.push({ r0: m.start.row, c0: m.start.col, r1: m.end.row, c1: m.end.col });
      usedRows = Math.max(usedRows, m.end.row + 1);
      usedCols = Math.max(usedCols, m.end.col + 1);
    } catch {
      // An unreadable merge is ignored.
    }
  }
  const freeze = sh.view?.freeze;
  const rows = Math.min(MAX_ROWS, Math.max(usedRows, freeze?.rows ?? 0) + Math.max(0, options.margin?.rows ?? 50));
  const cols = Math.min(MAX_COLS, Math.max(usedCols, freeze?.cols ?? 0) + Math.max(0, options.margin?.cols ?? 10));

  const defaultRowPx = ((sh.defaultRowHeight ?? 15) * 96) / 72;
  const rowTops = new Float64Array(rows + 1);
  for (let r = 0; r < rows; r++) {
    const p = sh.rowProps?.[r];
    const h = p?.hidden ? 0 : p?.height !== undefined ? (p.height * 96) / 72 : defaultRowPx;
    rowTops[r + 1] = rowTops[r]! + Math.max(0, h);
  }
  const defaultColPx = charsToPx(sh.defaultColWidth ?? 8.43, mdw);
  const colLefts = new Float64Array(cols + 1);
  for (let c = 0; c < cols; c++) {
    const p = sh.colProps?.[c];
    let w = defaultColPx;
    if (p?.hidden) w = 0;
    else if (typeof p?.width === "number") w = charsToPx(p.width, mdw);
    else if (p?.width && typeof p.width === "object") w = "wpx" in p.width ? Math.max(0, p.width.wpx) : charsToPx(p.width.wch, mdw);
    colLefts[c + 1] = colLefts[c]! + w;
  }

  const buckets = new Map<number, number[]>();
  merges.forEach((m, i) => {
    for (let b = Math.floor(m.r0 / BUCKET); b <= Math.floor(m.r1 / BUCKET); b++) {
      const list = buckets.get(b);
      if (list) list.push(i);
      else buckets.set(b, [i]);
    }
  });

  const handle: RenderSheet = Object.freeze({ sheet, name: sh.name });
  const st: State = {
    wb: workbook,
    sh,
    rows,
    cols,
    usedRows,
    usedCols,
    rowTops,
    defaultRowPx,
    colLefts,
    merges,
    buckets,
    format: options.format,
    locale: options.locale ?? "en-US",
    schemes: new Set((options.hyperlinkSchemes ?? ["http", "https", "mailto"]).map((x) => x.toLowerCase())),
    defaultFont: workbook.defaultFont ?? {},
    styles: new WeakMap(),
    plain: undefined as unknown as RenderStyle,
    cells: new Map(),
  };
  st.plain = buildStyle(st, undefined);
  states.set(handle, st);
  return handle;
}

export function sheetExtent(s: RenderSheet): { rows: number; cols: number } {
  const st = state(s);
  return { rows: st.rows, cols: st.cols };
}

export function sheetSettings(s: RenderSheet): SheetSettings {
  const st = state(s);
  const v = st.sh.view;
  const cell = (ref: string | undefined): CellRef | undefined => {
    try {
      return ref ? decodeCell(ref) : undefined;
    } catch {
      return undefined;
    }
  };
  let selection: RangeRef | null = null;
  try {
    selection = v?.selection ? decodeRange(v.selection) : null;
  } catch {
    selection = null;
  }
  return {
    freeze: { rows: v?.freeze?.rows ?? 0, cols: v?.freeze?.cols ?? 0 },
    rightToLeft: v?.rightToLeft === true,
    showGridLines: v?.showGridLines !== false,
    showHeaders: v?.showRowColHeaders !== false,
    zoom: v?.zoom ?? 100,
    activeCell: cell(v?.activeCell) ?? { row: 0, col: 0 },
    selection,
    tabColor: st.sh.tabColor ? hex(st, st.sh.tabColor) : null,
  };
}

const clampTo = (i: number, n: number): number => Math.max(0, Math.min(n, Math.trunc(i)));

export function rowTop(s: RenderSheet, row: number): number {
  const st = state(s);
  return st.rowTops[clampTo(row, st.rows)]!;
}
export function rowHeight(s: RenderSheet, row: number): number {
  const st = state(s);
  const r = clampTo(row, st.rows - 1);
  return st.rowTops[r + 1]! - st.rowTops[r]!;
}
export function colLeft(s: RenderSheet, col: number): number {
  const st = state(s);
  return st.colLefts[clampTo(col, st.cols)]!;
}
export function colWidth(s: RenderSheet, col: number): number {
  const st = state(s);
  const c = clampTo(col, st.cols - 1);
  return st.colLefts[c + 1]! - st.colLefts[c]!;
}
export function isRowHidden(s: RenderSheet, row: number): boolean {
  return rowHeight(s, row) === 0;
}
/** Excel's largest row height, 409 pt, in CSS px. */
const MAX_ROW_PX = (409 * 96) / 72;

/** True when the row's height comes from the file (`rowProps[row].height`); only other rows may be auto-fitted (§5.8.1). */
export function hasStoredRowHeight(s: RenderSheet, row: number): boolean {
  return state(s).sh.rowProps?.[row]?.height !== undefined;
}

/**
 * Sets measured heights, in CSS px at zoom 100 %, for rows without a stored height: the viewer's
 * auto-fit (§5.8.1). Rows with a stored height, hidden rows and rows outside the extent are ignored.
 * Heights are clamped to [default row height, 409 pt], so auto-fit only grows rows. The offset table
 * is rebuilt from the first changed row onwards. Returns true when anything changed.
 * (An array, not an Iterable, so the declaration works with ES5 lib typings; see Consumer TS.)
 */
export function setRowHeights(s: RenderSheet, heights: ReadonlyArray<readonly [row: number, px: number]>): boolean {
  const st = state(s);
  const tops = st.rowTops;
  const updates = new Map<number, number>();
  let first = Number.POSITIVE_INFINITY;
  for (const [row, px] of heights) {
    if (!(Number.isInteger(row) && row >= 0 && row < st.rows) || !Number.isFinite(px)) continue;
    const props = st.sh.rowProps?.[row];
    if (props?.hidden || props?.height !== undefined) continue;
    const current = tops[row + 1]! - tops[row]!;
    if (current === 0) continue;
    const next = Math.min(MAX_ROW_PX, Math.max(st.defaultRowPx, px));
    if (next !== current) {
      updates.set(row, next);
      if (row < first) first = row;
    }
  }
  if (updates.size === 0) return false;
  // Rebuild the prefix sums from the first changed row, reading each old height before it is overwritten.
  let oldTop = tops[first]!;
  for (let r = first; r < st.rows; r++) {
    const oldNext = tops[r + 1]!;
    tops[r + 1] = tops[r]! + (updates.get(r) ?? oldNext - oldTop);
    oldTop = oldNext;
  }
  return true;
}

export function isColHidden(s: RenderSheet, col: number): boolean {
  return colWidth(s, col) === 0;
}

/** The last index i with offsets[i] <= pos whose size is > 0; the first visible one when pos is before 0. */
function at(offsets: Float64Array, n: number, pos: number): number {
  let lo = 0;
  let hi = n; // offsets has n + 1 entries
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= pos) lo = mid;
    else hi = mid - 1;
  }
  let i = Math.min(lo, n - 1);
  while (i > 0 && offsets[i + 1]! - offsets[i]! === 0) i--;
  while (i < n - 1 && offsets[i + 1]! - offsets[i]! === 0) i++;
  return i;
}
export function rowAt(s: RenderSheet, y: number): number {
  const st = state(s);
  return at(st.rowTops, st.rows, y);
}
export function colAt(s: RenderSheet, x: number): number {
  const st = state(s);
  return at(st.colLefts, st.cols, x);
}

// ---------------------------------------------------------------------------
// Merges

function mergeIndex(st: State, r: number, c: number): Merge | undefined {
  const list = st.buckets.get(Math.floor(r / BUCKET));
  if (!list) return undefined;
  for (const i of list) {
    const m = st.merges[i]!;
    if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) return m;
  }
  return undefined;
}

export function mergeAt(s: RenderSheet, row: number, col: number): { anchor: CellRef; range: RangeRef } | null {
  const m = mergeIndex(state(s), row, col);
  return m ? { anchor: { row: m.r0, col: m.c0 }, range: { start: { row: m.r0, col: m.c0 }, end: { row: m.r1, col: m.c1 } } } : null;
}

// ---------------------------------------------------------------------------
// Styles

const hex = (st: State, c: Color): string => `#${resolveColor(c, { theme: st.wb.theme, indexedColors: st.wb.indexedColors }).slice(2)}`;
const isAuto = (c: Color | undefined): boolean => typeof c === "object" && c !== null && "auto" in c;

function buildFont(st: State, f: Font | undefined): RenderFont {
  const font = { ...st.defaultFont, ...f };
  const u = font.underline;
  return {
    family: font.name ?? "Calibri",
    sizePt: font.size ?? 11,
    color: font.color && !isAuto(font.color) ? hex(st, font.color) : "#000000",
    bold: font.bold === true,
    italic: font.italic === true,
    underline: u === true ? "single" : u === false || u === undefined ? "none" : u,
    strike: font.strike === true,
    vertAlign: font.vertAlign ?? "baseline",
  };
}

function side(st: State, b: BorderSide | undefined): RenderBorder | undefined {
  if (!b || b.style === "none") return undefined;
  return { style: b.style, color: b.color && !isAuto(b.color) ? hex(st, b.color) : "#000000" };
}

function buildStyle(st: State, style: Style | undefined): RenderStyle {
  let background: RenderBackground = { kind: "none" };
  const fill = style?.fill;
  if (typeof fill === "string") background = { kind: "solid", color: hex(st, fill) };
  else if (fill && fill.type === "gradient") {
    background = {
      kind: "gradient",
      gradient: fill.gradient,
      degree: fill.degree ?? 0,
      stops: fill.stops.map((x) => ({ position: x.position, color: hex(st, x.color) })),
    };
  } else if (fill && "pattern" in fill && fill.pattern !== "none") {
    const fg = fill.fgColor && !isAuto(fill.fgColor) ? hex(st, fill.fgColor) : "#000000";
    background = fill.pattern === "solid" ? { kind: "solid", color: fg } : { kind: "pattern", pattern: fill.pattern, fg, bg: fill.bgColor && !isAuto(fill.bgColor) ? hex(st, fill.bgColor) : "#FFFFFF" };
  }
  const b = style?.border;
  const diagonal = side(st, b?.diagonal);
  const a = style?.alignment;
  const out: RenderStyle = {
    font: buildFont(st, style?.font),
    background,
    border: {
      top: side(st, b?.top),
      right: side(st, b?.right),
      bottom: side(st, b?.bottom),
      left: side(st, b?.left),
      diagonalUp: b?.diagonalUp ? diagonal : undefined,
      diagonalDown: b?.diagonalDown ? diagonal : undefined,
    },
    align: {
      horizontal: a?.horizontal ?? "general",
      vertical: a?.vertical ?? "bottom",
      wrap: a?.wrapText === true,
      shrink: a?.shrinkToFit === true,
      indent: a?.indent ?? 0,
      rotation: a?.rotation ?? 0,
      direction: a?.readingOrder === "ltr" ? "ltr" : a?.readingOrder === "rtl" ? "rtl" : "auto",
    },
  };
  return Object.freeze(out);
}

function styleOf(st: State, style: Style | undefined): RenderStyle {
  if (!style) return st.plain;
  let r = st.styles.get(style);
  if (!r) {
    r = buildStyle(st, style);
    st.styles.set(style, r);
  }
  return r;
}

/** The model style that applies at (r, c): the merge anchor's for covered cells, else the cell's, the row's or the column's. */
function modelStyle(st: State, r: number, c: number): Style | undefined {
  const m = mergeIndex(st, r, c);
  const [rr, cc] = m ? [m.r0, m.c0] : [r, c];
  return asCell(st.sh.rows[rr]?.[cc])?.style ?? st.sh.rowProps?.[rr]?.style ?? st.sh.colProps?.[cc]?.style;
}

// Heavier styles win a shared edge `[to verify: Excel's precedence on screen]`.
const WEIGHT: Readonly<Record<string, number>> = {
  hair: 1, dotted: 2, dashDotDot: 3, dashDot: 4, dashed: 5, thin: 6, mediumDashDotDot: 7,
  slantDashDot: 8, mediumDashDot: 9, mediumDashed: 10, medium: 11, double: 12, thick: 13,
};
/** The edge between `before` (upper/left cell) and `after` (lower/right cell); the later cell wins a tie. */
function winner(before: RenderBorder | undefined, after: RenderBorder | undefined): RenderBorder | undefined {
  if (!before) return after;
  if (!after) return before;
  return (WEIGHT[before.style] ?? 0) > (WEIGHT[after.style] ?? 0) ? before : after;
}

function prevVisible(offsets: Float64Array, i: number): number {
  for (let j = i - 1; j >= 0; j--) if (offsets[j + 1]! - offsets[j]! > 0) return j;
  return -1;
}
function nextVisible(offsets: Float64Array, n: number, i: number): number {
  for (let j = i + 1; j < n; j++) if (offsets[j + 1]! - offsets[j]! > 0) return j;
  return -1;
}

function edgesAt(st: State, r: number, c: number, own: RenderStyle): RenderEdges {
  const edges: RenderEdges = {};
  const up = prevVisible(st.rowTops, r);
  const left = prevVisible(st.colLefts, c);
  const top = up >= 0 ? winner(styleOf(st, modelStyle(st, up, c)).border.bottom, own.border.top) : own.border.top;
  const lft = left >= 0 ? winner(styleOf(st, modelStyle(st, r, left)).border.right, own.border.left) : own.border.left;
  if (top) edges.top = top;
  if (lft) edges.left = lft;
  if (nextVisible(st.colLefts, st.cols, c) < 0 && own.border.right) edges.right = own.border.right;
  if (nextVisible(st.rowTops, st.rows, r) < 0 && own.border.bottom) edges.bottom = own.border.bottom;
  return edges;
}

// ---------------------------------------------------------------------------
// Cells

const PREFIXES = ["_xlfn._xlws.", "_xlfn.", "_xlpm.", "_xlws."];

/** '=' + formula with Excel's storage prefixes removed outside string literals. */
function displayFormula(f: string): string {
  let out = "=";
  let inString = false;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i]!;
    if (ch === '"') inString = !inString;
    if (!inString && ch === "_") {
      const p = PREFIXES.find((x) => f.slice(i, i + x.length).toLowerCase() === x);
      if (p) {
        i += p.length - 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function typeOf(cell: Cell): CellType {
  if (cell.type) return cell.type;
  const v = cell.value;
  if (v === null || v === undefined) return "empty";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (v instanceof Date) return "date";
  return "error" in v ? "error" : "richText";
}

const alignFor = (t: CellType): "left" | "center" | "right" => (t === "number" || t === "date" ? "right" : t === "boolean" || t === "error" ? "center" : "left");
const argbToHex = (s: string | undefined): string | undefined => (s && /^[0-9a-f]{8}$/i.test(s) ? `#${s.slice(2).toUpperCase()}` : undefined);

function sheetRef(st: State, text: string): { sheet: number | null; ref: string } {
  const bang = text.lastIndexOf("!");
  const ref = (bang === -1 ? text : text.slice(bang + 1)).replace(/\$/g, "");
  if (bang === -1) return { sheet: st.wb.sheets.indexOf(st.sh), ref };
  let name = text.slice(0, bang);
  if (name.startsWith("'") && name.endsWith("'")) name = name.slice(1, -1).replace(/''/g, "'");
  const i = st.wb.sheets.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
  return { sheet: i === -1 ? null : i, ref };
}

function hyperlink(st: State, h: Cell["hyperlink"]): RenderHyperlink | undefined {
  if (h === undefined) return undefined;
  const tooltip = typeof h === "object" ? h.tooltip : undefined;
  const tip = tooltip === undefined ? {} : { tooltip };
  if (typeof h === "object" && "location" in h) {
    const loc = h.location.replace(/^#/, "");
    const named = st.wb.definedNames?.find((d) => d.name.toLowerCase() === loc.toLowerCase());
    const { sheet, ref } = sheetRef(st, named ? named.ref : loc);
    let valid = true;
    try {
      decodeRange(ref);
    } catch {
      valid = false;
    }
    return { kind: "internal", sheet: valid ? sheet : null, ref, ...tip };
  }
  const href = (typeof h === "string" ? h : h.target).trim();
  // eslint-disable-next-line no-control-regex
  const scheme = /[\u0000-\u001f\u007f]/.test(href) ? undefined : /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1];
  if (!scheme) return { kind: "external", href, allowed: false, reason: "malformed", ...tip };
  if (!st.schemes.has(scheme.toLowerCase())) return { kind: "external", href, allowed: false, reason: "scheme", ...tip };
  return { kind: "external", href, allowed: true, ...tip };
}

function computeCell(st: State, r: number, c: number): RenderCell | null {
  const m = mergeIndex(st, r, c);
  if (m && (m.r0 !== r || m.c0 !== c)) return null;
  const raw = st.sh.rows[r]?.[c];
  const cell = asCell(raw);
  const ownStyle = cell?.style ?? st.sh.rowProps?.[r]?.style ?? st.sh.colProps?.[c]?.style;
  const style = styleOf(st, ownStyle);
  const edges = edgesAt(st, r, c, style);
  const hasEdges = edges.top !== undefined || edges.left !== undefined || edges.right !== undefined || edges.bottom !== undefined;
  if (!cell && !ownStyle && !m && !hasEdges) return null;

  const base = cell ?? {};
  const type = typeOf(base);
  const out: RenderCell = { text: "", value: base.value ?? null, type, style, edges, align: alignFor(type) };
  if (m) out.merge = { rows: m.r1 - m.r0 + 1, cols: m.c1 - m.c0 + 1 };
  if (base.formula !== undefined) {
    out.formula = displayFormula(base.formula);
    if (base.arrayRef) out.arrayFormula = true;
  }
  const noValue = base.value === null || base.value === undefined;
  if (base.formula !== undefined && noValue) out.noCachedValue = true;
  else if (!noValue) {
    if (st.format) {
      const f = st.format(base, { locale: st.locale, date1904: st.wb.date1904, indexedColors: st.wb.indexedColors });
      out.text = f.text;
      if (f.align) out.align = f.align;
      const color = argbToHex(f.color);
      if (color) out.color = color;
      if (f.fill) out.fill = f.fill;
    } else out.text = cellText(base);
    const v = base.value;
    if (v && typeof v === "object" && "richText" in v) {
      out.runs = v.richText.map((run) => ({ text: run.text, font: run.font ? buildFont(st, { ...ownStyle?.font, ...run.font }) : style.font }));
    }
  }
  const link = hyperlink(st, base.hyperlink);
  if (link) out.hyperlink = link;
  return out;
}

/** What to draw at (row, col), or null when there is nothing (§5.8.2). Covered merge cells are null. */
export function renderCell(s: RenderSheet, row: number, col: number): RenderCell | null {
  const st = state(s);
  if (!(row >= 0 && row < st.rows && col >= 0 && col < st.cols)) return null;
  const k = key(row, col);
  if (st.cells.has(k)) return st.cells.get(k)!;
  const out = computeCell(st, row, col);
  // Clearing beats evicting one entry at a time: deleting a Map's oldest keys makes later lookups skip their tombstones.
  if (st.cells.size >= CELL_CACHE) st.cells.clear();
  st.cells.set(k, out);
  return out;
}

// ---------------------------------------------------------------------------
// Navigation

/** A movement direction for `step` and `edge`. */
export type RenderDirection = "up" | "down" | "left" | "right";
type Dir = RenderDirection;

function anchorOf(st: State, r: number, c: number): CellRef {
  const m = mergeIndex(st, r, c);
  return m ? { row: m.r0, col: m.c0 } : { row: r, col: c };
}

function isEmpty(st: State, r: number, c: number): boolean {
  const m = mergeIndex(st, r, c);
  const cell = asCell(m ? st.sh.rows[m.r0]?.[m.c0] : st.sh.rows[r]?.[c]);
  return !cell || ((cell.value === null || cell.value === undefined) && cell.formula === undefined);
}

/** The next visible index from `i` in the direction, skipping the merge `i` sits in; -1 at the edge. */
function nextIndex(st: State, from: CellRef, dir: Dir): number {
  const m = mergeIndex(st, from.row, from.col);
  const vertical = dir === "up" || dir === "down";
  const offsets = vertical ? st.rowTops : st.colLefts;
  const n = vertical ? st.rows : st.cols;
  if (dir === "down") return nextVisible(offsets, n, m ? m.r1 : from.row);
  if (dir === "up") return prevVisible(offsets, m ? m.r0 : from.row);
  if (dir === "right") return nextVisible(offsets, n, m ? m.c1 : from.col);
  return prevVisible(offsets, m ? m.c0 : from.col);
}

const moveTo = (from: CellRef, dir: Dir, i: number): CellRef => (dir === "up" || dir === "down" ? { row: i, col: from.col } : { row: from.row, col: i });

/** Arrow keys: the next visible cell, merge-aware; stays put at the edge. */
export function step(s: RenderSheet, from: CellRef, dir: Dir): CellRef {
  const st = state(s);
  const start = { row: clampTo(from.row, st.rows - 1), col: clampTo(from.col, st.cols - 1) };
  const i = nextIndex(st, start, dir);
  if (i < 0) return anchorOf(st, start.row, start.col);
  const to = moveTo(start, dir, i);
  return anchorOf(st, to.row, to.col);
}

/** Ctrl+arrow: Excel's data-region edge (§5.8.3). */
export function edge(s: RenderSheet, from: CellRef, dir: Dir): CellRef {
  const st = state(s);
  let cur = { row: clampTo(from.row, st.rows - 1), col: clampTo(from.col, st.cols - 1) };
  let i = nextIndex(st, cur, dir);
  if (i < 0) return anchorOf(st, cur.row, cur.col);
  let next = moveTo(cur, dir, i);
  if (!isEmpty(st, cur.row, cur.col) && !isEmpty(st, next.row, next.col)) {
    // Run to the last non-empty cell of the block.
    while (true) {
      cur = next;
      i = nextIndex(st, cur, dir);
      if (i < 0) break;
      next = moveTo(cur, dir, i);
      if (isEmpty(st, next.row, next.col)) break;
    }
    return anchorOf(st, cur.row, cur.col);
  }
  // Jump to the next non-empty cell, or the edge.
  while (isEmpty(st, next.row, next.col)) {
    i = nextIndex(st, next, dir);
    if (i < 0) break;
    next = moveTo(next, dir, i);
  }
  return anchorOf(st, next.row, next.col);
}

/** Ctrl+End: the last row and column of the used range. */
export function lastUsedCell(s: RenderSheet): CellRef {
  const st = state(s);
  return { row: Math.max(0, st.usedRows - 1), col: Math.max(0, st.usedCols - 1) };
}

// ---------------------------------------------------------------------------
// Copy and summary

function clampRange(st: State, range: RangeRef): RangeRef {
  const r0 = clampTo(Math.min(range.start.row, range.end.row), st.rows - 1);
  const r1 = clampTo(Math.max(range.start.row, range.end.row), st.rows - 1);
  const c0 = clampTo(Math.min(range.start.col, range.end.col), st.cols - 1);
  const c1 = clampTo(Math.max(range.start.col, range.end.col), st.cols - 1);
  return { start: { row: r0, col: c0 }, end: { row: r1, col: c1 } };
}

const tsvField = (t: string): string => (/[\t\r\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);

/** text/plain for the clipboard: TAB between cells, CRLF between rows (§5.8.4). */
export function rangeAsTsv(s: RenderSheet, range: RangeRef, options?: { values?: "displayed" | "raw" | undefined }): string {
  const st = state(s);
  const { start, end } = clampRange(st, range);
  const raw = options?.values === "raw";
  const lines: string[] = [];
  for (let r = start.row; r <= end.row; r++) {
    const fields: string[] = [];
    for (let c = start.col; c <= end.col; c++) {
      const cell = renderCell(s, r, c);
      const text = !cell ? "" : raw ? (cell.value === null ? "" : cellText({ value: cell.value })) : cell.text;
      fields.push(tsvField(text));
    }
    lines.push(fields.join("\t"));
  }
  return lines.join("\r\n");
}

const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const cssFamily = (f: string): string => `"${f.replace(/["\\]/g, "")}"`;
const borderCss = (b: RenderBorder): string => `${b.style === "thick" ? 3 : b.style === "medium" || b.style.startsWith("medium") ? 2 : 1}px ${b.style === "double" ? "double" : b.style === "dotted" || b.style === "hair" ? "dotted" : /dash/i.test(b.style) ? "dashed" : "solid"} ${b.color}`;

/** text/html for the clipboard: an escaped <table> with inline styles (§5.8.4). */
export function rangeAsHtml(s: RenderSheet, range: RangeRef): string {
  const st = state(s);
  const { start, end } = clampRange(st, range);
  let html = "<table>";
  for (let r = start.row; r <= end.row; r++) {
    html += "<tr>";
    for (let c = start.col; c <= end.col; c++) {
      const m = mergeIndex(st, r, c);
      const covered = m && (m.r0 !== r || m.c0 !== c);
      // A covered cell whose anchor is inside the range is spanned; one whose anchor is outside is an empty cell.
      if (covered && m.r0 >= start.row && m.c0 >= start.col) continue;
      const cell = covered ? null : renderCell(s, r, c);
      if (!cell) {
        html += "<td></td>";
        continue;
      }
      const f = cell.style.font;
      const css = [`font-family:${cssFamily(f.family)}`, `font-size:${f.sizePt}pt`, `color:${cell.color ?? f.color}`];
      if (f.bold) css.push("font-weight:bold");
      if (f.italic) css.push("font-style:italic");
      if (f.underline !== "none" || f.strike) css.push(`text-decoration:${[f.underline !== "none" ? "underline" : "", f.strike ? "line-through" : ""].filter(Boolean).join(" ")}`);
      if (cell.style.background.kind === "solid") css.push(`background-color:${cell.style.background.color}`);
      const h = cell.style.align.horizontal;
      css.push(`text-align:${h === "general" ? cell.align : h === "centerContinuous" ? "center" : h === "distributed" ? "justify" : h === "fill" ? "left" : h}`);
      css.push(`white-space:${cell.style.align.wrap ? "pre-wrap" : "pre"}`);
      for (const [sideName, b] of Object.entries(cell.style.border) as Array<[string, RenderBorder | undefined]>) {
        if (b && !sideName.startsWith("diagonal")) css.push(`border-${sideName}:${borderCss(b)}`);
      }
      let span = "";
      if (m) {
        const rows = Math.min(m.r1, end.row) - r + 1;
        const cols = Math.min(m.c1, end.col) - c + 1;
        if (rows > 1) span += ` rowspan="${rows}"`;
        if (cols > 1) span += ` colspan="${cols}"`;
      }
      html += `<td${span} style="${esc(css.join(";"))}">${esc(cell.text)}</td>`;
    }
    html += "</tr>";
  }
  return `${html}</table>`;
}

/** A status-bar summary of the cached values in a range (§5.8.4). */
export function rangeStats(s: RenderSheet, range: RangeRef, limit = 1_000_000): RangeStats {
  const st = state(s);
  const { start, end } = clampRange(st, range);
  let count = 0;
  let numericCount = 0;
  let sum = 0;
  let scanned = 0;
  let truncated = false;
  outer: for (let r = start.row; r <= end.row; r++) {
    const row = st.sh.rows[r];
    for (let c = start.col; c <= end.col; c++) {
      if (++scanned > limit) {
        truncated = true;
        break outer;
      }
      const cell = asCell(row?.[c]);
      const v = cell?.value;
      if (v === null || v === undefined) continue;
      const m = mergeIndex(st, r, c);
      if (m && (m.r0 !== r || m.c0 !== c)) continue;
      count++;
      let n: number | undefined;
      if (typeof v === "number") n = v;
      else if (v instanceof Date) {
        try {
          n = dateToSerial(v, { date1904: st.wb.date1904 });
        } catch {
          n = undefined;
        }
      }
      if (n !== undefined && Number.isFinite(n)) {
        numericCount++;
        sum += n;
      }
    }
  }
  return { count, numericCount, sum, average: numericCount ? sum / numericCount : null, truncated };
}
