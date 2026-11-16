/**
 * javascript-excel/dom: HTML table input and file download (docs/api.md §5.4).
 *
 * The only module that touches the DOM. Importing it never reads a global, so
 * it is safe during server-side rendering; the DOM is used only inside the
 * functions, and a table is read through its own window (iframes work).
 */

import { autoWidths, type AutoWidthOptions } from "./auto-width";
import type { BlobType } from "./binary";
import { EnvironmentError, ValidationError } from "./errors";
import { cssColor } from "./internal/css-color";
import { isElement, TEXT_NODE, type AnchorLike, type ElementLike, type NodeLike, type WindowLike } from "./internal/dom-types";
import { DEFAULT_HYPERLINK_SCHEMES, hyperlinkSchemes } from "./internal/write/sheet-features";
import type { CellInput, CellValue, Color, Hyperlink, Sheet, Style } from "./model";
import { validateSheetName } from "./sheet-names";
import { mergeStyles } from "./styles";
import type { ExcelWarning } from "./warnings";

export type { AutoWidthOptions } from "./auto-width";
export type { CellInput, Sheet, Style } from "./model";
export type { ExcelWarning, ExcelWarningCode } from "./warnings";
export type { BlobType } from "./binary";

/** `HTMLTableElement` when the consumer has DOM types, else `object`. */
export type TableElement = typeof globalThis extends { HTMLTableElement: { prototype: infer T } } ? T : object;
/** `HTMLTableCellElement` when the consumer has DOM types, else `object`. */
export type TableCellElement = typeof globalThis extends { HTMLTableCellElement: { prototype: infer T } } ? T : object;

/** Options for `fromTable`. */
export interface FromTableOptions {
  /** Sheet name, default 'Sheet1'. An invalid name throws INVALID_SHEET_NAME (§12 Q19). */
  name?: string | undefined;
  /** Header rows: 'thead' (default: the rows of <thead>), a fixed number of rows, or false. */
  header?: "thead" | number | false | undefined;
  /** Base style of header rows; default { font: { bold: true } }. */
  headerStyle?: Style | undefined;
  /** Include <tfoot> rows (last). Default true. */
  includeFooter?: boolean | undefined;
  /** Skip rows and cells with the `hidden` attribute or inline display:none (with styles: 'computed', also computed display:none). Default true. */
  skipHidden?: boolean | undefined;
  /** Rows and cells matching this selector are skipped. Default '[data-export-ignore]'. */
  ignore?: string | undefined;
  /** 'none' (default) or 'computed': map computed styles to cell styles. */
  styles?: "none" | "computed" | undefined;
  /** Turn plain numbers and TRUE/FALSE text into numbers and booleans. Default false. */
  inferTypes?: boolean | undefined;
  /** The first <a href> in a cell becomes its hyperlink. Default true. */
  links?: boolean | undefined;
  /** Link schemes kept; others are dropped with a HYPERLINK_DROPPED warning. Default ['http', 'https', 'mailto']. */
  hyperlinkSchemes?: string[] | undefined;
  /** Freeze the header rows. */
  freezeHeader?: boolean | undefined;
  /** Autofilter over the last header row and the body. Needs at least one header row. */
  autoFilter?: boolean | undefined;
  /** Estimate column widths from the text. */
  autoWidth?: boolean | AutoWidthOptions | undefined;
  /** Per-cell hook: return a CellInput to use instead of the default mapping, or undefined to keep it. */
  cell?: ((el: TableCellElement, ctx: { row: number; col: number; header: boolean }) => CellInput | undefined) | undefined;
  /** Called for data problems that do not stop the conversion (COERCION_FAILED, HYPERLINK_DROPPED). */
  onWarning?: ((w: ExcelWarning) => void) | undefined;
}

/** Options for `download`. */
export interface DownloadOptions {
  /** Content type. Default from the data: a Blob keeps its own; otherwise from the file extension (.xlsx, .csv), else text/plain for strings and application/octet-stream for bytes. */
  mimeType?: string | undefined;
}

const DEFAULT_IGNORE = "[data-export-ignore]";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** HTML's limits on colspan and rowspan. */
const MAX_COLSPAN = 1000;
const MAX_ROWSPAN = 65534;

// --------------------------------------------------------------- download

/**
 * How long the object URL stays valid after the click. Browsers start the
 * download asynchronously, and Safari needs the URL for a while; 40 s is the
 * delay FileSaver.js uses. Not measured here.
 */
