/**
 * Turns model styles into styles.xml (docs/api.md §3.5).
 *
 * Every distinct resolved style becomes one `xf` in cellXfs; fonts, fills,
 * borders and custom number formats are deduplicated too. Index 0 of each
 * list is the default, and fills 0/1 are the `none` and `gray125` fills
 * Excel requires.
 */

import { ValidationError } from "../../errors";
import type {
  Alignment,
  Border,
  BorderSide,
  BorderStyle,
  Color,
  Fill,
  Font,
  NumFmt,
  PatternType,
  Style,
} from "../../model";
import { mergeStyles } from "../../styles";
import { num, XML_DECL, xmlAttr } from "../xml";

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Excel's limit on unique cell formats [to verify]. */
export const MAX_CELL_XFS = 64_000;

/** Built-in id for dates without a number format: locale short date. */
export const DEFAULT_DATE_NUMFMT = 14;

const PATTERNS: ReadonlySet<PatternType> = new Set<PatternType>([
  "none", "solid", "mediumGray", "darkGray", "lightGray",
  "darkHorizontal", "darkVertical", "darkDown", "darkUp", "darkGrid", "darkTrellis",
  "lightHorizontal", "lightVertical", "lightDown", "lightUp", "lightGrid", "lightTrellis",
  "gray125", "gray0625",
]);
const BORDER_STYLES: ReadonlySet<BorderStyle> = new Set<BorderStyle>([
  "none", "thin", "medium", "thick", "double", "hair", "dotted", "dashed",
  "dashDot", "dashDotDot", "mediumDashed", "mediumDashDot", "mediumDashDotDot", "slantDashDot",
]);
const UNDERLINES = new Set(["single", "double", "singleAccounting", "doubleAccounting"]);
const VERT_ALIGNS = new Set(["superscript", "subscript", "baseline"]);
const SCHEMES = new Set(["major", "minor", "none"]);
const HORIZONTAL = new Set(["general", "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"]);
const VERTICAL = new Set(["top", "center", "bottom", "justify", "distributed"]);
const READING_ORDER: Readonly<Record<string, number>> = { context: 0, ltr: 1, rtl: 2 };

/** Where a style is used, for error details. */
export interface StyleContext {
  sheet?: string | undefined;
  ref?: string | undefined;
}

// ------------------------------------------------------------- normalised

type NColor = { rgb: string } | { theme: number; tint?: number } | { indexed: number } | { auto: true };

interface NFont {
  name: string;
  size: number;
  color?: NColor;
  bold?: true;
  italic?: true;
  underline?: "single" | "double" | "singleAccounting" | "doubleAccounting";
  strike?: true;
  vertAlign?: "superscript" | "subscript" | "baseline";
  family?: number;
  charset?: number;
  scheme?: "major" | "minor" | "none";
  outline?: true;
  shadow?: true;
  condense?: true;
  extend?: true;
}

type NFill =
  | { kind: "pattern"; pattern: PatternType; fg?: NColor; bg?: NColor }
  | {
      kind: "gradient";
      gradient: "linear" | "path";
      degree?: number;
      left?: number;
      right?: number;
      top?: number;
      bottom?: number;
      stops: Array<{ position: number; color: NColor }>;
    };

interface NSide {
  style: Exclude<BorderStyle, "none">;
  color?: NColor;
}
interface NBorder {
  left?: NSide;
  right?: NSide;
  top?: NSide;
  bottom?: NSide;
  diagonal?: NSide;
  diagonalUp?: true;
  diagonalDown?: true;
}

// ------------------------------------------------------------- validation

class Checker {
  constructor(private readonly ctx: StyleContext) {}

  fail(path: string, value: unknown, why: string, code: "INVALID_STYLE" | "INVALID_NUMFMT" = "INVALID_STYLE"): never {
    const where = this.ctx.ref ? ` (${this.ctx.sheet ?? "?"}!${this.ctx.ref})` : this.ctx.sheet ? ` (${this.ctx.sheet})` : "";
    throw new ValidationError(code, `Invalid style ${path}: ${why}${where}.`, {
      details: { path, value, ...(this.ctx.sheet !== undefined && { sheet: this.ctx.sheet }), ...(this.ctx.ref !== undefined && { ref: this.ctx.ref }) },
    });
  }

  bool(path: string, v: unknown): boolean | undefined {
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") this.fail(path, v, "expected a boolean");
    return v;
  }

