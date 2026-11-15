/**
 * Worksheet XML and shared strings (docs/api.md §3.4).
 *
 * Sheet XML is produced as a stream of UTF-8 chunks, so a large sheet is never
 * held as one string.
 */

import { decodeRange, encodeCol, MAX_COLS, MAX_ROWS } from "../../address";
import { dateToSerial } from "../../dates";
import { ValidationError, type ExcelErrorCode } from "../../errors";
import type { Cell, CellInput, CellType, CellValue, ErrorCode, RichText, Sheet, Style } from "../../model";
import { encodeUtf8 } from "../platform";
import { needsPreserve, num, XML_DECL, xstring } from "../xml";
import { mergeStyles } from "../../styles";
import { fontXml, type NFont, type StyleRegistry } from "./style-registry";

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Excel's limit on characters in one cell. */
export const MAX_CELL_CHARS = 32_767;

const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"]);

/** Target size of each sheet XML chunk, in UTF-16 code units. */
const CHUNK_CHARS = 64 * 1024;

export interface WriteContext {
  styles: StyleRegistry;
  strings: SharedStrings | undefined;
  date1904: boolean;
  dateZone: "local" | "utc";
  /** Set when a formula cell has no cached value. */
  formulaWithoutValue: boolean;
}

// ------------------------------------------------------------ shared strings

/** The shared strings table: one <si> per distinct string or rich text. */
export class SharedStrings {
  private readonly index = new Map<string, number>();
  private readonly items: string[] = [];
  /** Number of cells that reference the table. */
  count = 0;

  /** Index of a plain string. */
  plain(s: string): number {
    this.count++;
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.items.length;
      this.items.push(`<si>${textElement(s)}</si>`);
      this.index.set(s, i);
    }
    return i;
  }

  /** Index of rich text, given its serialised runs. */
  rich(runsXml: string): number {
    this.count++;
    const key = `\u0000${runsXml}`; // cannot collide with a plain string: those never contain U+0000 raw
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.items.length;
      this.items.push(`<si>${runsXml}</si>`);
      this.index.set(key, i);
    }
    return i;
  }

  get uniqueCount(): number {
    return this.items.length;
  }

  toXml(): string {
    return `${XML_DECL}<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.items.length}">${this.items.join("")}</sst>`;
  }
}

function textElement(s: string): string {
  return needsPreserve(s) ? `<t xml:space="preserve">${xstring(s)}</t>` : `<t>${xstring(s)}</t>`;
}

// --------------------------------------------------------------- validation

function cellError(code: ExcelErrorCode, message: string, sheet: string, ref: string, extra?: Record<string, unknown>): ValidationError {
  return new ValidationError(code, `${message} (${sheet}!${ref}).`, { details: { sheet, ref, ...extra } });
}

/** A value object `{ error }` or `{ richText }`, as opposed to a Cell. */
function isValueObject(v: object): v is { error: ErrorCode } | RichText {
  return "error" in v || "richText" in v;
}

function typeOf(v: CellValue | null | undefined): CellType {
  if (v === null || v === undefined) return "empty";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (v instanceof Date) return "date";
  if (typeof v === "object" && "error" in v) return "error";
  return "richText";
}

// ---------------------------------------------------------------- sheet XML

export interface SheetPlan {
  sheet: Sheet;
  /** Used range, or undefined for an empty sheet. */
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  tabSelected: boolean;
}

/** Scans a sheet for its used range and checks the format's row and column limits. */
export function planSheet(sheet: Sheet, tabSelected: boolean): SheetPlan {
  const plan: SheetPlan = { sheet, minRow: Infinity, maxRow: -1, minCol: Infinity, maxCol: -1, tabSelected };
  const rows = sheet.rows;
  if (!Array.isArray(rows)) {
    throw new ValidationError("INVALID_CELL", `Sheet ${sheet.name}: rows must be an array of rows.`, { details: { sheet: sheet.name } });
  }
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (row === undefined || row === null) continue;
    if (!Array.isArray(row)) {
      throw new ValidationError("INVALID_CELL", `Sheet ${sheet.name}: row ${r + 1} must be an array of cells.`, { details: { sheet: sheet.name, row: r } });
    }
    let used = false;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell === undefined || cell === null) continue;
      if (c >= MAX_COLS) {
        throw new ValidationError("OUT_OF_BOUNDS", `Sheet ${sheet.name}: column ${c + 1} is beyond XFD.`, { details: { sheet: sheet.name, row: r, col: c } });
      }
      used = true;
      if (c < plan.minCol) plan.minCol = c;
      if (c > plan.maxCol) plan.maxCol = c;
    }
    if (used) {
      if (r >= MAX_ROWS) {
        throw new ValidationError("OUT_OF_BOUNDS", `Sheet ${sheet.name}: row ${r + 1} is beyond row ${MAX_ROWS}.`, { details: { sheet: sheet.name, row: r } });
      }
      if (r < plan.minRow) plan.minRow = r;
      plan.maxRow = r;
    }
  }
  return plan;
}

