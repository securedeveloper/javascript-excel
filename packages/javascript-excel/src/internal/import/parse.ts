/**
 * Locale-aware number and date parsing for javascript-excel/import
 * (docs/api.md §5.6). Hand-written scanners: input is untrusted, so there is
 * no regex backtracking and every loop is linear.
 */

import { parseIsoDate } from "../csv/infer";

export type NumberGroup = "," | "." | " " | "'" | "";

const MAX_TEXT = 64;

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

function isGroupChar(c: number, group: NumberGroup): boolean {
  if (group === "") return false;
  if (group === " ") return c === 32 || c === 0xa0 || c === 0x202f;
  return c === group.charCodeAt(0);
}

/**
 * Parses `text` as a number written with `decimal` and `group` separators.
 * Returns undefined for anything else (leading zeros, misplaced groups,
 * percent or currency signs, integers beyond 2^53).
 */
export function parseNumber(text: string, options: { decimal?: "." | ","; group?: NumberGroup } = {}): number | undefined {
  const decimal = options.decimal ?? ".";
  const group = options.group ?? "";
  if (decimal !== "." && decimal !== ",") throw new TypeError(`decimal must be '.' or ',', got ${JSON.stringify(decimal)}`);
  if (![",", ".", " ", "'", ""].includes(group)) throw new TypeError(`group must be one of , . space ' or '', got ${JSON.stringify(group)}`);
  if (group === decimal) throw new TypeError("decimal and group must differ");
  const s = text.trim();
  const n = s.length;
  if (n === 0 || n > MAX_TEXT) return undefined;
  const dec = decimal.charCodeAt(0);
  let i = 0;
  let out = "";
  const c0 = s.charCodeAt(0);
  if (c0 === 43 || c0 === 45) {
    if (c0 === 45) out = "-";
    i = 1;
  }
  // Integer part: digits, optionally grouped in threes after the first group.
  const intStart = i;
  let digits = 0;
  let groups = 0;
  let sinceGroup = 0;
  let firstGroupLen = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (isDigit(c)) {
      out += s[i];
      digits++;
      sinceGroup++;
      i++;
    } else if (isGroupChar(c, group) && digits > 0) {
      if (groups === 0) firstGroupLen = sinceGroup;
      else if (sinceGroup !== 3) return undefined;
      if (firstGroupLen > 3) return undefined;
      groups++;
      sinceGroup = 0;
      i++;
    } else break;
  }
  if (groups > 0 && sinceGroup !== 3) return undefined;
  const intDigits = s.slice(intStart, i);
  let fraction = false;
  if (i < n && s.charCodeAt(i) === dec) {
    i++;
    const fracStart = i;
    while (i < n && isDigit(s.charCodeAt(i))) i++;
    if (i === fracStart) return undefined; // "1." is not a number
    out += "." + s.slice(fracStart, i);
    fraction = true;
  }
  if (digits === 0 && !fraction) return undefined;
  // Leading zeros: "007" stays text; "0" and "0.5" are numbers.
  if (digits > 1 && intDigits.charCodeAt(0) === 48) return undefined;
  let exponent = false;
  if (i < n && (s.charCodeAt(i) === 101 || s.charCodeAt(i) === 69) && decimal === ".") {
    let j = i + 1;
    if (j < n && (s.charCodeAt(j) === 43 || s.charCodeAt(j) === 45)) j++;
    const expStart = j;
    while (j < n && isDigit(s.charCodeAt(j))) j++;
    if (j === expStart) return undefined;
    out += "e" + s.slice(i + 1, j);
    i = j;
    exponent = true;
  }
  if (i !== n) return undefined;
  const value = Number(digits === 0 ? out.replace(/^(-?)\./, "$10.") : out);
  if (!Number.isFinite(value)) return undefined;
  if (!fraction && !exponent && !Number.isSafeInteger(value)) return undefined;
  return value;
}

