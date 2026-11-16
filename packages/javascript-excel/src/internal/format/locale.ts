/**
 * Locale data for number formats, taken from the platform's Intl API so the
 * module ships no locale tables (docs/api.md §5.6). All date work is done on
 * UTC dates built from Excel serials, so nothing depends on the time zone.
 */

export interface LocaleData {
  decimal: string;
  group: string;
  monthsShort: string[];
  monthsLong: string[];
  daysShort: string[]; // Sunday first
  daysLong: string[];
  /** Order and separators of a numeric short date, e.g. ["m", "/", "d", "/", "yyyy"] for en-US. */
  shortDate: string[];
  tag: string;
}

const cache = new Map<string, LocaleData>();

function supported(tag: string): string {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? "en-US";
  } catch {
    return "en-US";
  }
}

export function localeData(requested: string | undefined): LocaleData {
  const tag = supported(requested ?? "en-US");
  let data = cache.get(tag);
  if (!data) {
    data = build(tag);
    if (cache.size > 50) cache.clear();
    cache.set(tag, data);
  }
  return data;
}

function build(tag: string): LocaleData {
  const parts = new Intl.NumberFormat(tag, { useGrouping: true, minimumFractionDigits: 1 }).formatToParts(1234567.5);
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  const names = (opts: Intl.DateTimeFormatOptions, n: number, at: (i: number) => number): string[] => {
    const f = new Intl.DateTimeFormat(tag, { ...opts, timeZone: "UTC" });
    return Array.from({ length: n }, (_, i) => f.format(at(i)));
  };
  const month = (i: number): number => Date.UTC(2021, i, 15);
  const day = (i: number): number => Date.UTC(2021, 0, 3 + i); // 2021-01-03 was a Sunday
  const shortDate: string[] = [];
  for (const p of new Intl.DateTimeFormat(tag, { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }).formatToParts(Date.UTC(2021, 10, 25))) {
    if (p.type === "year") shortDate.push("yyyy");
    else if (p.type === "month") shortDate.push("m");
    else if (p.type === "day") shortDate.push("d");
    else if (p.type === "literal") shortDate.push(`"${p.value.replace(/"/g, "")}"`);
  }
  // Zero padding of day and month follows the locale's short date style (en-US 1/5/21, de-DE 05.01.21);
  // the year is always shown with four digits, as Windows short dates usually are `[to verify per locale]`.
  const short = new Intl.DateTimeFormat(tag, { dateStyle: "short", timeZone: "UTC" }).formatToParts(Date.UTC(2021, 0, 5));
  if (short.find((p) => p.type === "day")?.value === "05") for (let i = 0; i < shortDate.length; i++) if (shortDate[i] === "d") shortDate[i] = "dd";
  if (short.find((p) => p.type === "month")?.value === "01") for (let i = 0; i < shortDate.length; i++) if (shortDate[i] === "m") shortDate[i] = "mm";
  return {
    tag,
    decimal,
    group,
    monthsShort: names({ month: "short" }, 12, month),
    monthsLong: names({ month: "long" }, 12, month),
    daysShort: names({ weekday: "short" }, 7, day),
    daysLong: names({ weekday: "long" }, 7, day),
    shortDate,
  };
}

/**
 * Windows locale ids (LCIDs) seen in [$-xxxx] tags, mapped to BCP 47 tags.
 * Only the common ones; an unknown id falls back to the caller's locale.
 * Source: [MS-LCID] `[to verify for each entry used in real files]`.
 */
const LCIDS: ReadonlyMap<number, string> = new Map([
  [0x0401, "ar-SA"], [0x0404, "zh-TW"], [0x0405, "cs-CZ"], [0x0406, "da-DK"], [0x0407, "de-DE"],
  [0x0408, "el-GR"], [0x0409, "en-US"], [0x040a, "es-ES"], [0x040b, "fi-FI"], [0x040c, "fr-FR"],
  [0x040d, "he-IL"], [0x040e, "hu-HU"], [0x0410, "it-IT"], [0x0411, "ja-JP"], [0x0412, "ko-KR"],
  [0x0413, "nl-NL"], [0x0414, "nb-NO"], [0x0415, "pl-PL"], [0x0416, "pt-BR"], [0x0419, "ru-RU"],
  [0x041d, "sv-SE"], [0x041e, "th-TH"], [0x041f, "tr-TR"], [0x0421, "id-ID"], [0x0422, "uk-UA"],
  [0x042a, "vi-VN"], [0x0439, "hi-IN"], [0x0804, "zh-CN"], [0x0807, "de-CH"], [0x0809, "en-GB"],
  [0x080a, "es-MX"], [0x0816, "pt-PT"], [0x0c07, "de-AT"], [0x0c09, "en-AU"], [0x0c0a, "es-ES"],
  [0x0c0c, "fr-CA"], [0x1009, "en-CA"], [0x100c, "fr-CH"], [0x1409, "en-NZ"], [0x1809, "en-IE"],
  [0x4009, "en-IN"],
]);

export function lcidLocale(id: number): string | undefined {
  return LCIDS.get(id);
}

/** The eight colour names of format codes, as ARGB. */
export const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: "FF000000",
  blue: "FF0000FF",
  cyan: "FF00FFFF",
  green: "FF00FF00",
  magenta: "FFFF00FF",
  red: "FFFF0000",
  white: "FFFFFFFF",
  yellow: "FFFFFF00",
};

/**
 * The default indexed palette, entries 8–63 (ECMA-376 §18.8.27), as RGB.
 * [ColorN] is entry N + 7. `[to verify: conformance.md, 12-colours]`
 */
const PALETTE = (
  "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000 800080 008080 C0C0C0 808080 " +
  "9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF 000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF " +
  "00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 " +
  "003366 339966 003300 333300 993300 993366 333399 333333"
).split(" ");

/** ARGB of [ColorN], from the workbook's palette when given (64 entries, ARGB), else the default. */
export function paletteColor(n: number, indexedColors: readonly string[] | undefined): string {
  const custom = indexedColors?.[n + 7];
  if (custom && /^[0-9a-f]{8}$/i.test(custom)) return custom.toUpperCase();
  return `FF${PALETTE[n - 1] ?? "000000"}`;
}
