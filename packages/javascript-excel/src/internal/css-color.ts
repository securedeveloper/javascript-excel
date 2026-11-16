/** CSS colour values to RRGGBB, for computed-style mapping in javascript-excel/dom. */

const NAMED: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", lime: "00FF00", green: "008000", blue: "0000FF", yellow: "FFFF00",
  cyan: "00FFFF", aqua: "00FFFF", magenta: "FF00FF", fuchsia: "FF00FF", silver: "C0C0C0", gray: "808080", grey: "808080",
  maroon: "800000", olive: "808000", purple: "800080", teal: "008080", navy: "000080", orange: "FFA500",
};

/** A CSS colour as RRGGBB, or undefined for transparent or unparseable values. */
export function cssColor(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  if (!v || v === "transparent" || v === "currentcolor" || v === "inherit" || v === "initial") return undefined;
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && hex[3] === "0") return undefined;
      return hex.slice(0, 3).split("").map((c) => c + c).join("").toUpperCase();
    }
    if (hex.length === 6) return hex.toUpperCase();
    if (hex.length === 8) return hex.slice(6) === "00" ? undefined : hex.slice(0, 6).toUpperCase();
    return undefined;
  }
  const m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const ch = (s: string): number => Math.round(Math.min(255, Math.max(0, s.endsWith("%") ? (parseFloat(s) * 255) / 100 : parseFloat(s))));
    if (m[4] !== undefined) {
      const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (!(a > 0)) return undefined;
    }
    return [m[1]!, m[2]!, m[3]!].map((s) => ch(s).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return NAMED[v];
}
