/**
 * javascript-excel/format: renders values with Excel number formats
 * (docs/api.md §5.6), for viewers, previews and "as displayed" text.
 *
 * Dates are formatted from Excel serials, so the result does not depend on
 * the time zone. Locale data (separators, month and day names, the short
 * date) comes from Intl. Nothing here throws for a malformed code: unknown
 * characters are shown as literal text.
 *
 * @module javascript-excel/format
 */

import { cellText } from "./cells";
import { dateToSerial } from "./dates";
import { compile, type Compiled, type Section } from "./internal/format/parse";
import { localeData, NAMED_COLORS, paletteColor, type LocaleData } from "./internal/format/locale";
import { formatDate, shortDateSection } from "./internal/format/date";
import { formatNumber, general } from "./internal/format/number";
import type { Cell, CellErrorValue, CellInput, NumFmt, RichText } from "./model";
import { BUILTIN_NUM_FMTS } from "./numfmt";

export type { Cell, CellErrorValue, CellInput, NumFmt, RichText } from "./model";

/** What `formatValue` accepts: a cell's value. A Date is converted to a serial first (`dateZone`, `date1904`). */
export type FormatInput = number | string | boolean | Date | CellErrorValue | RichText | null | undefined;

/** Options for `formatValue` and `formatCell`. */
export interface FormatOptions {
  /** BCP 47 locale for separators, month and day names and locale-dependent built-in formats. Default 'en-US'. */
  locale?: string | undefined;
  /** The workbook uses the 1904 date system (`workbook.date1904`). Default false. */
  date1904?: boolean | undefined;
  /** How a Date input becomes a serial: its local or its UTC fields. Default 'local', as the writer (§3.4.1). Serial inputs ignore it. */
  dateZone?: "local" | "utc" | undefined;
  /** Characters available to the General format before it rounds or switches to scientific notation. Default 11 `[to verify]`. */
  generalWidth?: number | undefined;
  /** The workbook's custom indexed palette (`workbook.indexedColors`), for [ColorN] colours. */
  indexedColors?: readonly string[] | undefined;
}

/** A formatted value. */
export interface FormattedValue {
  /** The text Excel shows, without the repeat characters of a `*x` fill. */
  text: string;
  /** Colour from the format section ([Red], [Color10]) as ARGB 'FFRRGGBB'. Overrides the font colour. */
  color?: string | undefined;
  /**
   * A `*x` fill: repeat `char` at `at` (an index into `text`) until the cell is full.
   * Also used with `char: '#'` and `text: ''` for a date Excel cannot show (negative or past 9999-12-31): the cell fills with '#'.
   */
  fill?: { char: string; at: number } | undefined;
  /** How Excel aligns the value under 'general' horizontal alignment: numbers and dates right, text left, booleans and errors centred. */
  align: "left" | "center" | "right";
}

