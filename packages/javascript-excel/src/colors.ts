/**
 * Colour resolution (docs/api.md §3.5.6, §4.4): any model `Color` to a
 * concrete ARGB string, using the workbook's theme and indexed palette, or
 * the defaults (the Office theme the writer embeds, the standard palette).
 */

import type { Color, Theme } from "./model";

/** The Office theme's colours in clrScheme order (dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink), as the writer embeds it. */
const DEFAULT_THEME = ["000000", "FFFFFF", "44546A", "E7E6E6", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];

/** The default indexed palette, entries 0–63 (ECMA-376 §18.8.27); 64 is the system foreground, 65 the system background. */
const PALETTE = (
  "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF " +
  "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000 800080 008080 C0C0C0 808080 " +
  "9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF 000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF " +
  "00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 " +
  "003366 339966 003300 333300 993300 993366 333399 333333"
).split(" ");

/** Theme colour index (as cells use it) to clrScheme position: the first two pairs are swapped (§3.5.6). */
const THEME_ORDER = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11];

/** Context for `resolveColor`: the workbook's `theme` and `indexedColors`. */
export interface ColorContext {
  theme?: Theme | undefined;
  indexedColors?: readonly string[] | undefined;
}

function argb(s: string | undefined): string | undefined {
  if (typeof s !== "string") return undefined;
  const hex = s.startsWith("#") ? s.slice(1) : s;
  if (/^[0-9a-f]{6}$/i.test(hex)) return `FF${hex.toUpperCase()}`;
  if (/^[0-9a-f]{8}$/i.test(hex)) return hex.toUpperCase();
  return undefined;
}

/**
 * Resolves any `Color` to ARGB ('FFRRGGBB'). Theme colours use the file's
 * theme and apply the tint (ECMA-376 §18.8.19, on HSL luminance); indexed
 * colours use the file's palette. Without them, the defaults are used.
 * Automatic colour and anything unreadable give black.
 */
export function resolveColor(color: Color, ctx?: ColorContext): string {
  if (typeof color === "string") return argb(color) ?? "FF000000";
  if ("rgb" in color) return argb(color.rgb) ?? "FF000000";
  if ("indexed" in color) {
    const i = color.indexed;
    if (i === 64) return "FF000000";
    if (i === 65) return "FFFFFFFF";
    return argb(ctx?.indexedColors?.[i]) ?? (PALETTE[i] ? `FF${PALETTE[i]}` : "FF000000");
  }
  if ("theme" in color) {
    const pos = THEME_ORDER[color.theme];
    if (pos === undefined) return "FF000000";
    const base = argb(ctx?.theme?.colors[pos]) ?? `FF${DEFAULT_THEME[pos]}`;
    return color.tint ? tinted(base, color.tint) : base;
  }
  return "FF000000";
}

/** Applies a tint to the HSL luminance: darker for negative tints, lighter for positive ones. */
function tinted(base: string, tint: number): string {
  const r = Number.parseInt(base.slice(2, 4), 16) / 255;
  const g = Number.parseInt(base.slice(4, 6), 16) / 255;
  const b = Number.parseInt(base.slice(6, 8), 16) / 255;
  const [h, l, s] = rgbToHls(r, g, b);
  const t = Math.max(-1, Math.min(1, tint));
  const l2 = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const [r2, g2, b2] = hlsToRgb(h, l2, s);
  const hex = (x: number): string => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0").toUpperCase();
  return `${base.slice(0, 2)}${hex(r2)}${hex(g2)}${hex(b2)}`;
}

function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, l, 0];
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  let h: number;
  if (max === r) h = (g - b) / d;
  else if (max === g) h = 2 + (b - r) / d;
  else h = 4 + (r - g) / d;
  h = (((h / 6) % 1) + 1) % 1;
  return [h, l, s];
}

function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  const v = (hue: number): number => {
    const x = ((hue % 1) + 1) % 1;
    if (x < 1 / 6) return m1 + (m2 - m1) * x * 6;
    if (x < 0.5) return m2;
    if (x < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - x) * 6;
    return m1;
  };
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}