  number(path: string, v: unknown, min: number, max: number, integer = false): number | undefined {
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      this.fail(path, v, `expected ${integer ? "an integer" : "a number"} from ${min} to ${max}`);
    }
    return v;
  }

  oneOf<T extends string>(path: string, v: unknown, allowed: ReadonlySet<string>): T | undefined {
    if (v === undefined) return undefined;
    if (typeof v !== "string" || !allowed.has(v)) this.fail(path, v, `expected one of ${[...allowed].join(", ")}`);
    return v as T;
  }

  color(path: string, c: Color | undefined): NColor | undefined {
    if (c === undefined) return undefined;
    if (typeof c === "string") return { rgb: this.argb(path, c) };
    if (typeof c !== "object" || c === null) this.fail(path, c, "expected a colour");
    if ("rgb" in c) return { rgb: this.argb(`${path}.rgb`, c.rgb) };
    if ("theme" in c) {
      const theme = this.number(`${path}.theme`, c.theme, 0, 11, true)!;
      const tint = this.number(`${path}.tint`, c.tint, -1, 1);
      return tint === undefined || tint === 0 ? { theme } : { theme, tint };
    }
    if ("indexed" in c) return { indexed: this.number(`${path}.indexed`, c.indexed, 0, 65, true)! };
    if ("auto" in c && c.auto === true) return { auto: true };
    return this.fail(path, c, "expected a string, { rgb }, { theme, tint }, { indexed } or { auto: true }");
  }

  argb(path: string, s: unknown): string {
    if (typeof s !== "string") this.fail(path, s, "expected a hex colour string");
    const hex = s.startsWith("#") ? s.slice(1) : s;
    if (!/^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) this.fail(path, s, "expected RRGGBB or AARRGGBB hex");
    return (hex.length === 6 ? `FF${hex}` : hex).toUpperCase();
  }
}

// ---------------------------------------------------------------- serialise

function colorAttrs(c: NColor): string {
  if ("rgb" in c) return ` rgb="${c.rgb}"`;
  if ("theme" in c) return ` theme="${c.theme}"${c.tint !== undefined ? ` tint="${num(c.tint)}"` : ""}`;
  if ("indexed" in c) return ` indexed="${c.indexed}"`;
  return ` auto="1"`;
}

/** Font body, shared by <font> (nameTag 'name') and rich-text <rPr> (nameTag 'rFont'). */
export function fontXml(f: NFont, nameTag: "name" | "rFont"): string {
  let x = "";
  if (f.bold) x += "<b/>";
  if (f.italic) x += "<i/>";
  if (f.strike) x += "<strike/>";
  if (f.condense) x += "<condense/>";
  if (f.extend) x += "<extend/>";
  if (f.outline) x += "<outline/>";
  if (f.shadow) x += "<shadow/>";
  if (f.underline) x += f.underline === "single" ? "<u/>" : `<u val="${f.underline}"/>`;
  if (f.vertAlign) x += `<vertAlign val="${f.vertAlign}"/>`;
  x += `<sz val="${num(f.size)}"/>`;
  if (f.color) x += `<color${colorAttrs(f.color)}/>`;
  x += `<${nameTag} val="${xmlAttr(f.name)}"/>`;
  if (f.family !== undefined) x += `<family val="${f.family}"/>`;
  if (f.charset !== undefined) x += `<charset val="${f.charset}"/>`;
  if (f.scheme) x += `<scheme val="${f.scheme}"/>`;
  return x;
}

function fillXml(f: NFill): string {
  if (f.kind === "pattern") {
    if (!f.fg && !f.bg) return `<fill><patternFill patternType="${f.pattern}"/></fill>`;
    let x = `<fill><patternFill patternType="${f.pattern}">`;
    if (f.fg) x += `<fgColor${colorAttrs(f.fg)}/>`;
    if (f.bg) x += `<bgColor${colorAttrs(f.bg)}/>`;
    return `${x}</patternFill></fill>`;
  }
  let attrs = f.gradient === "path" ? ' type="path"' : "";
  if (f.degree !== undefined) attrs += ` degree="${num(f.degree)}"`;
  for (const k of ["left", "right", "top", "bottom"] as const) {
    if (f[k] !== undefined) attrs += ` ${k}="${num(f[k])}"`;
  }
  const stops = f.stops.map((s) => `<stop position="${num(s.position)}"><color${colorAttrs(s.color)}/></stop>`).join("");
  return `<fill><gradientFill${attrs}>${stops}</gradientFill></fill>`;
}