export const DOWNLOAD_REVOKE_DELAY_MS = 40_000;

interface DomGlobals {
  document?: {
    createElement(tag: string): { href: string; download: string; rel: string; style: { display: string }; click(): void; remove(): void };
    body: { appendChild(n: unknown): unknown } | null;
  };
  URL?: { createObjectURL(b: unknown): string; revokeObjectURL(u: string): void };
  Blob?: new (parts: unknown[], opts?: { type?: string }) => BlobType & { readonly type: string };
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

function mimeFor(filename: string, data: unknown): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase();
  if (ext === "xlsx") return XLSX_MIME;
  if (ext === "csv") return "text/csv;charset=utf-8";
  return typeof data === "string" ? "text/plain;charset=utf-8" : "application/octet-stream";
}

/**
 * Saves data as a file in the browser: creates an object URL, clicks a
 * temporary `<a download>` and revokes the URL after DOWNLOAD_REVOKE_DELAY_MS.
 * A string is encoded as UTF-8. Throws ENVIRONMENT_UNSUPPORTED without a DOM.
 */
export function download(data: Uint8Array | BlobType | string, filename: string, options?: DownloadOptions): void {
  const g = globalThis as unknown as DomGlobals;
  const doc = g.document;
  if (!doc?.body || typeof g.URL?.createObjectURL !== "function" || typeof g.Blob !== "function") {
    throw new EnvironmentError("ENVIRONMENT_UNSUPPORTED", "download() needs a browser DOM (document, URL.createObjectURL, Blob).", {
      details: { api: "document" },
    });
  }
  if (typeof filename !== "string" || filename.length === 0) throw new TypeError("download(): filename must be a non-empty string");
  const Blob = g.Blob;
  const isBlob = typeof data === "object" && data !== null && !(data instanceof Uint8Array);
  let blob: BlobType & { readonly type: string };
  if (isBlob) {
    const b = data as BlobType & { readonly type: string };
    blob = options?.mimeType && b.type !== options.mimeType ? new Blob([b], { type: options.mimeType }) : b;
  } else {
    blob = new Blob([data], { type: options?.mimeType ?? mimeFor(filename, data) });
  }
  const url = g.URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  doc.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    const revoke = (): void => g.URL!.revokeObjectURL(url);
    if (typeof g.setTimeout === "function") g.setTimeout(revoke, DOWNLOAD_REVOKE_DELAY_MS);
    else revoke();
  }
}

// -------------------------------------------------------------- fromTable

interface Ctx {
  view: WindowLike | null;
  computed: boolean;
  skipHidden: boolean;
  ignore: string;
  inferTypes: boolean;
  links: boolean;
  schemes: ReadonlySet<string>;
  sheet: string;
  warn: (w: ExcelWarning) => void;
}

function css(ctx: Ctx, el: ElementLike, prop: string): string {
  if (!ctx.view) return "";
  try {
    return ctx.view.getComputedStyle(el).getPropertyValue(prop).trim();
  } catch {
    return "";
  }
}

function inlineDisplayNone(el: ElementLike): boolean {
  const style = el.getAttribute("style");
  return style !== null && /(?:^|;)\s*display\s*:\s*none\s*(?:!important\s*)?(?:;|$)/i.test(style);
}

function skipped(ctx: Ctx, el: ElementLike): boolean {
  if (el.matches(ctx.ignore)) return true;
  if (!ctx.skipHidden) return false;
  if (el.hasAttribute("hidden") || inlineDisplayNone(el)) return true;
  return ctx.computed && css(ctx, el, "display") === "none";
}

const SKIP_TEXT = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

/** Text of a cell: whitespace collapsed per line, <br> as a newline. */
function cellTextOf(el: ElementLike): { text: string; hasBreak: boolean } {
  const lines: string[] = [""];
  let hasBreak = false;
  const walk = (n: NodeLike): void => {
    if (n.nodeType === TEXT_NODE) {
      lines[lines.length - 1] += n.textContent ?? "";
      return;
    }
    if (!isElement(n)) return;
    const tag = n.tagName.toUpperCase();
    if (SKIP_TEXT.has(tag)) return;
    if (tag === "BR") {
      lines.push("");
      hasBreak = true;
      return;
    }
    for (let i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]!);
  };
  for (let i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i]!);
  const text = lines.map((l) => l.replace(/[ \t\n\r\f ]+/g, " ").trim()).join("\n");
  return { text: text.replace(/^\n+|\n+$/g, ""), hasBreak };
}

