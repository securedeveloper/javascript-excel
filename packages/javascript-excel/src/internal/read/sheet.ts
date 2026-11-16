/**
 * Worksheet part -> model sheet (docs/api.md §3.3–3.7, §5.2). Internal.
 *
 * A streaming handler: cells are converted as soon as each `<c>` closes, and
 * nothing but the model is kept.
 */

import type { Cell, CellValue, ColumnProps, Hyperlink, PrintSetup, RichText, RowProps, Sheet, SheetView } from "../../model";
import type { ReadContext } from "./context";
import { colLetters, colNumber, shiftFormula } from "./formula";
import { isDateFormat } from "../../numfmt";
import type { Relationship } from "./opc";
import { serialToDate } from "../../dates";
import { StringItem, decodeXstring } from "./strings";
import { bool, color, int, num, type StyleTable } from "./styles";
import type { XmlAttrs, XmlHandler } from "./xml-reader";
import { parseIsoDate } from "../csv/infer";

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

const ERROR_CODES = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#GETTING_DATA", "#SPILL!", "#CALC!", "#FIELD!", "#BLOCKED!", "#CONNECT!", "#UNKNOWN!", "#BUSY!", "#PYTHON!", "#EXTERNAL!"]);

export interface SheetOptions {
  formulas: boolean;
  dates: "date" | "serial";
  dateZone: "local" | "utc";
  richText: "runs" | "plain";
  date1904: boolean;
}

interface PendingCell {
  row: number;
  col: number;
  ref: string;
  t: string;
  s: number;
  v: string | undefined;
  f: string | undefined;
  fType: string | undefined;
  fRef: string | undefined;
  fSi: string | undefined;
  inline: string | RichText | undefined;
}

interface RawHyperlink {
  ref: string;
  relId: string | undefined;
  location: string | undefined;
  tooltip: string | undefined;
}

/** Maximum digit width of Calibri 11 in pixels; the writer uses the same value (internal/write/sheet-features.ts). */
const MAX_DIGIT_WIDTH = 7;

/**
 * A column width as stored in the file (characters plus padding, ECMA-376
 * §18.3.1.13) to the width Excel's UI shows, which the model uses (§3.3).
 * The inverse of the writer's conversion: 20 is written as 20.7109375 and
 * reads back as 20.
 */
export function fileWidthToChars(width: number): number {
  if (width <= 0) return 0;
  const px = Math.trunc(((256 * width + Math.trunc(128 / MAX_DIGIT_WIDTH)) / 256) * MAX_DIGIT_WIDTH);
  return Math.max(0, Math.trunc(((px - 5) / MAX_DIGIT_WIDTH) * 100 + 0.5) / 100);
}

/** Parses "B12" -> [row 11, col 1]; undefined if not an A1 cell reference. */
export function parseRef(ref: string): [number, number] | undefined {
  // A hand-written scanner: this runs once per cell (JSE-8 profile).
  const n = ref.length;
  let i = 0;
  if (ref.charCodeAt(0) === 36) i++; // $
  let col = 0;
  const colStart = i;
  for (; i < n; i++) {
    let c = ref.charCodeAt(i);
    if (c >= 97 && c <= 122) c -= 32; // lower case
    if (c < 65 || c > 90) break;
    col = col * 26 + (c - 64);
  }
  const letters = i - colStart;
  if (letters < 1 || letters > 3) return undefined;
  if (ref.charCodeAt(i) === 36) i++;
  let row = 0;
  const rowStart = i;
  for (; i < n; i++) {
    const c = ref.charCodeAt(i);
    if (c < 48 || c > 57) return undefined;
    row = row * 10 + (c - 48);
  }
  const digits = i - rowStart;
  if (digits < 1 || digits > 7) return undefined;
  return [row - 1, col - 1];
}

/** "A1:B2" -> A1 with the dollar signs removed (sheet qualification stripped). */
function cleanRange(ref: string): string {
  const bang = ref.lastIndexOf("!");
  return (bang === -1 ? ref : ref.slice(bang + 1)).replace(/\$/g, "");
}

/**
 * A date-formatted number as a Date, or undefined when it is not a valid
 * serial: negative, beyond 9999-12-31, or the 1900 system's fictitious
 * 1900-02-29 (serial 60), which `serialToDate` maps to 1900-03-01.
 */