function borderXml(b: NBorder): string {
  let attrs = "";
  if (b.diagonalUp) attrs += ' diagonalUp="1"';
  if (b.diagonalDown) attrs += ' diagonalDown="1"';
  let x = `<border${attrs}>`;
  for (const side of ["left", "right", "top", "bottom", "diagonal"] as const) {
    const s = b[side];
    if (!s) x += `<${side}/>`;
    else if (!s.color) x += `<${side} style="${s.style}"/>`;
    else x += `<${side} style="${s.style}"><color${colorAttrs(s.color)}/></${side}>`;
  }
  return `${x}</border>`;
}

/** Stable key for deduplication (normalised objects are built with a fixed field order). */
const keyOf = (v: unknown): string => JSON.stringify(v);

// ----------------------------------------------------------------- registry

const DEFAULT_FONT: NFont = { name: "Calibri", size: 11, color: { theme: 1 }, family: 2, scheme: "minor" };

interface Xf {
  numFmtId: number;
  fontId: number;
  fillId: number;
  borderId: number;
  alignment: string; // attributes, '' when default
  protection: string; // attributes, '' when default
}

export class StyleRegistry {
  private readonly defaultFont: NFont;
  private readonly fonts: string[] = [];
  private readonly fontIndex = new Map<string, number>();
  private readonly fills: string[] = [];
  private readonly fillIndex = new Map<string, number>();
  private readonly borders: string[] = [];
  private readonly borderIndex = new Map<string, number>();
  private readonly numFmts = new Map<string, number>();
  private readonly xfs: Xf[] = [];
  private readonly xfIndex = new Map<string, number>();
  /** Resolved-xf cache keyed by the identity of the style layers. */
  private readonly layerCache = new Map<string, number>();
  private readonly ids = new WeakMap<object, number>();
  private nextId = 1;

  constructor(defaultFont?: Font) {
    const c = new Checker({});
    this.defaultFont = defaultFont ? this.normFont(c, "defaultFont", defaultFont, DEFAULT_FONT) : DEFAULT_FONT;
    this.addFont(this.defaultFont);
    this.addFill({ kind: "pattern", pattern: "none" });
    this.addFill({ kind: "pattern", pattern: "gray125" });
    this.addBorder({});
    this.addXf({ numFmtId: 0, fontId: 0, fillId: 0, borderId: 0, alignment: "", protection: "" });
  }

  /** The workbook default font, normalised. */
  get baseFont(): NFont {
    return this.defaultFont;
  }

  private id(o: object | undefined): number {
    if (!o) return 0;
    let n = this.ids.get(o);
    if (n === undefined) {
      n = this.nextId++;
      this.ids.set(o, n);
    }
    return n;
  }

  /**
   * The cellXfs index for a cell, given its style layers (§3.5.7):
   * sheet default → column → row → cell. `isDate` adds the default date format
   * when no layer sets a number format.
   */
  xfFor(layers: ReadonlyArray<Style | undefined>, isDate: boolean, ctx: StyleContext): number {
    let key = isDate ? "d" : "";
    let any = isDate;
    for (const l of layers) {
      key += `:${this.id(l)}`;
      if (l) any = true;
    }
    if (!any) return 0;
    const cached = this.layerCache.get(key);
    if (cached !== undefined) return cached;
    const merged = layers.length === 1 && layers[0] ? layers[0] : mergeStyles(...layers);
    const index = this.resolve(merged, isDate, ctx);
    this.layerCache.set(key, index);
    return index;
  }

  /** Normalises a run font for rich text (merged over `base`), or undefined. */
  runFont(font: Font | undefined, base: NFont, ctx: StyleContext): NFont | undefined {
    if (!font) return undefined;
    return this.normFont(new Checker(ctx), "richText.font", font, base);
  }

  /** The resolved font of a style (its font merged over the default font). */
  fontOf(style: Style | undefined, ctx: StyleContext): NFont {
    if (!style?.font) return this.defaultFont;
    return this.normFont(new Checker(ctx), "font", style.font, this.defaultFont);
  }

  /** Validates a colour and returns its CT_Color attributes (e.g. ` rgb="FFFF0000"`). */
  colorAttrs(path: string, color: Color, ctx: StyleContext): string {
    const n = new Checker(ctx).color(path, color);
    return n ? colorAttrs(n) : "";
  }

