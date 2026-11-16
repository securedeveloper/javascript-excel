/**
 * Sheet features (docs/api.md §3.3, §3.6, §3.7): column widths and styles,
 * row heights and styles, outline levels, merges, autofilter, sheet view
 * (freeze panes, RTL, zoom, selection), tab colour, default sizes,
 * hyperlinks, print setup and the defined names they imply.
 *
 * Everything is validated once, when the sheet is planned, and turned into
 * XML fragments the sheet writer places in schema order.
 */

import { decodeCell, decodeCol, decodeRange, encodeCell, encodeCol, MAX_COLS, MAX_ROWS, type RangeAddress } from "../../address";
import { ValidationError, type ExcelErrorCode } from "../../errors";
import type { Cell, ColumnWidth, Hyperlink, PrintSetup, Sheet, SheetView } from "../../model";
import { num, xmlAttr, xstring } from "../xml";
import { Rels, REL_TYPE } from "./package";
import type { StyleRegistry } from "./style-registry";

// ------------------------------------------------------------ widths

/** Maximum digit width of Calibri 11, the default font, in pixels [to verify for other default fonts]. */
export const MAX_DIGIT_WIDTH = 7;
/** Excel's default column width in characters (Calibri 11). */
export const DEFAULT_COL_WIDTH_CHARS = 8.43;
/** Excel's default row height in points (Calibri 11). */
export const DEFAULT_ROW_HEIGHT = 15;
/** Auto width bounds and padding, in characters. The 60 maximum is a readability choice, not a measurement. */
export const AUTO_WIDTH: { readonly min: number; readonly max: number; readonly padding: number } = { min: DEFAULT_COL_WIDTH_CHARS, max: 60, padding: 2 };

/** Characters (as Excel's UI shows them) to the file's `width` (ECMA-376 §18.3.1.13). */
export function charsToFileWidth(chars: number): number {
  if (chars <= 0) return 0;
  return Math.trunc(((chars * MAX_DIGIT_WIDTH + 5) / MAX_DIGIT_WIDTH) * 256) / 256;
}

/** Pixels at 96 dpi to characters (ECMA-376 §18.3.1.13). */
export function pixelsToChars(px: number): number {
  return Math.max(0, Math.trunc(((px - 5) / MAX_DIGIT_WIDTH) * 100 + 0.5) / 100);
}

/** East Asian wide and fullwidth characters, and emoji, count as two. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Estimated display width of text in characters: the widest line, wide characters counting two. */
export function textWidth(s: string): number {
  let max = 0;
  for (const line of s.split(/\r\n|\r|\n/)) {
    let w = 0;
    for (const ch of line) w += isWide(ch.codePointAt(0)!) ? 2 : 1;
    if (w > max) max = w;
  }
  return max;
}

// ------------------------------------------------------------ errors

export function sheetError(sheet: string, path: string, value: unknown, why: string, code: ExcelErrorCode = "INVALID_SHEET_PROPERTY"): ValidationError {
  return new ValidationError(code, `Sheet ${sheet}: ${path} ${why}.`, { details: { sheet, path, value } });
}

function checkNumber(sheet: string, path: string, v: unknown, min: number, max: number, integer = false): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
    throw sheetError(sheet, path, v, `must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`);
  }
  return v;
}

function checkBool(sheet: string, path: string, v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw sheetError(sheet, path, v, "must be a boolean");
  return v;
}

function checkRange(sheet: string, path: string, v: unknown): RangeAddress {
  try {
    return decodeRange(v as string);
  } catch {
    throw sheetError(sheet, path, v, "must be an A1 range such as 'A1:C3'", "INVALID_REF");
  }
}

function checkCellRef(sheet: string, path: string, v: unknown): string {
  try {
    return encodeCell(decodeCell(v as string));
  } catch {
    throw sheetError(sheet, path, v, "must be an A1 cell reference", "INVALID_REF");
  }
}