function dateOf(serial: number, date1904: boolean, dateZone: "local" | "utc"): Date | undefined {
  if (!date1904 && Math.floor(serial) === 60) return undefined;
  try {
    return serialToDate(serial, { date1904, dateZone });
  } catch {
    return undefined;
  }
}

export class SheetParser implements XmlHandler {
  readonly sheet: Sheet<Cell>;
  private readonly rows: Array<Array<Cell | undefined> | undefined> = [];
  private readonly rowProps: Array<RowProps | undefined> = [];
  private readonly colProps: Array<ColumnProps | undefined> = [];
  private readonly merges: string[] = [];
  private readonly hyperlinks: RawHyperlink[] = [];
  private readonly shared = new Map<string, { formula: string; row: number; col: number }>();
  private view: SheetView | undefined;
  private print: PrintSetup | undefined;
  private fitToPage = false;
  private fitTo: { width?: number; height?: number } | undefined;

  private path: string[] = [];
  private curRow = -1;
  private nextCol = 0;
  private cell: PendingCell | undefined;
  private textTarget: "v" | "f" | "hf" | undefined;
  private buf = "";
  private inline: StringItem | undefined;
  private inlineDepth = 0;
  private viewCount = 0;
  private activePane: string | undefined;
  private selections: Array<{ pane: string | undefined; activeCell: string | undefined; sqref: string | undefined }> = [];
  private headerKey: string | undefined;
  private minRow = Infinity;
  private minCol = Infinity;
  private maxRow = -1;
  private maxCol = -1;

  constructor(
    name: string,
    state: Sheet["state"],
    private readonly ctx: ReadContext,
    private readonly styles: StyleTable,
    private readonly opts: SheetOptions,
    private readonly part: string,
  ) {
    this.sheet = { name, rows: this.rows };
    if (state && state !== "visible") this.sheet.state = state;
  }

  // ------------------------------------------------------------------ events

  open(name: string, a: XmlAttrs, empty: boolean): void {
    if (this.inline) {
      if (!empty) this.inlineDepth++;
      this.inline.open(name, a);
      if (empty) this.inline.close(name);
      return;
    }
    const parent = this.path.at(-1);
    if (!empty) this.path.push(name);
    switch (name) {
      case "c":
        if (parent === "row") this.openCell(a, empty);
        return;
      case "v":
        if (this.cell) this.startText("v");
        return;
      case "f":
        if (this.cell) {
          this.cell.fType = a.get("t");
          this.cell.fRef = a.get("ref");
          this.cell.fSi = a.get("si");
          this.cell.f = "";
          if (!empty) this.startText("f");
        }
        return;
      case "is":
        if (this.cell && !empty) {
          this.inline = new StringItem();
          this.inlineDepth = 0;
        }
        return;
      case "row":
        if (parent === "sheetData") this.openRow(a);
        return;
      case "col":
        if (parent === "cols") this.openCol(a);
        return;
      case "mergeCell": {
        const ref = a.get("ref");
        if (ref) this.merges.push(cleanRange(ref));
        return;
      }
      case "hyperlink":
        if (parent === "hyperlinks") {
          const ref = a.get("ref");
          if (ref) this.hyperlinks.push({ ref: cleanRange(ref), relId: a.getPrefixed("id"), location: a.get("location"), tooltip: a.get("tooltip") });
        }
        return;
      case "sheetView":
        this.openView(a);
        return;
      case "pane":
        if (parent === "sheetView" && this.viewCount === 1) this.openPane(a);
        return;
      case "selection":
        if (parent === "sheetView" && this.viewCount === 1) {
          this.selections.push({ pane: a.get("pane"), activeCell: a.get("activeCell"), sqref: a.get("sqref") });
        }
        return;
      case "sheetFormatPr": {
        const w = num(a.get("defaultColWidth"));
        if (w !== undefined) this.sheet.defaultColWidth = fileWidthToChars(w);
        const h = num(a.get("defaultRowHeight"));
        if (h !== undefined) this.sheet.defaultRowHeight = h;
        return;
      }
      case "tabColor":
        if (parent === "sheetPr") {
          const c = color(a);
          if (c) this.sheet.tabColor = c;
        }
        return;
      case "pageSetUpPr":
        if (parent === "sheetPr") this.fitToPage = bool(a.get("fitToPage"), false);
        return;
      case "autoFilter":
        if (parent === "worksheet") {
          const ref = a.get("ref");
          if (ref) this.sheet.autoFilter = cleanRange(ref);
        }
        return;
      case "printOptions":
        this.openPrintOptions(a);
        return;
      case "pageMargins":
        this.openMargins(a);
        return;
      case "pageSetup":
        if (parent === "worksheet") this.openPageSetup(a);
        return;
      case "oddHeader":
      case "oddFooter":
      case "evenHeader":
      case "evenFooter":
      case "firstHeader":
      case "firstFooter":
        if (parent === "headerFooter" && !empty) {
          this.headerKey = name;
          this.startText("hf");
        }
        return;
      default:
        return;
    }
  }