  get cellXfCount(): number {
    return this.xfs.length;
  }

  private resolve(style: Style, isDate: boolean, ctx: StyleContext): number {
    const c = new Checker(ctx);
    if (typeof style !== "object" || style === null) c.fail("style", style, "expected an object");
    let numFmtId = this.numFmtId(c, style.numFmt);
    if (isDate && style.numFmt === undefined) numFmtId = DEFAULT_DATE_NUMFMT;
    const fontId = style.font ? this.addFont(this.normFont(c, "font", style.font, this.defaultFont)) : 0;
    const fill = style.fill === undefined ? undefined : this.normFill(c, style.fill);
    const fillId = fill ? this.addFill(fill) : 0;
    const borderId = style.border ? this.addBorder(this.normBorder(c, style.border)) : 0;
    const alignment = style.alignment ? this.alignmentAttrs(c, style.alignment) : "";
    const protection = style.protection ? this.protectionAttrs(c, style.protection) : "";
    return this.addXf({ numFmtId, fontId, fillId, borderId, alignment, protection });
  }

  // ---- normalisation

  private normFont(c: Checker, path: string, f: Font, base: NFont): NFont {
    if (typeof f !== "object" || f === null) c.fail(path, f, "expected an object");
    const out: NFont = { ...base };
    if (f.name !== undefined) {
      if (typeof f.name !== "string" || f.name.length === 0 || f.name.length > 31) {
        c.fail(`${path}.name`, f.name, "expected a font name of 1 to 31 characters");
      }
      if (f.name !== base.name) {
        // A different typeface no longer matches the base font's theme scheme or family.
        delete out.scheme;
        delete out.family;
      }
      out.name = f.name;
    }
    const size = c.number(`${path}.size`, f.size, 1, 409);
    if (size !== undefined) out.size = size;
    const color = c.color(`${path}.color`, f.color);
    if (color) out.color = color;
    const flags = ["bold", "italic", "strike", "outline", "shadow", "condense", "extend"] as const;
    for (const k of flags) {
      const v = c.bool(`${path}.${k}`, f[k]);
      if (v === true) out[k] = true;
      else if (v === false) delete out[k];
    }
    if (f.underline !== undefined) {
      if (f.underline === true) out.underline = "single";
      else if (f.underline === false) delete out.underline;
      else out.underline = c.oneOf(`${path}.underline`, f.underline, UNDERLINES)!;
    }
    const va = c.oneOf<NonNullable<NFont["vertAlign"]>>(`${path}.vertAlign`, f.vertAlign, VERT_ALIGNS);
    if (va) out.vertAlign = va;
    const family = c.number(`${path}.family`, f.family, 0, 14, true);
    if (family !== undefined) out.family = family;
    const charset = c.number(`${path}.charset`, f.charset, 0, 255, true);
    if (charset !== undefined) out.charset = charset;
    const scheme = c.oneOf<NonNullable<NFont["scheme"]>>(`${path}.scheme`, f.scheme, SCHEMES);
    if (scheme) out.scheme = scheme;
    // Fixed key order, so equal fonts serialise to equal keys.
    const ordered: NFont = { name: out.name, size: out.size };
    for (const k of ["color", "bold", "italic", "underline", "strike", "vertAlign", "family", "charset", "scheme", "outline", "shadow", "condense", "extend"] as const) {
      if (out[k] !== undefined) (ordered as unknown as Record<string, unknown>)[k] = out[k];
    }
    return ordered;
  }

