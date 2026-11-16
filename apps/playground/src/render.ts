// Renders a sheet as an HTML table preview. Cell text always goes through
// textContent, never innerHTML: files on the Read tab are untrusted.
import { cellText, decodeRange, type Cell, type CellInput, type Color, type Sheet, type Style, type Theme } from "javascript-excel";

/** The default Office theme, for files without one: clrScheme order dk1, lt1, dk2, lt2, accent1–6, hlink, folHlink. */
const OFFICE_THEME = ["000000", "FFFFFF", "44546A", "E7E6E6", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
/** The first 16 colours of the legacy indexed palette (0–7 repeat 8–15). */
const INDEXED = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF"];

function applyTint(hex: string, tint: number): string {
  // Approximation of ECMA-376 tint (HSL luminance): blend towards white or black.
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((c) => Math.round(tint < 0 ? c * (1 + tint) : c + (255 - c) * tint));
  return out.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** A model colour as a CSS colour, or undefined for automatic/unknown. Basic resolution only. */
export function cssColor(color: Color | undefined, theme: Theme | undefined): string | undefined {
  if (color === undefined) return undefined;
  if (typeof color === "string") return `#${color.replace(/^#/, "").slice(-6)}`;
  if ("rgb" in color) return `#${color.rgb.slice(-6)}`;
  if ("theme" in color) {
    const scheme = theme?.colors.map((c) => c.slice(-6)) ?? OFFICE_THEME;
    // Theme index order swaps the first two pairs: 0 = lt1, 1 = dk1, 2 = lt2, 3 = dk2.
    const index = [1, 0, 3, 2][color.theme] ?? color.theme;
    const base = scheme[index];
    return base ? `#${color.tint ? applyTint(base, color.tint) : base}` : undefined;
  }
  if ("indexed" in color) {
    const base = INDEXED[color.indexed % 8];
    return base ? `#${base}` : undefined;
  }
  return undefined;
}

function applyStyle(td: HTMLTableCellElement, style: Style | undefined, theme: Theme | undefined): void {
  if (!style) return;
  const f = style.font;
  if (f?.bold) td.style.fontWeight = "700";
  if (f?.italic) td.style.fontStyle = "italic";
  const deco = [f?.underline ? "underline" : "", f?.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) td.style.textDecoration = deco;
  const color = cssColor(f?.color, theme);
  if (color) td.style.color = color;
  const fill = style.fill;
  const bg = typeof fill === "string" ? cssColor(fill, theme) : fill && "pattern" in fill && fill.pattern === "solid" ? cssColor(fill.fgColor, theme) : undefined;
  if (bg) td.style.backgroundColor = bg;
  const h = style.alignment?.horizontal;
  if (h === "left" || h === "center" || h === "right" || h === "justify") td.style.textAlign = h;
  const v = style.alignment?.vertical;
  if (v === "top" || v === "bottom") td.style.verticalAlign = v;
  else if (v === "center") td.style.verticalAlign = "middle";
  if (style.alignment?.wrapText) td.style.whiteSpace = "pre-wrap";
  if (style.numFmt !== undefined) td.title = `Number format: ${String(style.numFmt)}`;
}

const isCell = (c: CellInput): c is Cell => typeof c === "object" && c !== null && !(c instanceof Date) && !("error" in c) && !("richText" in c);

function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export interface RenderOptions {
  maxRows?: number;
  maxCols?: number;
  theme?: Theme | undefined;
  caption?: string;
}

/** A preview table of the sheet: headers A, B, … and 1, 2, …, merges as colspan/rowspan, basic styles. */
export function renderSheet(sheet: Sheet<CellInput>, options: RenderOptions = {}): HTMLElement {
  const maxRows = options.maxRows ?? 200;
  const maxCols = options.maxCols ?? 40;
  const rows = sheet.rows;
  const lastRow = Math.min(rows.length, maxRows);
  let lastCol = 0;
  for (let r = 0; r < lastRow; r++) lastCol = Math.max(lastCol, rows[r]?.length ?? 0);
  lastCol = Math.min(lastCol, maxCols);

  // Merges: the top-left cell spans; covered cells are skipped.
  const span = new Map<string, { rows: number; cols: number }>();
  const covered = new Set<string>();
  for (const m of sheet.merges ?? []) {
    const { start, end } = decodeRange(m);
    span.set(`${start.row}:${start.col}`, { rows: end.row - start.row + 1, cols: end.col - start.col + 1 });
    for (let r = start.row; r <= end.row; r++) for (let c = start.col; c <= end.col; c++) if (r !== start.row || c !== start.col) covered.add(`${r}:${c}`);
  }

  const wrap = document.createElement("div");
  wrap.className = "sheet-scroll";
  wrap.tabIndex = 0; // scrollable region reachable by keyboard
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", options.caption ?? `Sheet ${sheet.name}`);
  const table = document.createElement("table");
  table.className = "sheet";
  if (sheet.view?.rightToLeft) table.dir = "rtl";
  const caption = document.createElement("caption");
  caption.textContent = options.caption ?? sheet.name;
  table.append(caption);

  const thead = table.createTHead().insertRow();
  const corner = document.createElement("th");
  corner.scope = "col";
  corner.textContent = "";
  thead.append(corner);
  for (let c = 0; c < lastCol; c++) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = colName(c);
    thead.append(th);
  }
  const body = table.createTBody();
  for (let r = 0; r < lastRow; r++) {
    const tr = body.insertRow();
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = String(r + 1);
    tr.append(th);
    const row = rows[r];
    for (let c = 0; c < lastCol; c++) {
      if (covered.has(`${r}:${c}`)) continue;
      const td = tr.insertCell();
      const cell = row?.[c];
      td.textContent = cellText(cell);
      const s = span.get(`${r}:${c}`);
      if (s) {
        td.colSpan = Math.min(s.cols, lastCol - c);
        td.rowSpan = Math.min(s.rows, lastRow - r);
      }
      if (typeof cell === "number" || (isCell(cell) && (typeof cell.value === "number" || cell.value instanceof Date))) td.classList.add("num");
      if (isCell(cell)) {
        applyStyle(td, cell.style, options.theme);
        if (cell.formula) td.title = `${td.title ? `${td.title}\n` : ""}Formula: =${cell.formula}`;
      }
    }
  }
  wrap.append(table);
  if (rows.length > maxRows || lastCol === maxCols) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = `Preview shows the first ${lastRow} rows and ${lastCol} columns.`;
    const box = document.createElement("div");
    box.append(wrap, note);
    return box;
  }
  return wrap;
}