  close(name: string): void {
    if (this.inline) {
      if (this.inlineDepth === 0 && name === "is") {
        if (this.cell) this.cell.inline = this.inline.value(this.opts.richText);
        this.inline = undefined;
        this.path.pop();
        return;
      }
      this.inlineDepth--;
      this.inline.close(name);
      return;
    }
    this.path.pop();
    switch (name) {
      case "v":
        if (this.cell && this.textTarget === "v") this.cell.v = this.buf;
        this.textTarget = undefined;
        return;
      case "f":
        if (this.cell && this.textTarget === "f") this.cell.f = decodeXstring(this.buf);
        this.textTarget = undefined;
        return;
      case "c":
        if (this.cell) this.finishCell();
        return;
      case "sheetView":
        return;
      case "oddHeader":
      case "oddFooter":
      case "evenHeader":
      case "evenFooter":
      case "firstHeader":
      case "firstFooter":
        if (this.textTarget === "hf" && this.headerKey) this.setHeaderFooter(this.headerKey, this.buf);
        this.textTarget = undefined;
        this.headerKey = undefined;
        return;
      default:
        return;
    }
  }

  text(s: string): void {
    if (this.inline) {
      this.inline.text(s);
      return;
    }
    if (this.textTarget) this.buf += s;
  }

  private startText(target: "v" | "f" | "hf"): void {
    this.textTarget = target;
    this.buf = "";
  }

  // ------------------------------------------------------------------- rows

  private openRow(a: XmlAttrs): void {
    const r = int(a.get("r"));
    if (r !== undefined && r >= 1) {
      if (r > MAX_ROWS) {
        this.curRow = MAX_ROWS; // out of bounds: every cell in it is skipped
        this.ctx.warn("CELL_OUT_OF_BOUNDS", `Row ${r} is beyond the format limit (${MAX_ROWS}); its cells were skipped.`, { part: this.part, sheet: this.sheet.name });
      } else this.curRow = r - 1;
    } else this.curRow++;
    this.nextCol = 0;
    if (this.curRow >= MAX_ROWS) return;
    const p: RowProps = {};
    const ht = num(a.get("ht"));
    if (ht !== undefined && bool(a.get("customHeight"), false)) p.height = ht;
    if (bool(a.get("hidden"), false)) p.hidden = true;
    const ol = int(a.get("outlineLevel"));
    if (ol !== undefined && ol > 0) p.outlineLevel = ol;
    if (bool(a.get("collapsed"), false)) p.collapsed = true;
    const s = int(a.get("s"));
    if (s !== undefined && bool(a.get("customFormat"), false)) {
      const st = this.styles.style(s);
      if (st) p.style = st;
    }
    if (Object.keys(p).length) this.rowProps[this.curRow] = p;
  }

  private openCol(a: XmlAttrs): void {
    const min = int(a.get("min"));
    const max = int(a.get("max"));
    if (min === undefined || max === undefined || min < 1 || max < min) return;
    const p: ColumnProps = {};
    const w = num(a.get("width"));
    if (w !== undefined && (bool(a.get("customWidth"), false) || a.get("customWidth") === undefined)) p.width = fileWidthToChars(w);
    if (bool(a.get("hidden"), false)) p.hidden = true;
    const ol = int(a.get("outlineLevel"));
    if (ol !== undefined && ol > 0) p.outlineLevel = ol;
    if (bool(a.get("collapsed"), false)) p.collapsed = true;
    const s = int(a.get("style"));
    if (s !== undefined) {
      const st = this.styles.style(s);
      if (st) p.style = st;
    }
    if (!Object.keys(p).length) return;
    const last = Math.min(max, MAX_COLS);
    for (let c = min - 1; c < last; c++) this.colProps[c] = { ...p };
  }

