/**
 * Date ↔ serial conversion (docs/api.md §3.4.1, §4.5).
 *
 * 1900 system: serial 1 = 1900-01-01. Excel treats 1900 as a leap year, so
 * serial 60 is the non-existent 1900-02-29: dates before 1900-03-01 use the
 * epoch 1899-12-31, later dates 1899-12-30.
 * 1904 system: serial 0 = 1904-01-01.
 *
 * `dateZone: 'local'` (default) reads and builds dates from their local
 * calendar fields, so `new Date(2024, 0, 15)` is serial 45306 in every zone.
 * `'utc'` uses the UTC fields.
 */

import { ValidationError } from "./errors";

/** Options for date conversion. */
export interface DateOptions {
  /** Use the 1904 date system. Default false. */
  date1904?: boolean | undefined;
  /** Default 'local'. */
  dateZone?: "local" | "utc" | undefined;
}

const DAY_MS = 86_400_000;
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1900_EARLY = Date.UTC(1899, 11, 31);
const LEAP_BUG_START = Date.UTC(1900, 2, 1); // first date after the fictitious 1900-02-29
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const MIN_1900 = Date.UTC(1900, 0, 1);
const MAX = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

/** Wall-clock time of `d` in the chosen zone, as UTC milliseconds. */
function wallClock(d: Date, zone: "local" | "utc"): number {
  if (zone === "utc") return d.getTime();
  // Years 0..99 would be mapped to 1900..1999 by Date.UTC, but they are out of range anyway (checked by the caller).
  const year = d.getFullYear();
  if (year < 1000) return Number.NaN;
  return Date.UTC(year, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/**
 * Converts a Date to an Excel serial number.
 * Throws `INVALID_DATE` for an invalid Date or one outside the date system's
 * range (1900-01-01 or 1904-01-01 to 9999-12-31).
 */
export function dateToSerial(d: Date, options?: DateOptions): number {
  const ms = Number.isFinite(d.getTime()) ? wallClock(d, options?.dateZone ?? "local") : Number.NaN;
  const min = options?.date1904 ? EPOCH_1904 : MIN_1900;
  if (!Number.isFinite(ms) || ms < min || ms > MAX) {
    throw new ValidationError("INVALID_DATE", `Date ${String(d)} is outside the range Excel can store.`, {
      details: { value: Number.isFinite(d.getTime()) ? d.toISOString() : "Invalid Date" },
    });
  }
  if (options?.date1904) return (ms - EPOCH_1904) / DAY_MS;
  return (ms - (ms < LEAP_BUG_START ? EPOCH_1900_EARLY : EPOCH_1900)) / DAY_MS;
}

/**
 * Converts an Excel serial number to a Date (inverse of `dateToSerial`).
 * Serial 60 in the 1900 system (Excel's fictitious 1900-02-29) has no real
 * date and gives 1900-03-01. Throws `INVALID_DATE` for non-finite or
 * out-of-range serials.
 */
export function serialToDate(serial: number, options?: DateOptions): Date {
  const max = options?.date1904 ? (MAX - EPOCH_1904) / DAY_MS : (MAX - EPOCH_1900) / DAY_MS;
  const min = options?.date1904 ? 0 : 1;
  if (!Number.isFinite(serial) || serial < min || serial > max) {
    throw new ValidationError("INVALID_DATE", `Serial ${serial} is not a valid date.`, { details: { value: serial } });
  }
  let ms: number;
  if (options?.date1904) ms = EPOCH_1904 + Math.round(serial * DAY_MS);
  else if (serial < 60) ms = EPOCH_1900_EARLY + Math.round(serial * DAY_MS);
  else if (serial < 61) ms = EPOCH_1900 + Math.round((serial + 1) * DAY_MS); // the fictitious 1900-02-29 → 1900-03-01
  else ms = EPOCH_1900 + Math.round(serial * DAY_MS);
  if ((options?.dateZone ?? "local") === "utc") return new Date(ms);
  const u = new Date(ms); // year is always >= 1900 here
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds());
}
