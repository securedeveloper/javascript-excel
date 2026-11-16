/**
 * Type inference for `inferTypes: true` (docs/api.md §5.3): numbers,
 * TRUE/FALSE and ISO 8601 dates. No locale guessing: `1,5`, `1.000,00` and
 * `15/01/2024` stay strings. Values that would not survive the conversion
 * also stay strings, so `007` (leading zero) and `12345678901234567890`
 * (beyond double precision) keep their text.
 */

import type { CellValue } from "../../model";

const NUMBER = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const FRACTION = /^[+-]?\.\d+(?:[eE][+-]?\d+)?$/;
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferValue(text: string, zone: "local" | "utc"): CellValue {
  const len = text.length;
  if (len === 0 || len > 64) return text;
  const c = text.charCodeAt(0);
  if (c === 84 || c === 116 || c === 70 || c === 102) {
    // T t F f
    if (text === "TRUE" || text === "true") return true;
    if (text === "FALSE" || text === "false") return false;
    return text;
  }
  const isDigitStart = (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46; // 0-9 + - .
  if (!isDigitStart) return text;
  if (NUMBER.test(text) || FRACTION.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return text;
    // Integers beyond 2^53 would silently change; keep their text.
    if (!/[.eE]/.test(text) && !Number.isSafeInteger(n)) return text;
    return n;
  }
  if (len >= 10 && text.charCodeAt(4) === 45) {
    const d = parseIsoDate(text, zone);
    if (d) return d;
  }
  return text;
}

/** Parses an ISO 8601 date or date-time; without an offset, `zone` applies. */
export function parseIsoDate(text: string, zone: "local" | "utc"): Date | undefined {
  const m = ISO.exec(text);
  if (!m) return undefined;
  const y = +m[1]!;
  const mo = +m[2]!;
  const d = +m[3]!;
  const h = m[4] === undefined ? 0 : +m[4];
  const mi = m[5] === undefined ? 0 : +m[5];
  const s = m[6] === undefined ? 0 : +m[6];
  const ms = m[7] === undefined ? 0 : +m[7].padEnd(3, "0");
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return undefined;
  const offset = m[8];
  let t: number;
  if (offset === undefined) {
    if (zone === "utc") t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
    else {
      const local = new Date(y, mo - 1, d, h, mi, s, ms);
      if (y < 100) local.setFullYear(y);
      t = local.getTime();
    }
    if (zone === "utc" && y < 100) {
      const u = new Date(t);
      u.setUTCFullYear(y);
      t = u.getTime();
    }
  } else {
    t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
    if (y < 100) {
      const u = new Date(t);
      u.setUTCFullYear(y);
      t = u.getTime();
    }
    if (offset !== "Z") {
      const sign = offset[0] === "-" ? -1 : 1;
      const digits = offset.slice(1).replace(":", "");
      const oh = +digits.slice(0, 2);
      const om = +digits.slice(2, 4);
      if (oh > 23 || om > 59) return undefined;
      t -= sign * (oh * 60 + om) * 60_000;
    }
  }
  const date = new Date(t);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}
