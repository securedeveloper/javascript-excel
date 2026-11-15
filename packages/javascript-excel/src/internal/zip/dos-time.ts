/**
 * MS-DOS date/time fields used in zip headers (2-second resolution, years
 * 1980–2107, no time zone).
 *
 * The writer uses the UTC fields of the Date, so the same `modified` date gives
 * the same bytes on every machine (deterministic output, docs/api.md §5.1).
 * The reader returns the stored fields as a UTC Date for the same reason.
 */

export interface DosDateTime {
  date: number;
  time: number;
}

const MIN_MS = Date.UTC(1980, 0, 1);
const MAX_MS = Date.UTC(2107, 11, 31, 23, 59, 58);

export function toDosDateTime(d: Date): DosDateTime {
  let ms = d.getTime();
  if (!Number.isFinite(ms) || ms < MIN_MS) ms = MIN_MS;
  else if (ms > MAX_MS) ms = MAX_MS;
  const u = new Date(ms);
  return {
    date: ((u.getUTCFullYear() - 1980) << 9) | ((u.getUTCMonth() + 1) << 5) | u.getUTCDate(),
    time: (u.getUTCHours() << 11) | (u.getUTCMinutes() << 5) | (u.getUTCSeconds() >> 1),
  };
}

export function fromDosDateTime(date: number, time: number): Date {
  const year = 1980 + (date >>> 9);
  const month = Math.max(1, (date >>> 5) & 0x0f) - 1;
  const day = Math.max(1, date & 0x1f);
  return new Date(Date.UTC(year, month, day, time >>> 11, (time >>> 5) & 0x3f, (time & 0x1f) * 2));
}