  private normFill(c: Checker, f: Fill): NFill | undefined {
    if (typeof f === "string") return { kind: "pattern", pattern: "solid", fg: { rgb: c.argb("fill", f) }, bg: { indexed: 64 } };
    if (typeof f !== "object" || f === null) return c.fail("fill", f, "expected a colour string or a fill object");
    if (f.type === "gradient") {
      const gradient = c.oneOf<"linear" | "path">("fill.gradient", f.gradient, new Set(["linear", "path"]));
      if (!gradient) c.fail("fill.gradient", f.gradient, "required for a gradient fill");
      if (!Array.isArray(f.stops) || f.stops.length < 2) c.fail("fill.stops", f.stops, "a gradient needs at least two stops");
      const out: NFill = {
        kind: "gradient",
        gradient,
        stops: f.stops.map((s, i) => ({
          position: c.number(`fill.stops[${i}].position`, s.position, 0, 1) ?? c.fail(`fill.stops[${i}].position`, s.position, "required"),
          color: c.color(`fill.stops[${i}].color`, s.color) ?? c.fail(`fill.stops[${i}].color`, s.color, "required"),
        })),
      };
      const degree = c.number("fill.degree", f.degree, -360, 360);
      if (degree !== undefined) out.degree = degree;
      for (const k of ["left", "right", "top", "bottom"] as const) {
        const v = c.number(`fill.${k}`, f[k], 0, 1);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (f.type !== undefined && f.type !== "pattern") c.fail("fill.type", f.type, "expected 'pattern' or 'gradient'");
    const pattern = c.oneOf<PatternType>("fill.pattern", f.pattern, PATTERNS);
    if (!pattern) return c.fail("fill.pattern", f.pattern, "required for a pattern fill");
    if (pattern === "none") return undefined;
    const out: NFill = { kind: "pattern", pattern };
    const fg = c.color("fill.fgColor", f.fgColor);
    const bg = c.color("fill.bgColor", f.bgColor);
    if (fg) out.fg = fg;
    if (bg) out.bg = bg;
    else if (pattern === "solid") out.bg = { indexed: 64 }; // what Excel writes for a solid fill
    return out;
  }

  private normSide(c: Checker, path: string, s: BorderSide | undefined): NSide | undefined {
    if (s === undefined) return undefined;
    if (typeof s !== "object" || s === null) c.fail(path, s, "expected { style, color? }");
    const style = c.oneOf<BorderStyle>(`${path}.style`, s.style, BORDER_STYLES);
    if (!style) return c.fail(`${path}.style`, s.style, "required");
    if (style === "none") return undefined;
    const color = c.color(`${path}.color`, s.color);
    return color ? { style, color } : { style };
  }

  private normBorder(c: Checker, b: Border): NBorder {
    if (typeof b !== "object" || b === null) c.fail("border", b, "expected an object");
    const out: NBorder = {};
    for (const side of ["left", "right", "top", "bottom", "diagonal"] as const) {
      const s = this.normSide(c, `border.${side}`, b[side]);
      if (s) out[side] = s;
    }
    if (c.bool("border.diagonalUp", b.diagonalUp)) out.diagonalUp = true;
    if (c.bool("border.diagonalDown", b.diagonalDown)) out.diagonalDown = true;
    return out;
  }

  private alignmentAttrs(c: Checker, a: Alignment): string {
    if (typeof a !== "object" || a === null) c.fail("alignment", a, "expected an object");
    let x = "";
    const h = c.oneOf("alignment.horizontal", a.horizontal, HORIZONTAL);
    if (h) x += ` horizontal="${h}"`;
    const v = c.oneOf("alignment.vertical", a.vertical, VERTICAL);
    if (v) x += ` vertical="${v}"`;
    if (a.rotation !== undefined) {
      let r: number;
      if (a.rotation === "vertical") r = 255;
      else {
        const deg = c.number("alignment.rotation", a.rotation, -90, 90, true)!;
        r = deg >= 0 ? deg : 90 - deg;
      }
      if (r !== 0) x += ` textRotation="${r}"`;
    }
    if (c.bool("alignment.wrapText", a.wrapText)) x += ' wrapText="1"';
    const indent = c.number("alignment.indent", a.indent, 0, 250, true);
    if (indent) x += ` indent="${indent}"`;
    if (c.bool("alignment.justifyLastLine", a.justifyLastLine)) x += ' justifyLastLine="1"';
    if (c.bool("alignment.shrinkToFit", a.shrinkToFit)) x += ' shrinkToFit="1"';
    if (a.readingOrder !== undefined) {
      const ro = READING_ORDER[c.oneOf("alignment.readingOrder", a.readingOrder, new Set(Object.keys(READING_ORDER)))!]!;
      if (ro !== 0) x += ` readingOrder="${ro}"`;
    }
    return x;
  }

  private protectionAttrs(c: Checker, p: { locked?: boolean | undefined; hidden?: boolean | undefined }): string {
    if (typeof p !== "object" || p === null) c.fail("protection", p, "expected an object");
    let x = "";
    if (c.bool("protection.locked", p.locked) === false) x += ' locked="0"';
    if (c.bool("protection.hidden", p.hidden) === true) x += ' hidden="1"';
    return x;
  }

  private numFmtId(c: Checker, f: NumFmt | undefined): number {
    if (f === undefined) return 0;
    if (typeof f === "number") {
      if (!Number.isInteger(f) || f < 0 || f > 163) c.fail("numFmt", f, "a built-in format id is an integer from 0 to 163", "INVALID_NUMFMT");
      return f;
    }
    if (typeof f !== "string" || f.length === 0) return c.fail("numFmt", f, "expected a built-in id or a non-empty format code", "INVALID_NUMFMT");
    if (f.toLowerCase() === "general") return 0;
    let id = this.numFmts.get(f);
    if (id === undefined) {
      id = 164 + this.numFmts.size;
      this.numFmts.set(f, id);
    }
    return id;
  }

  // ---- dedup lists

  private addFont(f: NFont): number {
    const k = keyOf(f);
    let i = this.fontIndex.get(k);
    if (i === undefined) {
      i = this.fonts.length;
      this.fonts.push(`<font>${fontXml(f, "name")}</font>`);
      this.fontIndex.set(k, i);
    }
    return i;
  }

  private addFill(f: NFill): number {
    const k = keyOf(f);
    let i = this.fillIndex.get(k);
    if (i === undefined) {
      i = this.fills.length;
      this.fills.push(fillXml(f));
      this.fillIndex.set(k, i);
    }
    return i;
  }

  private addBorder(b: NBorder): number {
    const k = keyOf(b);
    let i = this.borderIndex.get(k);
    if (i === undefined) {
      i = this.borders.length;
      this.borders.push(borderXml(b));
      this.borderIndex.set(k, i);
    }
    return i;
  }

  private addXf(xf: Xf): number {
    const k = `${xf.numFmtId},${xf.fontId},${xf.fillId},${xf.borderId},${xf.alignment},${xf.protection}`;
    let i = this.xfIndex.get(k);
    if (i === undefined) {
      if (this.xfs.length >= MAX_CELL_XFS) {
        throw new ValidationError("TOO_MANY_STYLES", `More than ${MAX_CELL_XFS} distinct cell styles.`, {
          details: { max: MAX_CELL_XFS },
        });
      }
      i = this.xfs.length;
      this.xfs.push(xf);
      this.xfIndex.set(k, i);
    }
    return i;
  }

  // ---- output

  toXml(): string {
    const parts: string[] = [XML_DECL, `<styleSheet xmlns="${NS_MAIN}">`];
    if (this.numFmts.size > 0) {
      parts.push(`<numFmts count="${this.numFmts.size}">`);
      for (const [code, id] of this.numFmts) parts.push(`<numFmt numFmtId="${id}" formatCode="${xmlAttr(code)}"/>`);
      parts.push("</numFmts>");
    }
    parts.push(`<fonts count="${this.fonts.length}">`, ...this.fonts, "</fonts>");
    parts.push(`<fills count="${this.fills.length}">`, ...this.fills, "</fills>");
    parts.push(`<borders count="${this.borders.length}">`, ...this.borders, "</borders>");
    parts.push('<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>');
    parts.push(`<cellXfs count="${this.xfs.length}">`);
    for (const xf of this.xfs) {
      let attrs = `numFmtId="${xf.numFmtId}" fontId="${xf.fontId}" fillId="${xf.fillId}" borderId="${xf.borderId}" xfId="0"`;
      if (xf.numFmtId !== 0) attrs += ' applyNumberFormat="1"';
      if (xf.fontId !== 0) attrs += ' applyFont="1"';
      if (xf.fillId !== 0) attrs += ' applyFill="1"';
      if (xf.borderId !== 0) attrs += ' applyBorder="1"';
      if (xf.alignment) attrs += ' applyAlignment="1"';
      if (xf.protection) attrs += ' applyProtection="1"';
      const children =
        (xf.alignment ? `<alignment${xf.alignment}/>` : "") + (xf.protection ? `<protection${xf.protection}/>` : "");
      parts.push(children ? `<xf ${attrs}>${children}</xf>` : `<xf ${attrs}/>`);
    }
    parts.push("</cellXfs>");
    parts.push('<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>');
    parts.push('<dxfs count="0"/><tableStyles count="0"/>');
    parts.push("</styleSheet>");
    return parts.join("");
  }
}

export type { NFont };
