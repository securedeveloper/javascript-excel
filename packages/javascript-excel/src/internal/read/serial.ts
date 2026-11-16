/**
 * Excel serial -> Date (docs/api.md §3.4.1). Internal and temporary: it is
 * replaced by the public `serialToDate` from src/dates.ts once JSE-3 lands.
 *
 * 1900 system: serials from 61 on use the epoch 1899-12-30; serials below 60
 * use 1899-12-31 (Excel's fictitious 1900-02-29 is serial 60, which is not a
 * date). 1904 system: serial 0 = 1904-01-01. Fractions are times of day,
 * rounded to the millisecond. Returns undefined for serials that are not dates.
 */

const MS_PER_DAY = 86_400_000;
/** 9999-12-31 in the 1900 system. */
const MAX_SERIAL_1900 = 2_958_465;
/** 9999-12-31 in the 1904 system. */
const MAX_SERIAL_1904 = MAX_SERIAL_1900 - 1462;

export function serialToDate(serial: number, opts: { date1904: boolean; dateZone: "local" | "utc" }): Date | undefined {
  if (!Number.isFinite(serial) || serial < 0) return undefined;
  let y: number;
  let m: number;
  let d: number;
  let days = Math.floor(serial);
  let ms = Math.round((serial - days) * MS_PER_DAY);
  if (ms >= MS_PER_DAY) {
    days += 1;
    ms -= MS_PER_DAY;
  }
  if (opts.date1904) {
    if (days > MAX_SERIAL_1904) return undefined;
    [y, m, d] = [1904, 0, 1 + days];
  } else {
    if (days > MAX_SERIAL_1900 || days === 60) return undefined;
    [y, m, d] = days > 60 ? [1899, 11, 30 + days] : [1899, 11, 31 + days];
  }
  // Pass the time of day as components, so local dates on DST days keep their wall-clock time.
  const h = Math.floor(ms / 3_600_000);
  const mi = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  return opts.dateZone === "utc" ? new Date(Date.UTC(y, m, d, h, mi, s, rest)) : new Date(y, m, d, h, mi, s, rest);
}