const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const GROUPED_NUMBER = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function parseNumber(s: string): number | undefined {
  const t = s.trim();
  if (PLAIN_NUMBER.test(t)) return Number(t);
  if (GROUPED_NUMBER.test(t)) return Number(t.replace(/,/g, ""));
  return undefined;
}

function parseBoolean(s: string): boolean | undefined {
  const t = s.trim().toLowerCase();
  if (t === "true" || t === "yes" || t === "1") return true;
  if (t === "false" || t === "no" || t === "0") return false;
  return undefined;
}

/** ISO 8601 date or date-time. Without a zone, the local wall-clock time (dateZone 'local'). */
function parseDate(s: string): Date | undefined {
  const m = ISO_DATE.exec(s.trim());
  if (!m) return undefined;
  const [y, mo, d, h = "0", mi = "0", sec = "0", ms = "0", zone] = m.slice(1);
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec), Number(ms.padEnd(3, "0"))] as const;
  let date: Date;
  if (zone) {
    const off = zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    date = new Date(Date.UTC(...parts) - off * 60_000);
  } else {
    date = new Date(...parts);
  }
  // Reject overflow such as 2024-02-30 (checked on the wall-clock fields).
  const wall = zone ? new Date(Date.UTC(...parts)) : date;
  const [month, day] = zone ? [wall.getUTCMonth(), wall.getUTCDate()] : [wall.getMonth(), wall.getDate()];
  if (month !== parts[1] || day !== parts[2]) return undefined;
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function coerce(ctx: Ctx, raw: string, type: string | null, ref: string): CellValue {
  if (type === null || type === "" || type === "string") {
    if (ctx.inferTypes) {
      const n = PLAIN_NUMBER.test(raw.trim()) ? Number(raw.trim()) : undefined;
      if (n !== undefined && Number.isFinite(n)) return n;
      const t = raw.trim().toLowerCase();
      if (t === "true") return true;
      if (t === "false") return false;
    }
    return raw;
  }
  const fail = (): string => {
    ctx.warn({ code: "COERCION_FAILED", message: `${ctx.sheet}!${ref}: ${JSON.stringify(raw)} is not a valid ${type}; kept as text.`, sheet: ctx.sheet, ref });
    return raw;
  };
  switch (type) {
    case "number": {
      const n = parseNumber(raw);
      return n !== undefined && Number.isFinite(n) ? n : fail();
    }
    case "boolean": {
      const b = parseBoolean(raw);
      return b ?? fail();
    }
    case "date": {
      const d = parseDate(raw);
      return d ?? fail();
    }
    default:
      ctx.warn({ code: "COERCION_FAILED", message: `${ctx.sheet}!${ref}: unknown data-type ${JSON.stringify(type)}; kept as text.`, sheet: ctx.sheet, ref });
      return raw;
  }
}

// ---- computed styles

/** The first non-transparent background of the cell, its row, section or table (what a reader sees). */
function backgroundOf(ctx: Ctx, cell: ElementLike, table: ElementLike): string | undefined {
  for (let el: ElementLike | null = cell; el; el = el.parentElement) {
    const c = cssColor(css(ctx, el, "background-color"));
    if (c) return c;
    if (el === table) break;
  }
  return undefined;
}

function computedStyle(ctx: Ctx, el: ElementLike, table: ElementLike): Style | undefined {
  const style: Style = {};
  const font: NonNullable<Style["font"]> = {};
  const weight = css(ctx, el, "font-weight");
  if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) font.bold = true;
  const fs = css(ctx, el, "font-style");
  if (fs === "italic" || fs.startsWith("oblique")) font.italic = true;
  const deco = `${css(ctx, el, "text-decoration-line")} ${css(ctx, el, "text-decoration")}`;
  if (/\bunderline\b/.test(deco)) font.underline = true;
  if (/\bline-through\b/.test(deco)) font.strike = true;
  const color = cssColor(css(ctx, el, "color"));
  if (color && color !== "000000") font.color = color as Color;
  if (Object.keys(font).length) style.font = font;
  const bg = backgroundOf(ctx, el, table);
  if (bg) style.fill = bg;
  const alignment: NonNullable<Style["alignment"]> = {};
  // Only explicit alignments are mapped. 'start'/'end' (the computed default) follow the text
  // direction, which Excel's general alignment does too; `<th>` computes to a vendor 'center'.
  const ta = css(ctx, el, "text-align");
  const h = /^(?:-webkit-|-internal-|-moz-)?center$/.test(ta) ? "center" : ta;
  if (h === "left" || h === "right" || h === "center" || h === "justify") alignment.horizontal = h;
  // 'middle' is the HTML table default (UA stylesheet), so it is not mapped; top and bottom are.
  const va = css(ctx, el, "vertical-align");
  if (va === "top" || va === "bottom") alignment.vertical = va;
  const ws = css(ctx, el, "white-space");
  if (ws === "pre-wrap" || ws === "pre-line" || ws === "break-spaces") alignment.wrapText = true;
  if (Object.keys(alignment).length) style.alignment = alignment;
  return Object.keys(style).length ? style : undefined;
}