const BUILTIN_EXTRA: Readonly<Record<number, string>> = {
  // Locale-dependent currency and accounting ids, as Excel en-US shows them `[to verify for other locales]`.
  5: '"$"#,##0_);\\("$"#,##0\\)',
  6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  7: '"$"#,##0.00_);\\("$"#,##0.00\\)',
  8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
};
/** Ids that show the locale's short date: 14, and the East Asian ids 27–31, 36 and 50–58 `[to verify per locale]`. */
const SHORT_DATE_IDS = new Set([14, 27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
/** Ids 32–35 are times in the East Asian locales that define them; shown as h:mm:ss, as LibreOffice does in en-US `[to verify]`. */
const TIME_IDS = new Set([32, 33, 34, 35]);

const compiled = new Map<string, Compiled>();
const GENERAL: Compiled = compile("General");

function compileCached(code: string): Compiled {
  let c = compiled.get(code);
  if (!c) {
    c = compile(code);
    if (compiled.size >= 1000) compiled.clear();
    compiled.set(code, c);
  }
  return c;
}

/** The compiled format for a NumFmt, or null for the locale short date (with or without time). */
function resolve(numFmt: NumFmt | undefined, loc: LocaleData): Compiled {
  if (numFmt === undefined || numFmt === 0 || numFmt === "General") return GENERAL;
  if (typeof numFmt === "number") {
    if (SHORT_DATE_IDS.has(numFmt)) return { sections: [shortDateSection(loc, false)] };
    if (numFmt === 22) return { sections: [shortDateSection(loc, true)] };
    if (TIME_IDS.has(numFmt)) return compileCached("h:mm:ss");
    const code = BUILTIN_NUM_FMTS[numFmt] ?? BUILTIN_EXTRA[numFmt];
    return code === undefined ? GENERAL : compileCached(code);
  }
  return compileCached(numFmt);
}

const holds = (cond: { op: string; v: number }, x: number): boolean => {
  switch (cond.op) {
    case "<":
      return x < cond.v;
    case "<=":
      return x <= cond.v;
    case ">":
      return x > cond.v;
    case ">=":
      return x >= cond.v;
    case "=":
      return x === cond.v;
    default:
      return x !== cond.v;
  }
};

/**
 * Picks the section for a number and whether its minus sign is shown.
 * Without conditions: one section for all; two: non-negative, negative (shown without its sign);
 * three: positive, negative, zero. With a condition on the first or second section, the first
 * section whose condition holds wins, and the next section without a condition takes the rest.
 * A conditional section that only admits negative numbers ([<0], [<=-1]) drops the sign, like the
 * implicit negative section; other conditional sections keep it `[to verify against Excel]`.
 */
function pick(sections: Section[], v: number): { sec: Section | undefined; signed: boolean } {
  const n = Math.min(sections.length, 3);
  const [a, b, c] = sections;
  const signed = (s: Section | undefined): boolean => !(s?.cond && (s.cond.op === "<" ? s.cond.v <= 0 : s.cond.op === "<=" ? s.cond.v < 0 : false));
  if (a?.cond || (n >= 2 && b?.cond)) {
    if (!a?.cond || holds(a.cond, v)) return { sec: a, signed: signed(a) };
    if (n < 2) return { sec: undefined, signed: true };
    if (!b!.cond || holds(b!.cond, v)) return { sec: b, signed: signed(b) };
    return { sec: n >= 3 ? c : undefined, signed: true };
  }
  if (n >= 3 && v === 0) return { sec: c, signed: false };
  if (n >= 2 && v < 0) return { sec: b, signed: false };
  return { sec: a, signed: true };
}

function colorOf(sec: Section | undefined, opts: FormatOptions | undefined): string | undefined {
  const c = sec?.color;
  if (!c) return undefined;
  return "name" in c ? NAMED_COLORS[c.name] : paletteColor(c.index, opts?.indexedColors);
}

function done(text: string, align: FormattedValue["align"], sec?: Section, opts?: FormatOptions, fill?: { char: string; at: number }): FormattedValue {
  const out: FormattedValue = { text, align };
  const color = colorOf(sec, opts);
  if (color) out.color = color;
  if (fill) out.fill = fill;
  return out;
}

function formatNumberValue(v: number, fmt: Compiled, loc: LocaleData, opts: FormatOptions | undefined): FormattedValue {
  const width = opts?.generalWidth ?? 11;
  if (!Number.isFinite(v)) return done("#NUM!", "center");
  const { sec, signed } = pick(fmt.sections, v);
  if (!sec) return done(general(v, loc, width), "right");
  const minus = signed && v < 0 ? "-" : "";
  const abs = Math.abs(v);
  switch (sec.kind) {
    case "date": {
      const r = formatDate(sec, signed ? v : abs, opts?.date1904 === true, loc);
      if (r === null) return done("", "right", undefined, undefined, { char: "#", at: 0 });
      return done(r.text, "right", sec, opts, r.fill);
    }
    case "general":
    case "number": {
      const r = formatNumber(sec, abs, loc, width);
      // A minus sign only when something non-zero is shown (Excel shows 0.00, not -0.00, for -0.001) `[to verify]`.
      const showMinus = minus && /[1-9]/.test(r.text);
      const text = showMinus ? `-${r.text}` : r.text;
      return done(text, "right", sec, opts, r.fill ? { char: r.fill.char, at: r.fill.at + (showMinus ? 1 : 0) } : undefined);
    }
    case "text":
      // A text-only format such as "@" shows numbers as General.
      return done(general(v, loc, width), "right", sec, opts);
    default: {
      const r = formatNumber(sec, abs, loc, width);
      return done(minus + r.text, "right", sec, opts, r.fill ? { char: r.fill.char, at: r.fill.at + minus.length } : undefined);
    }
  }
}

function formatText(s: string, fmt: Compiled, opts: FormatOptions | undefined, loc: LocaleData): FormattedValue {
  const sections = fmt.sections;
  const sec = sections.length === 4 ? sections[3] : sections.find((x) => x.kind === "text");
  if (!sec) return done(s, "left");
  let text = "";
  let fill: { char: string; at: number } | undefined;
  for (const t of sec.toks) {
    if (t.t === "text") text += s;
    else if (t.t === "lit") text += t.s;
    else if (t.t === "space") text += " ";
    else if (t.t === "fill") fill ??= { char: t.c, at: text.length };
    else if (t.t === "point") text += loc.decimal;
    else if (t.t === "digit") text += t.c;
  }
  return done(text, "left", sec, opts, fill);
}

/**
 * Formats a value with a number format, as Excel shows it in a cell.
 *
 * `numFmt` is a built-in id or a format code (§3.5.5); undefined is General.
 * Numbers are serials for date formats. A Date is converted with
 * `dateToSerial` (`dateZone`, `date1904`). Text uses the format's text
 * section; booleans show TRUE/FALSE and errors as written, whatever the format.
 */
export function formatValue(value: FormatInput, numFmt?: NumFmt, options?: FormatOptions): FormattedValue {
  const loc = localeData(options?.locale);
  if (value === null || value === undefined) return { text: "", align: "left" };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", align: "center" };
  if (value instanceof Date) {
    let serial: number;
    try {
      serial = dateToSerial(value, { date1904: options?.date1904, dateZone: options?.dateZone });
    } catch {
      return { text: "", align: "right", fill: { char: "#", at: 0 } };
    }
    return formatNumberValue(serial, resolve(numFmt, loc), loc, options);
  }
  if (typeof value === "number") return formatNumberValue(value === 0 ? 0 : value, resolve(numFmt, loc), loc, options);
  if (typeof value === "string") return formatText(value, resolve(numFmt, loc), options, loc);
  if ("error" in value) return { text: value.error, align: "center" };
  return formatText(cellText(value), resolve(numFmt, loc), options, loc);
}

/**
 * Formats a cell (§3.4) with its own number format (`cell.style.numFmt`).
 * A formula cell shows its cached value; without one the text is empty.
 */
export function formatCell(cell: CellInput, options?: FormatOptions): FormattedValue {
  if (cell === null || cell === undefined) return { text: "", align: "left" };
  if (typeof cell !== "object" || cell instanceof Date || "error" in cell || "richText" in cell) return formatValue(cell as FormatInput, undefined, options);
  const c = cell as Cell;
  return formatValue(c.value as FormatInput, c.style?.numFmt, options);
}