export type DateOrder = "YMD" | "DMY" | "MDY";

/** The three numeric parts of a date such as 15/01/2024, plus the time, or undefined. */
export interface DateParts {
  a: number;
  b: number;
  c: number;
  aLen: number;
  cLen: number;
  h: number;
  mi: number;
  s: number;
  hasTime: boolean;
}

/** Splits "15/01/2024", "2024.01.15" or "1-2-2024 13:45:10" into numbers; one separator throughout. */
export function dateParts(text: string): DateParts | undefined {
  const s = text.trim();
  const n = s.length;
  if (n < 8 || n > 24) return undefined;
  const nums: number[] = [];
  const lens: number[] = [];
  let i = 0;
  let sep = -1;
  for (let k = 0; k < 3; k++) {
    const start = i;
    while (i < n && isDigit(s.charCodeAt(i))) i++;
    const len = i - start;
    if (len === 0 || len > 4) return undefined;
    nums.push(+s.slice(start, i));
    lens.push(len);
    if (k < 2) {
      const c = s.charCodeAt(i);
      if (c !== 47 && c !== 46 && c !== 45) return undefined; // / . -
      if (sep === -1) sep = c;
      else if (c !== sep) return undefined;
      i++;
    }
  }
  let h = 0;
  let mi = 0;
  let sec = 0;
  let hasTime = false;
  if (i < n) {
    if (s.charCodeAt(i) !== 32) return undefined;
    const m = /^ (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.slice(i));
    if (!m) return undefined;
    h = +m[1]!;
    mi = +m[2]!;
    sec = m[3] === undefined ? 0 : +m[3];
    if (h > 23 || mi > 59 || sec > 59) return undefined;
    hasTime = true;
  }
  return { a: nums[0]!, b: nums[1]!, c: nums[2]!, aLen: lens[0]!, cLen: lens[2]!, h, mi, s: sec, hasTime };
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Builds the date for parts in `order`; undefined if the parts don't fit it. Years must have four digits. */
export function dateFromParts(p: DateParts, order: DateOrder, zone: "local" | "utc"): Date | undefined {
  let y: number, mo: number, d: number;
  if (order === "YMD") {
    if (p.aLen !== 4) return undefined;
    [y, mo, d] = [p.a, p.b, p.c];
  } else {
    if (p.cLen !== 4) return undefined;
    [y, mo, d] = order === "DMY" ? [p.c, p.b, p.a] : [p.c, p.a, p.b];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return undefined;
  const t = zone === "utc" ? Date.UTC(y, mo - 1, d, p.h, p.mi, p.s) : new Date(y, mo - 1, d, p.h, p.mi, p.s).getTime();
  const date = new Date(t);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** ISO 8601 always; numeric dates (d/m/yyyy, …) only with `order`. Two-digit years are not accepted. */
export function parseDate(text: string, options: { order?: DateOrder; zone?: "local" | "utc" } = {}): Date | undefined {
  const zone = options.zone ?? "local";
  if (zone !== "local" && zone !== "utc") throw new TypeError(`zone must be 'local' or 'utc', got ${JSON.stringify(zone)}`);
  if (options.order !== undefined && options.order !== "YMD" && options.order !== "DMY" && options.order !== "MDY") {
    throw new TypeError(`order must be 'YMD', 'DMY' or 'MDY', got ${JSON.stringify(options.order)}`);
  }
  const s = text.trim();
  if (s.length >= 10 && s.length <= 40 && s.charCodeAt(4) === 45) {
    const iso = parseIsoDate(s, zone);
    if (iso) return iso;
  }
  if (!options.order) return undefined;
  const p = dateParts(s);
  return p ? dateFromParts(p, options.order, zone) : undefined;
}

/** TRUE/FALSE in any case. */
export function parseBoolean(text: string): boolean | undefined {
  const s = text.trim().toLowerCase();
  return s === "true" ? true : s === "false" ? false : undefined;
}