function linkOf(ctx: Ctx, cell: ElementLike, ref: string): Hyperlink | undefined {
  const find = (n: ElementLike): AnchorLike | undefined => {
    for (let i = 0; i < n.children.length; i++) {
      const c = n.children[i]!;
      if (c.tagName.toUpperCase() === "A" && c.hasAttribute("href")) return c as AnchorLike;
      const deeper = find(c);
      if (deeper) return deeper;
    }
    return undefined;
  };
  const a = find(cell);
  if (!a) return undefined;
  const raw = a.getAttribute("href") ?? "";
  if (raw.startsWith("#") || raw.trim() === "") return undefined; // in-page anchors have no meaning in a workbook
  const url = typeof a.href === "string" && a.href ? a.href : raw;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url)?.[1]?.toLowerCase();
  if (!scheme || !ctx.schemes.has(scheme)) {
    ctx.warn({ code: "HYPERLINK_DROPPED", message: `${ctx.sheet}!${ref}: link ${JSON.stringify(url)} dropped (scheme not allowed).`, sheet: ctx.sheet, ref });
    return undefined;
  }
  return url;
}

/** Rows in reading order: <thead> rows, then <tbody> and bare <tr> rows, then <tfoot> rows. */
function collectRows(table: ElementLike, includeFooter: boolean): { rows: ElementLike[]; sections: number[] } {
  const head: ElementLike[][] = [];
  const body: ElementLike[][] = [];
  const foot: ElementLike[][] = [];
  const bare: ElementLike[] = [];
  const trs = (section: ElementLike): ElementLike[] => Array.from(section.children).filter((c) => c.tagName.toUpperCase() === "TR");
  for (const child of Array.from(table.children)) {
    const tag = child.tagName.toUpperCase();
    if (tag === "THEAD") head.push(trs(child));
    else if (tag === "TBODY") {
      if (bare.length) body.push(bare.splice(0));
      body.push(trs(child));
    } else if (tag === "TFOOT") {
      if (includeFooter) foot.push(trs(child));
    } else if (tag === "TR") bare.push(child);
  }
  if (bare.length) body.push(bare);
  const groups = [...head, ...body, ...foot];
  const rows = groups.flat();
  // Section index per row, for rowspan="0" (span to the end of the row group).
  const sections: number[] = [];
  groups.forEach((g, i) => g.forEach(() => sections.push(i)));
  return { rows, sections };
}

