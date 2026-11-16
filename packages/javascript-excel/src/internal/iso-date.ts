/** ISO 8601 date text and parsing, shared by the CSV writer, `cellText`, `fromTable` and `fromDataset`. */

/** YYYY-MM-DD, or YYYY-MM-DDTHH:mm:ss(.sss) when there is a time of day, in `zone`. */
export function isoDate(d: Date, zone: "local" | "utc"): string {
  const utc = zone === "utc";
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const mo = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const day = utc ? d.getUTCDate() : d.getDate();
  const h = utc ? d.getUTCHours() : d.getHours();
  const mi = utc ? d.getUTCMinutes() : d.getMinutes();
  const s = utc ? d.getUTCSeconds() : d.getSeconds();
  const ms = utc ? d.getUTCMilliseconds() : d.getMilliseconds();
  const year = y >= 0 && y <= 9999 ? pad(y, 4) : (y < 0 ? "-" : "+") + pad(Math.abs(y), 6);
  const date = `${year}-${pad(mo, 2)}-${pad(day, 2)}`;
  if (h === 0 && mi === 0 && s === 0 && ms === 0) return date;
  const time = `${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}`;
  return ms === 0 ? `${date}T${time}` : `${date}T${time}.${pad(ms, 3)}`;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** ISO 8601 date or date-time. Without a zone, the local wall-clock time (dateZone 'local'). */
export function parseIsoDate(s: string): Date | undefined {
  const m = ISO_DATE.exec(s.trim());
  if (!m) return undefined;
  const [y, mo, d, h = "0", mi = "0", sec = "0", ms = "0", zone] = m.slice(1);
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec), Number(ms.padEnd(3, "0"))] as const;
  let date: Date;
  if (zone) {
    const off = zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    date = new Date(Date.UTC(...parts) - off * 60_000);
  } else {
    date = new Date(...parts);
  }
  // Reject overflow such as 2024-02-30 (checked on the wall-clock fields).
  const wall = zone ? new Date(Date.UTC(...parts)) : date;
  const [month, day] = zone ? [wall.getUTCMonth(), wall.getUTCDate()] : [wall.getMonth(), wall.getDate()];
  if (month !== parts[1] || day !== parts[2]) return undefined;
  return Number.isFinite(date.getTime()) ? date : undefined;
}