const absRange = (r: RangeAddress): string => {
  const a = `$${encodeCol(r.start.col)}$${r.start.row + 1}`;
  const b = `$${encodeCol(r.end.col)}$${r.end.row + 1}`;
  return a === b ? a : `${a}:${b}`;
};
const plainRange = (r: RangeAddress): string => {
  const a = encodeCell(r.start);
  const b = encodeCell(r.end);
  return a === b ? a : `${a}:${b}`;
};

/** A sheet name as it appears in a formula reference: always quoted, quotes doubled. */
export function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

// ------------------------------------------------------------ plan

export interface BuiltinName {
  name: "_xlnm._FilterDatabase" | "_xlnm.Print_Area" | "_xlnm.Print_Titles";
  ref: string;
  sheet: number;
  hidden: boolean;
}

interface ColSpec {
  width: number; // file units
  custom: boolean;
  bestFit: boolean;
  style: number;
  hidden: boolean;
  outlineLevel: number;
  collapsed: boolean;
}

/** Validated sheet features. Column widths marked 'auto' are measured during the cell scan. */
export class SheetFeatures {
  readonly name: string;
  readonly autoCols: Map<number, number> = new Map(); // column → widest text so far
  private readonly cols: Array<{ col: number; spec: Omit<ColSpec, "width" | "custom" | "bestFit">; width: ColumnWidth | undefined }> = [];
  /** Row attributes (without r) for rows with properties. */
  readonly rowAttrs: Map<number, string> = new Map();
  maxPropRow = -1;
  private readonly defaultColStyle: number;
  private readonly defaultColFileWidth: number;
  private maxOutlineCol = 0;
  private maxOutlineRow = 0;
  private readonly defaultRowHeight: number | undefined;
  private readonly defaultColWidthChars: number | undefined;
  readonly merges: string[] = [];
  readonly autoFilter: string | undefined;
  private readonly sheetPr: string;
  private readonly views: string;
  private readonly print: { options: string; margins: string; setup: string; headerFooter: string };
  readonly builtinNames: BuiltinName[] = [];

