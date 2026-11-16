/**
 * Date and time rendering from Excel serials (docs/api.md §5.7). Pure
 * arithmetic on the serial: no Date in the local zone is ever built, so the
 * output does not depend on the machine's time zone.
 */

import { compile, type Section } from "./parse";
import { lcidLocale, localeData, type LocaleData } from "./locale";

const DAY = 86_400;
/** Largest serial Excel shows as a date: 9999-12-31 in the 1900 system. */
const MAX_1900 = 2_958_465;
const MAX_1904 = MAX_1900 - 1462;

interface Parts {
  y: number;
  mo: number; // 1..12
  d: number; // 0..31 (0 only for Excel's 1900-01-00)
  wd: number; // 0 = Sunday
  H: number;
  M: number;
  S: number;
  sub: number; // sub-second units at `digits` precision
  // Elapsed totals
  totalH: number;
  totalM: number;
  totalS: number;
}

function parts(serial: number, date1904: boolean, digits: number): Parts {
  const unit = 10 ** digits;
  // Round the whole value to the displayed precision first, as Excel does: 0.99999999 days shows as the next day 00:00.
  const units = Math.round(serial * DAY * unit);
  const totalS = Math.floor(units / unit);
  const sub = units - totalS * unit;
  const days = Math.floor(totalS / DAY);
  const secs = totalS - days * DAY;
  let y: number;
  let mo: number;
  let d: number;
  if (!date1904 && days === 60) [y, mo, d] = [1900, 2, 29];
  else if (!date1904 && days === 0) [y, mo, d] = [1900, 1, 0];
  else {
    const base = date1904 ? Date.UTC(1904, 0, 1) : days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
    const t = new Date(base + days * DAY * 1000);
    [y, mo, d] = [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  }
  // Weekdays follow Excel, where serial 1 (1900-01-01) is a Sunday; from 1900-03-01 on they match the calendar.
  const wd = date1904 ? (((days + 5) % 7) + 7) % 7 : (((days + 6) % 7) + 7) % 7;
  return {
    y, mo, d, wd,
    H: Math.floor(secs / 3600),
    M: Math.floor((secs % 3600) / 60),
    S: secs % 60,
    sub,
    totalH: Math.floor(totalS / 3600),
    totalM: Math.floor(totalS / 60),
    totalS,
  };
}

const two = (n: number): string => String(n).padStart(2, "0");

export interface DateOut {
  text: string;
  fill?: { char: string; at: number } | undefined;
}

/** Formats a serial with a date section. Returns null when Excel would show a cell full of '#'. */
export function formatDate(sec: Section, serial: number, date1904: boolean, loc: LocaleData): DateOut | null {
  const hasElapsed = sec.toks.some((t) => t.t === "elapsed");
  if (!Number.isFinite(serial) || (serial < 0 && !hasElapsed) || serial > (date1904 ? MAX_1904 : MAX_1900) + 1) return null;
  if (sec.system) return { text: systemFormat(sec.system, serial, date1904, loc) };
  const names = sec.lcid !== undefined ? localeData(lcidLocale(sec.lcid) ?? loc.tag) : loc;
  const digits = sec.toks.reduce((m, t) => (t.t === "subsec" ? Math.max(m, t.n) : m), 0);
  const neg = serial < 0;
  const p = parts(Math.abs(serial), date1904, digits);
  const ampm = sec.toks.some((t) => t.t === "ampm");
  // With [h], minutes and seconds are within the hour; with [m], seconds within the minute.
  const elapsedKind = sec.toks.find((t) => t.t === "elapsed") as { k: "h" | "m" | "s" } | undefined;
  let text = neg ? "-" : "";
  let fill: { char: string; at: number } | undefined;
  for (const t of sec.toks) {
    switch (t.t) {
      case "lit":
        text += t.s;
        break;
      case "space":
        text += " ";
        break;
      case "fill":
        if (!fill) fill = { char: t.c, at: text.length };
        break;
      case "elapsed": {
        const v = t.k === "h" ? p.totalH : t.k === "m" ? (elapsedKind?.k === "h" ? p.M : p.totalM) : elapsedKind?.k === "s" ? p.totalS : p.S;
        text += String(v).padStart(t.n, "0");
        break;
      }
      case "minute": {
        const m = elapsedKind?.k === "m" ? p.totalM : p.M;
        text += t.n >= 2 ? two(m) : String(m);
        break;
      }
      case "subsec":
        text += loc.decimal + String(p.sub).padStart(digits, "0").slice(0, t.n);
        break;
      case "ampm": {
        const pm = p.H >= 12;
        const lower = t.s[0] === t.s[0]!.toLowerCase();
        const word = t.s.length === 3 ? (pm ? "P" : "A") : pm ? "PM" : "AM";
        text += lower ? word.toLowerCase() : word;
        break;
      }
      case "date":
        text += dateToken(t.k, t.n, p, ampm, names);
        break;
      default:
        break;
    }
  }
  return fill ? { text, fill } : { text };
}

function dateToken(k: string, n: number, p: Parts, ampm: boolean, loc: LocaleData): string {
  switch (k) {
    case "y":
    case "e":
      // 'e' is the era year; for the Gregorian calendar it is the full year `[to verify for East Asian locales]`.
      return k === "y" && n <= 2 ? two(p.y % 100) : String(p.y);
    case "b": {
      // Buddhist era year (Gregorian + 543) `[to verify]`.
      const by = p.y + 543;
      return n <= 2 ? two(by % 100) : String(by);
    }
    case "g":
      // Era names (Japanese, Taiwanese calendars) are not rendered `[to verify]`.
      return "";
    case "m":
      if (n === 1) return String(p.mo);
      if (n === 2) return two(p.mo);
      if (n === 3) return loc.monthsShort[p.mo - 1] ?? "";
      if (n === 5) return (loc.monthsLong[p.mo - 1] ?? "").slice(0, 1);
      return loc.monthsLong[p.mo - 1] ?? "";
    case "d":
      if (n === 1) return String(p.d);
      if (n === 2) return two(p.d);
      if (n === 3) return loc.daysShort[p.wd] ?? "";
      return loc.daysLong[p.wd] ?? "";
    case "h": {
      const h = ampm ? p.H % 12 || 12 : p.H;
      return n >= 2 ? two(h) : String(h);
    }
    case "s":
      return n >= 2 ? two(p.S) : String(p.S);
    default:
      return "";
  }
}

const systemCache = new Map<string, Section>();

/** Excel's system long date ([$-F800]) and time ([$-F400]), from Intl `[to verify against Windows settings]`. */
function systemFormat(kind: "longDate" | "time", serial: number, date1904: boolean, loc: LocaleData): string {
  const p = parts(serial, date1904, 0);
  const t = Date.UTC(p.y, p.mo - 1, Math.max(1, p.d), p.H, p.M, p.S);
  const opts: Intl.DateTimeFormatOptions = kind === "longDate" ? { dateStyle: "full", timeZone: "UTC" } : { timeStyle: "medium", timeZone: "UTC" };
  return new Intl.DateTimeFormat(loc.tag, opts).format(t);
}

/** The locale's numeric short date with a four-digit year, as a compiled section (built-in id 14). */
export function shortDateSection(loc: LocaleData, withTime: boolean): Section {
  const code = loc.shortDate.join("") + (withTime ? " h:mm" : "");
  let sec = systemCache.get(code);
  if (!sec) {
    sec = compile(code).sections[0]!;
    systemCache.set(code, sec);
  }
  return sec;
}
