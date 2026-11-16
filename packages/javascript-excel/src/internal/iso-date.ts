/** ISO 8601 date text, shared by the CSV writer and `cellText`. */

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