  constructor(sheet: Sheet, index: number, tabSelected: boolean, styles: StyleRegistry) {
    const name = sheet.name;
    this.name = name;

    this.defaultColWidthChars = checkNumber(name, "defaultColWidth", sheet.defaultColWidth, 0, 255);
    this.defaultRowHeight = checkNumber(name, "defaultRowHeight", sheet.defaultRowHeight, 0, 409);
    this.defaultColFileWidth = charsToFileWidth(this.defaultColWidthChars ?? DEFAULT_COL_WIDTH_CHARS);
    this.defaultColStyle = sheet.defaultStyle ? styles.xfFor([sheet.defaultStyle], false, { sheet: name }) : 0;

    // Columns.
    const colProps = sheet.colProps;
    if (colProps !== undefined) {
      if (!Array.isArray(colProps)) throw sheetError(name, "colProps", colProps, "must be an array");
      if (colProps.length > MAX_COLS) throw sheetError(name, "colProps", colProps.length, `has more than ${MAX_COLS} entries`, "OUT_OF_BOUNDS");
      for (let c = 0; c < colProps.length; c++) {
        const p = colProps[c];
        if (p === undefined || p === null) continue;
        const path = `colProps[${c}]`;
        if (typeof p !== "object") throw sheetError(name, path, p, "must be an object");
        const width = p.width;
        if (width !== undefined) this.checkWidth(`${path}.width`, width);
        if (width === "auto") this.autoCols.set(c, 0);
        const outlineLevel = checkNumber(name, `${path}.outlineLevel`, p.outlineLevel, 0, 7, true) ?? 0;
        this.maxOutlineCol = Math.max(this.maxOutlineCol, outlineLevel);
        const style = p.style ? styles.xfFor([sheet.defaultStyle, p.style], false, { sheet: name, ref: `${encodeCol(c)}:${encodeCol(c)}` }) : this.defaultColStyle;
        this.cols.push({
          col: c,
          width,
          spec: {
            style,
            hidden: checkBool(name, `${path}.hidden`, p.hidden) === true,
            outlineLevel,
            collapsed: checkBool(name, `${path}.collapsed`, p.collapsed) === true,
          },
        });
      }
    }

    // Rows with properties.
    const rowProps = sheet.rowProps;
    if (rowProps !== undefined) {
      if (!Array.isArray(rowProps)) throw sheetError(name, "rowProps", rowProps, "must be an array");
      for (let r = 0; r < rowProps.length; r++) {
        const p = rowProps[r];
        if (p === undefined || p === null) continue;
        const path = `rowProps[${r}]`;
        if (r >= MAX_ROWS) throw sheetError(name, path, r, `is beyond row ${MAX_ROWS}`, "OUT_OF_BOUNDS");
        if (typeof p !== "object") throw sheetError(name, path, p, "must be an object");
        let attrs = "";
        if (p.style) attrs += ` s="${styles.xfFor([sheet.defaultStyle, p.style], false, { sheet: name, ref: `${r + 1}:${r + 1}` })}" customFormat="1"`;
        const height = checkNumber(name, `${path}.height`, p.height, 0, 409);
        if (height !== undefined) attrs += ` ht="${num(height)}" customHeight="1"`;
        // As with columns, Excel hides a zero-height row and says so.
        if (checkBool(name, `${path}.hidden`, p.hidden) || height === 0) attrs += ' hidden="1"';
        const level = checkNumber(name, `${path}.outlineLevel`, p.outlineLevel, 0, 7, true);
        if (level) {
          attrs += ` outlineLevel="${level}"`;
          this.maxOutlineRow = Math.max(this.maxOutlineRow, level);
        }
        if (checkBool(name, `${path}.collapsed`, p.collapsed)) attrs += ' collapsed="1"';
        if (attrs) {
          this.rowAttrs.set(r, attrs);
          this.maxPropRow = r;
        }
      }
    }

    // Merges: valid ranges that do not overlap.
    if (sheet.merges !== undefined) {
      if (!Array.isArray(sheet.merges)) throw sheetError(name, "merges", sheet.merges, "must be an array of A1 ranges");
      const ranges = sheet.merges.map((m, i) => ({ r: checkRange(name, `merges[${i}]`, m), i }));
      const sorted = [...ranges].sort((a, b) => a.r.start.row - b.r.start.row);
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i]!.r;
        for (let j = i + 1; j < sorted.length; j++) {
          const b = sorted[j]!.r;
          if (b.start.row > a.end.row) break;
          if (b.start.col <= a.end.col && b.end.col >= a.start.col) {
            throw new ValidationError("OVERLAPPING_MERGE", `Sheet ${name}: merges ${plainRange(a)} and ${plainRange(b)} overlap.`, {
              details: { sheet: name, merges: [plainRange(a), plainRange(b)] },
            });
          }
        }
      }
      for (const { r } of ranges) {
        if (r.start.row === r.end.row && r.start.col === r.end.col) continue; // a one-cell merge is a no-op
        this.merges.push(plainRange(r));
      }
    }

    // Autofilter, with the hidden _FilterDatabase name Excel expects.
    if (sheet.autoFilter !== undefined) {
      const r = checkRange(name, "autoFilter", sheet.autoFilter);
      this.autoFilter = plainRange(r);
      this.builtinNames.push({ name: "_xlnm._FilterDatabase", ref: `${quoteSheet(name)}!${absRange(r)}`, sheet: index, hidden: true });
    }

    // Tab colour and fit-to-page live in sheetPr.
    let sheetPr = "";
    if (sheet.tabColor !== undefined) sheetPr += `<tabColor${styles.colorAttrs("tabColor", sheet.tabColor, { sheet: name })}/>`;
    if (sheet.print?.fitTo !== undefined) sheetPr += '<pageSetUpPr fitToPage="1"/>';
    this.sheetPr = sheetPr ? `<sheetPr>${sheetPr}</sheetPr>` : "";

    this.views = this.viewXml(sheet.view, tabSelected);
    this.print = this.printXml(sheet.print, index);
  }

  private checkWidth(path: string, w: unknown): void {
    if (w === "auto") return;
    if (typeof w === "number") {
      checkNumber(this.name, path, w, 0, 255);
      return;
    }
    if (typeof w === "object" && w !== null && "wch" in w) {
      checkNumber(this.name, `${path}.wch`, (w as { wch: unknown }).wch, 0, 255);
      return;
    }
    if (typeof w === "object" && w !== null && "wpx" in w) {
      const px = checkNumber(this.name, `${path}.wpx`, (w as { wpx: unknown }).wpx, 0, 255 * MAX_DIGIT_WIDTH + 5)!;
      void px;
      return;
    }
    throw sheetError(this.name, path, w, "must be a number of characters, { wch }, { wpx } or 'auto'");
  }

  /** Records a cell's text width for 'auto' columns. */
  measure(col: number, text: string): void {
    const cur = this.autoCols.get(col);
    if (cur === undefined) return;
    const w = textWidth(text);
    if (w > cur) this.autoCols.set(col, w);
  }

  private viewXml(view: SheetView | undefined, tabSelected: boolean): string {
    const name = this.name;
    let attrs = tabSelected ? ' tabSelected="1"' : "";
    let inner = "";
    if (view !== undefined) {
      if (typeof view !== "object" || view === null) throw sheetError(name, "view", view, "must be an object");
      if (checkBool(name, "view.showGridLines", view.showGridLines) === false) attrs += ' showGridLines="0"';
      if (checkBool(name, "view.showRowColHeaders", view.showRowColHeaders) === false) attrs += ' showRowColHeaders="0"';
      if (checkBool(name, "view.rightToLeft", view.rightToLeft)) attrs += ' rightToLeft="1"';
      const zoom = checkNumber(name, "view.zoom", view.zoom, 10, 400, true);
      if (zoom !== undefined && zoom !== 100) attrs += ` zoomScale="${zoom}" zoomScaleNormal="${zoom}"`;
      const activeCell = view.activeCell === undefined ? undefined : checkCellRef(name, "view.activeCell", view.activeCell);
      const selection = view.selection === undefined ? undefined : plainRange(checkRange(name, "view.selection", view.selection));

      const rows = checkNumber(name, "view.freeze.rows", view.freeze?.rows, 0, MAX_ROWS - 1, true) ?? 0;
      const cols = checkNumber(name, "view.freeze.cols", view.freeze?.cols, 0, MAX_COLS - 1, true) ?? 0;
      if (view.freeze !== undefined && (typeof view.freeze !== "object" || view.freeze === null)) {
        throw sheetError(name, "view.freeze", view.freeze, "must be { rows?, cols? }");
      }
      if (rows > 0 || cols > 0) {
        const topLeft = encodeCell({ row: rows, col: cols });
        const pane = rows > 0 && cols > 0 ? "bottomRight" : rows > 0 ? "bottomLeft" : "topRight";
        inner += `<pane${cols > 0 ? ` xSplit="${cols}"` : ""}${rows > 0 ? ` ySplit="${rows}"` : ""} topLeftCell="${topLeft}" activePane="${pane}" state="frozen"/>`;
        const ac = activeCell ?? topLeft;
        inner += `<selection pane="${pane}" activeCell="${ac}" sqref="${selection ?? ac}"/>`;
      } else if (activeCell !== undefined || selection !== undefined) {
        const ac = activeCell ?? selection!.split(":")[0]!;
        inner += `<selection activeCell="${ac}" sqref="${selection ?? ac}"/>`;
      }
    }
    attrs += ' workbookViewId="0"';
    return `<sheetViews><sheetView${attrs}${inner ? `>${inner}</sheetView>` : "/>"}</sheetViews>`;
  }

  private printXml(print: PrintSetup | undefined, index: number): SheetFeatures["print"] {
    const name = this.name;
    const out = { options: "", margins: "", setup: "", headerFooter: "" };
    const p: PrintSetup = print ?? {};
    if (typeof p !== "object" || p === null) throw sheetError(name, "print", print, "must be an object");

    let options = "";
    if (checkBool(name, "print.center.horizontal", p.center?.horizontal)) options += ' horizontalCentered="1"';
    if (checkBool(name, "print.center.vertical", p.center?.vertical)) options += ' verticalCentered="1"';
    if (checkBool(name, "print.headings", p.headings)) options += ' headings="1"';
    if (checkBool(name, "print.gridLines", p.gridLines)) options += ' gridLines="1"';
    if (options) out.options = `<printOptions${options}/>`;

    // Excel always writes all six margins; these are its "Normal" defaults, in inches.
    const m = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
    for (const k of Object.keys(m) as Array<keyof typeof m>) {
      const v = checkNumber(name, `print.margins.${k}`, p.margins?.[k], 0, 49);
      if (v !== undefined) m[k] = v;
    }
    out.margins = `<pageMargins left="${num(m.left)}" right="${num(m.right)}" top="${num(m.top)}" bottom="${num(m.bottom)}" header="${num(m.header)}" footer="${num(m.footer)}"/>`;

    let setup = "";
    const paper = checkNumber(name, "print.paperSize", p.paperSize, 1, 255, true);
    if (paper !== undefined) setup += ` paperSize="${paper}"`;
    const scale = checkNumber(name, "print.scale", p.scale, 10, 400, true);
    if (scale !== undefined) setup += ` scale="${scale}"`;
    if (p.fitTo !== undefined) {
      if (typeof p.fitTo !== "object" || p.fitTo === null) throw sheetError(name, "print.fitTo", p.fitTo, "must be { width?, height? }");
      // Omitted means automatic (0); Excel's own default for a missing attribute is 1.
      const w = checkNumber(name, "print.fitTo.width", p.fitTo.width, 0, 32767, true) ?? 0;
      const h = checkNumber(name, "print.fitTo.height", p.fitTo.height, 0, 32767, true) ?? 0;
      setup += ` fitToWidth="${w}" fitToHeight="${h}"`;
    }
    if (p.orientation !== undefined) {
      if (p.orientation !== "portrait" && p.orientation !== "landscape") {
        throw sheetError(name, "print.orientation", p.orientation, "must be 'portrait' or 'landscape'");
      }
      setup += ` orientation="${p.orientation}"`;
    }
    if (setup) out.setup = `<pageSetup${setup}/>`;

    const hf = (key: "header" | "footer", part: "odd" | "even" | "first"): string => {
      const v = p[key]?.[part];
      if (v === undefined) return "";
      if (typeof v !== "string") throw sheetError(name, `print.${key}.${part}`, v, "must be a string");
      const tag = `${part}${key === "header" ? "Header" : "Footer"}`;
      return `<${tag}>${xstring(v)}</${tag}>`;
    };
    const parts = [hf("header", "odd"), hf("footer", "odd"), hf("header", "even"), hf("footer", "even"), hf("header", "first"), hf("footer", "first")];
    if (parts.some(Boolean)) {
      const even = parts[2] || parts[3] ? ' differentOddEven="1"' : "";
      const first = parts[4] || parts[5] ? ' differentFirst="1"' : "";
      out.headerFooter = `<headerFooter${even}${first}>${parts.join("")}</headerFooter>`;
    }

    if (p.printArea !== undefined) {
      const r = checkRange(name, "print.printArea", p.printArea);
      this.builtinNames.push({ name: "_xlnm.Print_Area", ref: `${quoteSheet(name)}!${absRange(r)}`, sheet: index, hidden: false });
    }
    if (p.printTitles !== undefined) {
      const refs: string[] = [];
      const t = p.printTitles;
      if (typeof t !== "object" || t === null) throw sheetError(name, "print.printTitles", t, "must be { rows?, cols? }");
      if (t.cols !== undefined) {
        const m2 = typeof t.cols === "string" ? /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(t.cols) : null;
        if (!m2) throw sheetError(name, "print.printTitles.cols", t.cols, "must be a column range such as 'A:B'", "INVALID_REF");
        const [a, b] = [decodeCol(m2[1]!), decodeCol(m2[2]!)].sort((x, y) => x - y);
        refs.push(`${quoteSheet(name)}!$${encodeCol(a!)}:$${encodeCol(b!)}`);
      }
      if (t.rows !== undefined) {
        const m2 = typeof t.rows === "string" ? /^\$?([1-9]\d{0,6}):\$?([1-9]\d{0,6})$/.exec(t.rows) : null;
        const [a, b] = m2 ? [Number(m2[1]), Number(m2[2])].sort((x, y) => x - y) : [0, 0];
        if (!m2 || b! > MAX_ROWS) throw sheetError(name, "print.printTitles.rows", t.rows, "must be a row range such as '1:2'", "INVALID_REF");
        refs.push(`${quoteSheet(name)}!$${a}:$${b}`);
      }
      if (refs.length) this.builtinNames.push({ name: "_xlnm.Print_Titles", ref: refs.join(","), sheet: index, hidden: false });
    }
    return out;
  }

  // ---- XML, in CT_Worksheet order

  get sheetPrXml(): string {
    return this.sheetPr;
  }

  get sheetViewsXml(): string {
    return this.views;
  }

  get sheetFormatPrXml(): string {
    let x = "<sheetFormatPr";
    if (this.defaultColWidthChars !== undefined) x += ` defaultColWidth="${num(charsToFileWidth(this.defaultColWidthChars))}"`;
    x += ` defaultRowHeight="${num(this.defaultRowHeight ?? DEFAULT_ROW_HEIGHT)}"`;
    if (this.defaultRowHeight !== undefined) x += ' customHeight="1"';
    if (this.maxOutlineRow) x += ` outlineLevelRow="${this.maxOutlineRow}"`;
    if (this.maxOutlineCol) x += ` outlineLevelCol="${this.maxOutlineCol}"`;
    return `${x}/>`;
  }

  /** <cols>, after the cell scan (auto widths are known then). Consecutive identical columns share one <col>. */
  colsXml(): string {
    const specs: Array<{ min: number; max: number; spec: ColSpec }> = [];
    const defaultSpec = (): ColSpec => ({ width: this.defaultColFileWidth, custom: false, bestFit: false, style: this.defaultColStyle, hidden: false, outlineLevel: 0, collapsed: false });
    let next = 0;
    const fillDefault = (until: number): void => {
      // Columns without properties need a <col> only to carry the sheet default style.
      if (this.defaultColStyle !== 0 && until > next) specs.push({ min: next, max: until - 1, spec: defaultSpec() });
    };
    for (const { col, width, spec } of this.cols) {
      fillDefault(col);
      let fileWidth = this.defaultColFileWidth;
      let custom = false;
      let bestFit = false;
      if (width === "auto") {
        const chars = Math.min(AUTO_WIDTH.max, Math.max(AUTO_WIDTH.min, (this.autoCols.get(col) ?? 0) + AUTO_WIDTH.padding));
        fileWidth = charsToFileWidth(chars);
        custom = true;
        bestFit = true;
      } else if (width !== undefined) {
        const chars = typeof width === "number" ? width : "wch" in width ? width.wch : pixelsToChars(width.wpx);
        fileWidth = charsToFileWidth(chars);
        custom = true;
      }
      // Excel hides a zero-width column and writes hidden="1" with it; other readers rely on that flag.
      const hidden = spec.hidden || (custom && fileWidth === 0);
      specs.push({ min: col, max: col, spec: { ...spec, hidden, width: fileWidth, custom, bestFit } });
      next = col + 1;
    }
    fillDefault(MAX_COLS);
    if (specs.length === 0) return "";

    const merged: typeof specs = [];
    for (const s of specs) {
      const last = merged[merged.length - 1];
      if (last && last.max + 1 === s.min && JSON.stringify(last.spec) === JSON.stringify(s.spec)) last.max = s.max;
      else merged.push({ ...s });
    }
    let x = "<cols>";
    for (const { min, max, spec } of merged) {
      x += `<col min="${min + 1}" max="${max + 1}" width="${num(spec.width)}"`;
      if (spec.style) x += ` style="${spec.style}"`;
      if (spec.hidden) x += ' hidden="1"';
      if (spec.bestFit) x += ' bestFit="1"';
      if (spec.custom) x += ' customWidth="1"';
      if (spec.outlineLevel) x += ` outlineLevel="${spec.outlineLevel}"`;
      if (spec.collapsed) x += ' collapsed="1"';
      x += "/>";
    }
    return `${x}</cols>`;
  }

  /** Everything after <sheetData>, in schema order. */
  afterDataXml(links: SheetLinks): string {
    let x = "";
    if (this.autoFilter) x += `<autoFilter ref="${this.autoFilter}"/>`;
    if (this.merges.length) x += `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`;
    x += links.xml();
    x += this.print.options + this.print.margins + this.print.setup + this.print.headerFooter;
    return x;
  }
}