export function planRowCount(plan: SheetPlan): number {
  return plan.maxRow < 0 ? 0 : plan.maxRow - plan.minRow + 1;
}

/** Streams the worksheet XML as UTF-8 chunks. `onRow` is called after each row with data. */
export async function* sheetXml(plan: SheetPlan, ctx: WriteContext, onRow: () => void): AsyncGenerator<Uint8Array> {
  const { sheet } = plan;
  const name = sheet.name;
  const dimension =
    plan.maxRow < 0
      ? "A1"
      : plan.minRow === plan.maxRow && plan.minCol === plan.maxCol
        ? `${encodeCol(plan.minCol)}${plan.minRow + 1}`
        : `${encodeCol(plan.minCol)}${plan.minRow + 1}:${encodeCol(plan.maxCol)}${plan.maxRow + 1}`;

  let buf =
    `${XML_DECL}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews><sheetView${plan.tabSelected ? ' tabSelected="1"' : ""} workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    "<sheetData>";

  const colLetters: string[] = [];
  const letters = (c: number): string => (colLetters[c] ??= encodeCol(c));
  const rows = sheet.rows;
  const defaultStyle = sheet.defaultStyle;
  const colProps = sheet.colProps;
  const rowProps = sheet.rowProps;

  for (let r = plan.minRow; r <= plan.maxRow; r++) {
    const row = rows[r];
    if (!row) continue;
    const rowStyle = rowProps?.[r]?.style;
    const rowNum = r + 1;
    let rowXml = "";
    for (let c = 0; c < row.length; c++) {
      const input = row[c];
      if (input === undefined || input === null) continue;
      const ref = `${letters(c)}${rowNum}`;
      rowXml += cellXml(input, ref, name, ctx, [defaultStyle, colProps?.[c]?.style, rowStyle]);
    }
    if (rowXml) {
      buf += `<row r="${rowNum}">${rowXml}</row>`;
      onRow();
      if (buf.length >= CHUNK_CHARS) {
        yield encodeUtf8(buf);
        buf = "";
      }
    }
  }
  buf += "</sheetData></worksheet>";
  yield encodeUtf8(buf);
}

/** One <c> element. */
function cellXml(
  input: Exclude<CellInput, null | undefined>,
  ref: string,
  sheet: string,
  ctx: WriteContext,
  layers: [Style | undefined, Style | undefined, Style | undefined],
): string {
  let cell: Cell;
  if (typeof input !== "object" || input instanceof Date || isValueObject(input)) cell = { value: input };
  else cell = input;

  const value = cell.value;
  const vtype = typeOf(value);
  if (cell.type !== undefined && cell.type !== vtype) {
    throw cellError("INVALID_CELL", `Cell type '${cell.type}' does not match its value (${vtype})`, sheet, ref, { type: cell.type });
  }

  let formula: string | undefined;
  if (cell.formula !== undefined) {
    if (typeof cell.formula !== "string") throw cellError("INVALID_CELL", "formula must be a string", sheet, ref);
    formula = cell.formula.startsWith("=") ? cell.formula.slice(1) : cell.formula;
    if (formula.length === 0) throw cellError("INVALID_CELL", "formula is empty", sheet, ref);
    if (vtype === "richText") throw cellError("INVALID_CELL", "A formula's cached value cannot be rich text", sheet, ref);
  }
  if (cell.arrayRef !== undefined && formula === undefined) {
    throw cellError("INVALID_CELL", "arrayRef needs a formula", sheet, ref);
  }

  const s = ctx.styles.xfFor([...layers, cell.style], vtype === "date", { sheet, ref });
  const sAttr = s === 0 ? "" : ` s="${s}"`;

  if (formula !== undefined) {
    let f: string;
    if (cell.arrayRef !== undefined) {
      try {
        decodeRange(cell.arrayRef);
      } catch {
        throw cellError("INVALID_REF", `arrayRef ${JSON.stringify(cell.arrayRef)} is not an A1 range`, sheet, ref);
      }
      f = `<f t="array" ref="${cell.arrayRef}">${xstring(formula)}</f>`;
    } else f = `<f>${xstring(formula)}</f>`;
    if (vtype === "empty") {
      ctx.formulaWithoutValue = true;
      return `<c r="${ref}"${sAttr}>${f}</c>`;
    }
    const { t, v } = scalar(value as Exclude<CellValue, RichText>, vtype, sheet, ref, ctx, true);
    return `<c r="${ref}"${sAttr}${t}>${f}<v>${v}</v></c>`;
  }

  if (vtype === "empty") return `<c r="${ref}"${sAttr}/>`;

  if (vtype === "string") {
    const str = value as string;
    if (str.length > MAX_CELL_CHARS) throw cellError("STRING_TOO_LONG", `Text longer than ${MAX_CELL_CHARS} characters`, sheet, ref, { length: str.length });
    if (ctx.strings) return `<c r="${ref}"${sAttr} t="s"><v>${ctx.strings.plain(str)}</v></c>`;
    return `<c r="${ref}"${sAttr} t="inlineStr"><is>${textElement(str)}</is></c>`;
  }

  if (vtype === "richText") {
    const runs = richRunsXml(value as RichText, [...layers, cell.style], sheet, ref, ctx);
    if (ctx.strings) return `<c r="${ref}"${sAttr} t="s"><v>${ctx.strings.rich(runs)}</v></c>`;
    return `<c r="${ref}"${sAttr} t="inlineStr"><is>${runs}</is></c>`;
  }

  const { t, v } = scalar(value as Exclude<CellValue, RichText | string>, vtype, sheet, ref, ctx, false);
  return `<c r="${ref}"${sAttr}${t}><v>${v}</v></c>`;
}

/** Number, boolean, date or error value (or a formula's string result). */
function scalar(
  value: Exclude<CellValue, RichText>,
  vtype: CellType,
  sheet: string,
  ref: string,
  ctx: WriteContext,
  isFormula: boolean,
): { t: string; v: string } {
  switch (vtype) {
    case "number": {
      const n = value as number;
      if (!Number.isFinite(n)) throw cellError("INVALID_NUMBER", `Number ${String(n)} cannot be stored`, sheet, ref);
      return { t: "", v: num(n) };
    }
    case "boolean":
      return { t: ' t="b"', v: value ? "1" : "0" };
    case "date": {
      let serial: number;
      try {
        serial = dateToSerial(value as Date, { date1904: ctx.date1904, dateZone: ctx.dateZone });
      } catch {
        throw cellError("INVALID_DATE", "Date is invalid or outside 1900-01-01..9999-12-31 (1904 system: 1904-01-01..)", sheet, ref);
      }
      return { t: "", v: num(serial) };
    }
    case "error": {
      const code = (value as { error: unknown }).error;
      if (typeof code !== "string" || !ERROR_CODES.has(code)) {
        throw cellError("INVALID_CELL", `Unknown error value ${JSON.stringify(code)}`, sheet, ref);
      }
      return { t: ' t="e"', v: code };
    }
    case "string": {
      // Only reached for a formula's cached string result.
      const str = value as string;
      if (!isFormula) throw new Error("unreachable");
      if (str.length > MAX_CELL_CHARS) throw cellError("STRING_TOO_LONG", `Text longer than ${MAX_CELL_CHARS} characters`, sheet, ref, { length: str.length });
      return { t: ' t="str"', v: xstring(str) };
    }
    default:
      throw cellError("INVALID_CELL", "Unsupported cell value", sheet, ref);
  }
}

function richRunsXml(value: RichText, layers: Array<Style | undefined>, sheet: string, ref: string, ctx: WriteContext): string {
  const runs = value.richText;
  if (!Array.isArray(runs) || runs.length === 0) throw cellError("INVALID_CELL", "richText needs at least one run", sheet, ref);
  let base: NFont | undefined;
  let length = 0;
  let x = "";
  for (const run of runs) {
    if (typeof run !== "object" || run === null || typeof run.text !== "string") {
      throw cellError("INVALID_CELL", "Each rich-text run needs a text string", sheet, ref);
    }
    length += run.text.length;
    if (run.font) {
      // Runs are merged over the cell's resolved font, so { bold: true } keeps the cell's size and typeface.
      base ??= ctx.styles.fontOf(mergeStyles(...layers), { sheet, ref });
      const font = ctx.styles.runFont(run.font, base, { sheet, ref })!;
      x += `<r><rPr>${fontXml(font, "rFont")}</rPr>${textElement(run.text)}</r>`;
    } else {
      x += `<r>${textElement(run.text)}</r>`;
    }
  }
  if (length > MAX_CELL_CHARS) throw cellError("STRING_TOO_LONG", `Text longer than ${MAX_CELL_CHARS} characters`, sheet, ref, { length });
  return x;
}