  // ------------------------------------------------------------------ cells

  private openCell(a: XmlAttrs, empty: boolean): void {
    let row = this.curRow;
    let col = this.nextCol;
    const r = a.get("r");
    if (r !== undefined) {
      const pos = parseRef(r);
      if (!pos) {
        this.ctx.warn("INVALID_CELL_REF", `Cell reference "${r}" is not valid; the cell was skipped.`, { part: this.part, sheet: this.sheet.name });
        this.skipCell(empty);
        return;
      }
      [row, col] = pos; // the cell reference wins over the enclosing row element
    }
    if (row < 0) row = 0;
    this.nextCol = col + 1;
    if (row >= MAX_ROWS || col >= MAX_COLS) {
      this.ctx.warn("CELL_OUT_OF_BOUNDS", `Cell ${r ?? `${colLetters(col + 1)}${row + 1}`} is beyond the format limits; it was skipped.`, {
        part: this.part,
        sheet: this.sheet.name,
      });
      this.skipCell(empty);
      return;
    }
    this.cell = {
      row,
      col,
      ref: `${colLetters(col + 1)}${row + 1}`,
      t: a.get("t") ?? "n",
      s: int(a.get("s")) ?? 0,
      v: undefined,
      f: undefined,
      fType: undefined,
      fRef: undefined,
      fSi: undefined,
      inline: undefined,
    };
    if (empty) this.finishCell();
  }

  private skipCell(empty: boolean): void {
    this.cell = undefined;
    if (!empty) {
      // Swallow the cell's children: a dummy cell collects them and is dropped.
      this.cell = { row: -1, col: -1, ref: "", t: "n", s: 0, v: undefined, f: undefined, fType: undefined, fRef: undefined, fSi: undefined, inline: undefined };
    }
  }

  private finishCell(): void {
    const p = this.cell!;
    this.cell = undefined;
    if (p.row < 0) return; // skipped
    const cell = this.convert(p);
    if (!cell) return;
    this.ctx.countCell();
    let row = this.rows[p.row];
    if (!row) row = this.rows[p.row] = [];
    if (row[p.col] !== undefined) {
      this.ctx.warn("DUPLICATE_CELL", `Cell ${p.ref} appears more than once; the last one was kept.`, { part: this.part, sheet: this.sheet.name, ref: p.ref });
    }
    row[p.col] = cell;
    if (p.row < this.minRow) this.minRow = p.row;
    if (p.row > this.maxRow) this.maxRow = p.row;
    if (p.col < this.minCol) this.minCol = p.col;
    if (p.col > this.maxCol) this.maxCol = p.col;
  }

  private convert(p: PendingCell): Cell | undefined {
    const style = this.styles.style(p.s);
    let value: CellValue | undefined;
    let type: Cell["type"] = "empty";
    const v = p.v;
    switch (p.t) {
      case "s": {
        if (v === undefined) break;
        const idx = Number(v);
        const sst = this.sharedStrings;
        const str = Number.isInteger(idx) && idx >= 0 ? sst[idx] : undefined;
        if (str === undefined) {
          this.ctx.warn("INVALID_SHARED_STRING", `Cell ${p.ref} refers to shared string ${v}, which does not exist; the cell was left empty.`, {
            part: this.part,
            sheet: this.sheet.name,
            ref: p.ref,
          });
          break;
        }
        value = str;
        type = typeof str === "string" ? "string" : "richText";
        break;
      }
      case "inlineStr":
        if (p.inline !== undefined) {
          value = p.inline;
          type = typeof p.inline === "string" ? "string" : "richText";
        } else if (v !== undefined) {
          value = decodeXstring(v);
          type = "string";
        }
        break;
      case "str":
        if (v !== undefined) {
          value = decodeXstring(v);
          type = "string";
        }
        break;
      case "b":
        if (v !== undefined) {
          value = v.trim() === "1" || v.trim().toLowerCase() === "true";
          type = "boolean";
        }
        break;
      case "e":
        if (v !== undefined) {
          const code = v.trim();
          if (ERROR_CODES.has(code)) {
            // Codes beyond ECMA-376's seven (#SPILL!, #CALC!, ...) are returned as written.
            value = { error: code as "#N/A" };
            type = "error";
          } else {
            value = code;
            type = "string";
          }
        }
        break;
      case "d":
        if (v !== undefined) {
          const d = parseIsoDate(v.trim().replace(/(\.\d{3})\d+/, "$1"), this.opts.dateZone);
          if (d) {
            value = d;
            type = "date";
          } else {
            value = v;
            type = "string";
          }
        }
        break;
      default: {
        // "n" and anything unknown: a number.
        if (v === undefined || v.trim() === "") break;
        const n = Number(v);
        if (!Number.isFinite(n)) {
          value = v;
          type = "string";
          break;
        }
        value = n;
        type = "number";
        if (this.opts.dates === "date" && isDateFormat(this.styles.numFmt(p.s))) {
          const d = dateOf(n, this.opts.date1904, this.opts.dateZone);
          if (d) {
            value = d;
            type = "date";
          } else {
            this.ctx.warn("INVALID_DATE_SERIAL", `Cell ${p.ref} has a date format but ${n} is not a valid date serial; it was returned as a number.`, {
              part: this.part,
              sheet: this.sheet.name,
              ref: p.ref,
            });
          }
        }
      }
    }

    const formula = this.formula(p);
    if (value === undefined && formula === undefined && !style) return undefined;
    const cell: Cell = { type };
    if (value !== undefined) cell.value = value;
    if (formula !== undefined) {
      cell.formula = formula.text;
      if (formula.arrayRef) cell.arrayRef = formula.arrayRef;
    }
    if (style) cell.style = style;
    return cell;
  }