// ------------------------------------------------------------ hyperlinks

/** Default hyperlink scheme allowlist (§8, §12 Q16). */
export const DEFAULT_HYPERLINK_SCHEMES: readonly string[] = ["http", "https", "mailto"];

/** Normalises the `hyperlinkSchemes` option. */
export function hyperlinkSchemes(option: unknown): ReadonlySet<string> {
  if (option === undefined) return new Set(DEFAULT_HYPERLINK_SCHEMES);
  if (!Array.isArray(option) || option.some((s) => typeof s !== "string" || !/^[A-Za-z][A-Za-z0-9+.-]*:?$/.test(s))) {
    throw new ValidationError("INVALID_HYPERLINK", "hyperlinkSchemes must be an array of URL scheme names such as 'https'.", {
      details: { value: option },
    });
  }
  return new Set(option.map((s: string) => s.toLowerCase().replace(/:$/, "")));
}

/**
 * The hyperlinks of one sheet. External targets are added to the sheet's
 * relationships (`rels`), which later sheet-level parts (comments, drawings)
 * share.
 */
export class SheetLinks {
  private readonly items: string[] = [];

  constructor(
    private readonly sheet: string,
    private readonly schemes: ReadonlySet<string>,
    private readonly rels: Rels,
  ) {}

  add(ref: string, link: Hyperlink | undefined): void {
    if (link === undefined) return;
    const fail = (why: string): never => {
      throw new ValidationError("INVALID_HYPERLINK", `Hyperlink in ${this.sheet}!${ref}: ${why}.`, { details: { sheet: this.sheet, ref, hyperlink: link } });
    };
    const obj = typeof link === "string" ? { target: link } : link;
    if (typeof obj !== "object" || obj === null) return fail("expected a URL string, { target } or { location }");
    const tooltip = (obj as { tooltip?: unknown }).tooltip;
    if (tooltip !== undefined && typeof tooltip !== "string") fail("tooltip must be a string");
    const tip = tooltip ? ` tooltip="${xmlAttr(tooltip as string)}"` : "";
    if ("location" in obj && obj.location !== undefined) {
      if (typeof obj.location !== "string" || obj.location.length === 0) fail("location must be a non-empty string");
      this.items.push(`<hyperlink ref="${ref}" location="${xmlAttr(obj.location)}"${tip}/>`);
      return;
    }
    const target = (obj as { target?: unknown }).target;
    if (typeof target !== "string" || target.length === 0) return fail("target must be a non-empty URL");
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F]/.test(target)) fail("the URL contains control characters");
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(target)?.[1]?.toLowerCase();
    if (!scheme) fail(`the URL has no scheme; allowed schemes: ${[...this.schemes].join(", ")}`);
    if (!this.schemes.has(scheme!)) fail(`scheme '${scheme}:' is not allowed (allowed: ${[...this.schemes].join(", ")}; see WriteOptions.hyperlinkSchemes)`);
    const id = this.rels.add(REL_TYPE.hyperlink, target, true);
    this.items.push(`<hyperlink ref="${ref}" r:id="${id}"${tip}/>`);
  }

  xml(): string {
    return this.items.length ? `<hyperlinks>${this.items.join("")}</hyperlinks>` : "";
  }
}

/** The hyperlink of a cell input, if any. */
export function hyperlinkOf(input: unknown): Hyperlink | undefined {
  if (typeof input !== "object" || input === null || input instanceof Date) return undefined;
  return (input as Cell).hyperlink;
}