function intAttr(el: ElementLike, name: string, fallback: number, min: number, max: number): number {
  const v = el.getAttribute(name);
  if (v === null) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Reads an HTML table into a Sheet: values, merges from colspan/rowspan, hints, links and (optionally) styles. */
export function fromTable(table: TableElement, options: FromTableOptions = {}): Sheet {
  const t = table as unknown as ElementLike;
  if (typeof t !== "object" || t === null || typeof t.tagName !== "string" || typeof t.matches !== "function") {
    throw new EnvironmentError("ENVIRONMENT_UNSUPPORTED", "fromTable() needs a DOM <table> element.", { details: { api: "HTMLTableElement" } });
  }
  if (t.tagName.toUpperCase() !== "TABLE") throw new TypeError(`fromTable(): expected a <table> element, got <${t.tagName.toLowerCase()}>`);
  const name = options.name ?? "Sheet1";
  const problem = validateSheetName(name);
  if (problem) throw new ValidationError("INVALID_SHEET_NAME", `fromTable(): sheet name ${JSON.stringify(name)} is invalid (${problem}).`, { details: { sheet: name, problem } });

  const ctx: Ctx = {
    view: t.ownerDocument?.defaultView ?? null,
    computed: options.styles === "computed",
    skipHidden: options.skipHidden !== false,
    ignore: options.ignore ?? DEFAULT_IGNORE,
    inferTypes: options.inferTypes === true,
    links: options.links !== false,
    schemes: options.hyperlinkSchemes === undefined ? new Set(DEFAULT_HYPERLINK_SCHEMES) : hyperlinkSchemes(options.hyperlinkSchemes),
    sheet: name,
    warn: options.onWarning ?? ((): void => {}),
  };
  const rtl = t.closest("[dir]")?.getAttribute("dir")?.toLowerCase() === "rtl" || (ctx.computed && css(ctx, t, "direction") === "rtl");

  const { rows: allRows, sections: allSections } = collectRows(t, options.includeFooter !== false);
  const header = options.header ?? "thead";
  const headerStyle = options.headerStyle ?? { font: { bold: true } };

  const out: CellInput[][] = [];
  const merges: string[] = [];
  const occupied: boolean[][] = [];
  const occupy = (r: number, c: number): void => {
    (occupied[r] ??= [])[c] = true;
  };
  const kept = allRows.map((tr, i) => ({ tr, section: allSections[i]! })).filter(({ tr }) => !skipped(ctx, tr));
  const headerCount = header === "thead" ? kept.filter(({ tr }) => tr.parentElement?.tagName.toUpperCase() === "THEAD").length : header === false ? 0 : Math.max(0, Math.trunc(header));
  let maxCol = -1;

  kept.forEach(({ tr, section }, r) => {
    const row: CellInput[] = (out[r] ??= []);
    let c = 0;
    for (const cell of Array.from(tr.children)) {
      const tag = cell.tagName.toUpperCase();
      if (tag !== "TD" && tag !== "TH") continue;
      if (skipped(ctx, cell)) continue;
      while (occupied[r]?.[c]) c++;
      const colspan = intAttr(cell, "colspan", 1, 1, MAX_COLSPAN);
      let rowspan = intAttr(cell, "rowspan", 1, 0, MAX_ROWSPAN);
      if (rowspan === 0) {
        // rowspan="0": to the end of the row group.
        let end = r;
        while (end + 1 < kept.length && kept[end + 1]!.section === section) end++;
        rowspan = end - r + 1;
      }
      rowspan = Math.min(rowspan, kept.length - r);
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) occupy(r + dr, c + dc);
      const ref = `${colName(c)}${r + 1}`;
      if (colspan > 1 || rowspan > 1) merges.push(`${ref}:${colName(c + colspan - 1)}${r + rowspan}`);
      const isHeader = r < headerCount;

      const hooked = options.cell?.(cell as unknown as TableCellElement, { row: r, col: c, header: isHeader });
      if (hooked !== undefined) {
        row[c] = hooked;
      } else {
        const dataValue = cell.getAttribute("data-value");
        const { text, hasBreak } = cellTextOf(cell);
        const value = coerce(ctx, dataValue ?? text, cell.getAttribute("data-type"), ref);
        const layers: Array<Style | undefined> = [];
        if (isHeader) layers.push(headerStyle);
        if (ctx.computed) layers.push(computedStyle(ctx, cell, t));
        if (hasBreak) layers.push({ alignment: { wrapText: true } });
        const numFmt = cell.getAttribute("data-numfmt");
        if (numFmt) layers.push({ numFmt: /^\d+$/.test(numFmt) ? Number(numFmt) : numFmt });
        const style = layers.some(Boolean) ? mergeStyles(...layers) : undefined;
        const hyperlink = ctx.links ? linkOf(ctx, cell, ref) : undefined;
        const plain = style === undefined && hyperlink === undefined;
        row[c] = plain ? value : { value, ...(style ? { style } : {}), ...(hyperlink ? { hyperlink } : {}) };
      }
      maxCol = Math.max(maxCol, c + colspan - 1);
      c += colspan;
    }
  });

  const sheet: Sheet = { name, rows: out };
  if (merges.length) sheet.merges = merges;
  const view: NonNullable<Sheet["view"]> = {};
  if (rtl) view.rightToLeft = true;
  if (options.freezeHeader && headerCount > 0) view.freeze = { rows: headerCount };
  if (Object.keys(view).length) sheet.view = view;
  if (options.autoFilter && headerCount > 0 && maxCol >= 0) {
    sheet.autoFilter = `A${headerCount}:${colName(maxCol)}${Math.max(headerCount, out.length)}`;
  }
  if (options.autoWidth) {
    const widths = autoWidths(out, typeof options.autoWidth === "object" ? options.autoWidth : {});
    sheet.colProps = widths.map((width) => ({ width }));
  }
  return sheet;
}

function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