  private formula(p: PendingCell): { text: string; arrayRef?: string } | undefined {
    if (p.f === undefined || !this.opts.formulas) return undefined;
    if (p.fType === "shared" && p.fSi !== undefined) {
      if (p.f !== "") {
        this.shared.set(p.fSi, { formula: p.f, row: p.row, col: p.col });
        return { text: p.f };
      }
      const master = this.shared.get(p.fSi);
      const shifted = master ? shiftFormula(master.formula, p.row - master.row, p.col - master.col) : undefined;
      if (shifted === undefined) {
        this.ctx.warn("SHARED_FORMULA_UNRESOLVED", `The shared formula of cell ${p.ref} could not be resolved; only its cached value was read.`, {
          part: this.part,
          sheet: this.sheet.name,
          ref: p.ref,
        });
        return undefined;
      }
      return { text: shifted };
    }
    if (p.fType === "dataTable") return undefined; // what-if data tables: the cached values are the content
    if (p.f === "") return undefined;
    if (p.fType === "array" && p.fRef) return { text: p.f, arrayRef: cleanRange(p.fRef) };
    return { text: p.f };
  }

  /** Set before parsing; the shared strings table. */
  sharedStrings: ReadonlyArray<string | RichText> = [];

  // ------------------------------------------------------------- view/print

  private openView(a: XmlAttrs): void {
    this.viewCount++;
    if (this.viewCount !== 1) return;
    const v: SheetView = {};
    if (bool(a.get("rightToLeft"), false)) v.rightToLeft = true;
    if (a.get("showGridLines") !== undefined && !bool(a.get("showGridLines"))) v.showGridLines = false;
    if (a.get("showRowColHeaders") !== undefined && !bool(a.get("showRowColHeaders"))) v.showRowColHeaders = false;
    const zoom = int(a.get("zoomScale"));
    if (zoom !== undefined && zoom !== 100 && zoom >= 10 && zoom <= 400) v.zoom = zoom;
    this.view = v;
  }

  private openPane(a: XmlAttrs): void {
    const state = a.get("state") ?? "split";
    this.activePane = a.get("activePane");
    if (state === "frozen" || state === "frozenSplit") {
      const freeze: { rows?: number; cols?: number } = {};
      const ys = int(a.get("ySplit"));
      const xs = int(a.get("xSplit"));
      if (ys !== undefined && ys > 0) freeze.rows = ys;
      if (xs !== undefined && xs > 0) freeze.cols = xs;
      if (Object.keys(freeze).length && this.view) this.view.freeze = freeze;
    } else {
      this.ctx.warn("SPLIT_PANE_IGNORED", "The sheet has a split (not frozen) pane, which the model does not represent; it was ignored.", {
        part: this.part,
        sheet: this.sheet.name,
      });
    }
  }

  private printSetup(): PrintSetup {
    return (this.print ??= {});
  }

  private openPrintOptions(a: XmlAttrs): void {
    const p = this.printSetup();
    if (bool(a.get("gridLines"), false)) p.gridLines = true;
    if (bool(a.get("headings"), false)) p.headings = true;
    const h = bool(a.get("horizontalCentered"), false);
    const v = bool(a.get("verticalCentered"), false);
    if (h || v) {
      p.center = {};
      if (h) p.center.horizontal = true;
      if (v) p.center.vertical = true;
    }
    if (!Object.keys(p).length) this.print = undefined;
  }

  private openMargins(a: XmlAttrs): void {
    const m: NonNullable<PrintSetup["margins"]> = {};
    for (const k of ["left", "right", "top", "bottom", "header", "footer"] as const) {
      const n = num(a.get(k));
      if (n !== undefined) m[k] = n;
    }
    if (Object.keys(m).length) this.printSetup().margins = m;
  }

  private openPageSetup(a: XmlAttrs): void {
    const p = this.printSetup();
    const o = a.get("orientation");
    if (o === "portrait" || o === "landscape") p.orientation = o;
    const paper = int(a.get("paperSize"));
    if (paper !== undefined) p.paperSize = paper;
    const scale = int(a.get("scale"));
    if (scale !== undefined && scale !== 100) p.scale = scale;
    const fw = int(a.get("fitToWidth"));
    const fh = int(a.get("fitToHeight"));
    this.fitTo = { width: fw ?? 1, height: fh ?? 1 };
  }

  private setHeaderFooter(key: string, text: string): void {
    const p = this.printSetup();
    const kind = key.endsWith("Header") ? "header" : "footer";
    const which = key.startsWith("odd") ? "odd" : key.startsWith("even") ? "even" : "first";
    (p[kind] ??= {})[which] = text;
  }

  // ------------------------------------------------------------------ result

  /** Applies hyperlinks, merges and layout once the part is parsed. */
  finish(rels: Relationship[]): Sheet<Cell> {
    const sheet = this.sheet;
    if (this.rowProps.length) sheet.rowProps = this.rowProps;
    if (this.colProps.length) sheet.colProps = this.colProps;
    if (this.merges.length) sheet.merges = this.merges;
    if (this.view) {
      const sel = this.selections.find((s) => s.pane === this.activePane) ?? this.selections[0];
      if (sel?.activeCell && sel.activeCell !== "A1") this.view.activeCell = sel.activeCell;
      if (sel?.sqref && sel.sqref !== "A1" && sel.sqref !== sel.activeCell) this.view.selection = sel.sqref.split(" ")[0]!;
      if (Object.keys(this.view).length) sheet.view = this.view;
    }
    if (this.fitToPage && this.fitTo) this.printSetup().fitTo = this.fitTo;
    if (this.print && Object.keys(this.print).length) sheet.print = this.print;
    for (const h of this.hyperlinks) this.attachHyperlink(h, rels);
    if (this.maxRow >= 0) {
      const tl = `${colLetters(this.minCol + 1)}${this.minRow + 1}`;
      const br = `${colLetters(this.maxCol + 1)}${this.maxRow + 1}`;
      sheet.dimension = tl === br ? tl : `${tl}:${br}`;
    }
    return sheet;
  }

  private attachHyperlink(h: RawHyperlink, rels: Relationship[]): void {
    const first = h.ref.split(":")[0]!;
    const pos = parseRef(first);
    if (!pos) return;
    if (h.ref.includes(":") && h.ref.split(":")[1] !== first) {
      this.ctx.warn("HYPERLINK_RANGE_REDUCED", `The hyperlink on ${h.ref} was attached to its top-left cell ${first}.`, {
        part: this.part,
        sheet: this.sheet.name,
        ref: h.ref,
      });
    }
    let link: Hyperlink | undefined;
    if (h.relId) {
      const rel = rels.find((r) => r.id === h.relId);
      if (rel) {
        const target = h.location ? `${rel.target}#${h.location}` : rel.target;
        link = h.tooltip !== undefined ? { target, tooltip: h.tooltip } : { target };
      }
    } else if (h.location !== undefined) {
      link = h.tooltip !== undefined ? { location: h.location, tooltip: h.tooltip } : { location: h.location };
    }
    if (!link) return;
    const [r, c] = pos;
    if (r >= MAX_ROWS || c >= MAX_COLS) return;
    let row = this.rows[r];
    if (!row) row = this.rows[r] = [];
    const cell = row[c] ?? (row[c] = { type: "empty" });
    cell.hyperlink = link;
  }
}
