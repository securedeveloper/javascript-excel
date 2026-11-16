/**
 * styles.xml -> model styles (docs/api.md §3.5, §3.5.7). Internal.
 *
 * Every `cellXfs` entry becomes one deeply frozen `Style`, shared by all cells
 * that use it (§12 Q8). Index 0, the default, has no style. With
 * `styles: false` only the number formats are kept, for date detection.
 */

import type { Alignment, Border, BorderSide, BorderStyle, Color, Fill, Font, GradientFill, NumFmt, PatternFill, PatternType, Style } from "../../model";
import type { XmlAttrs } from "./xml-reader";

export interface StyleTable {
  /** Style per xf index (undefined for xf 0 and for empty xfs). */
  style(xf: number): Style | undefined;
  /** Number format per xf index. */
  numFmt(xf: number): NumFmt | undefined;
  /** Number of cellXfs entries. */
  readonly size: number;
  /** Custom indexed palette, if the file has one. */
  readonly indexedColors: string[] | undefined;
}

export const EMPTY_STYLES: StyleTable = {
  style: () => undefined,
  numFmt: () => undefined,
  size: 0,
  indexedColors: undefined,
};

interface RawXf {
  numFmtId: number;
  fontId: number;
  fillId: number;
  borderId: number;
  alignment?: Alignment;
  protection?: { locked?: boolean; hidden?: boolean };
}

const BORDER_STYLES = new Set<string>([
  "none", "thin", "medium", "thick", "double", "hair", "dotted", "dashed", "dashDot", "dashDotDot", "mediumDashed", "mediumDashDot", "mediumDashDotDot", "slantDashDot",
]);
const PATTERNS = new Set<string>([
  "none", "solid", "mediumGray", "darkGray", "lightGray", "darkHorizontal", "darkVertical", "darkDown", "darkUp", "darkGrid", "darkTrellis",
  "lightHorizontal", "lightVertical", "lightDown", "lightUp", "lightGrid", "lightTrellis", "gray125", "gray0625",
]);
const H_ALIGN = new Set(["general", "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"]);
const V_ALIGN = new Set(["top", "center", "bottom", "justify", "distributed"]);
const UNDERLINE = new Set(["single", "double", "singleAccounting", "doubleAccounting"]);

export function bool(v: string | undefined, dflt = true): boolean {
  if (v === undefined) return dflt;
  return v === "1" || v === "true" || v === "on";
}

export function num(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function int(v: string | undefined): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.trunc(n);
}

/** CT_Color -> model colour (object forms only, §3.5.6). */
export function color(a: XmlAttrs): Color | undefined {
  const rgb = a.get("rgb");
  if (rgb !== undefined && /^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(rgb)) return { rgb: (rgb.length === 6 ? `FF${rgb}` : rgb).toUpperCase() };
  const theme = int(a.get("theme"));
  if (theme !== undefined && theme >= 0) {
    const tint = num(a.get("tint"));
    return tint === undefined || tint === 0 ? { theme } : { theme, tint };
  }
  const indexed = int(a.get("indexed"));
  if (indexed !== undefined && indexed >= 0) return { indexed };
  if (bool(a.get("auto"), false)) return { auto: true };
  return undefined;
}

/** Parser for font properties: <font> in styles.xml and <rPr> in rich text. */
export class FontBuilder {
  font: Font = {};
  /** Handles one child element of <font>/<rPr>. */
  child(name: string, a: XmlAttrs): void {
    const f = this.font;
    const val = a.get("val");
    switch (name) {
      case "name":
      case "rFont":
        if (val !== undefined) f.name = val;
        break;
      case "sz": {
        const n = num(val);
        if (n !== undefined) f.size = n;
        break;
      }
      case "color": {
        const c = color(a);
        if (c) f.color = c;
        break;
      }
      case "b":
        f.bold = bool(val);
        break;
      case "i":
        f.italic = bool(val);
        break;
      case "strike":
        f.strike = bool(val);
        break;
      case "outline":
        f.outline = bool(val);
        break;
      case "shadow":
        f.shadow = bool(val);
        break;
      case "condense":
        f.condense = bool(val);
        break;
      case "extend":
        f.extend = bool(val);
        break;
      case "u":
        if (val === undefined || val === "single") f.underline = true;
        else if (UNDERLINE.has(val)) f.underline = val as Font["underline"];
        else if (val === "none") f.underline = false;
        break;
      case "vertAlign":
        if (val === "superscript" || val === "subscript" || val === "baseline") f.vertAlign = val;
        break;
      case "family": {
        const n = int(val);
        if (n !== undefined) f.family = n;
        break;
      }
      case "charset": {
        const n = int(val);
        if (n !== undefined) f.charset = n;
        break;
      }
      case "scheme":
        if (val === "major" || val === "minor" || val === "none") f.scheme = val;
        break;
      default:
        break;
    }
  }
}

/** Streaming handler state for styles.xml. */
export class StylesParser {
  private readonly numFmts = new Map<number, string>();
  private readonly fonts: Font[] = [];
  private readonly fills: Array<Fill | undefined> = [];
  private readonly borders: Array<Border | undefined> = [];
  private readonly xfs: RawXf[] = [];
  private indexed: string[] | undefined;

  private section = "";
  private font: FontBuilder | undefined;
  private fill: { pattern?: PatternFill; gradient?: GradientFill; stop?: number; inFg?: boolean } | undefined;
  private fillColorTarget: "fgColor" | "bgColor" | "stop" | undefined;
  private border: { b: Border; side?: keyof Border | undefined } | undefined;
  private xf: RawXf | undefined;

  constructor(private readonly full: boolean) {}

  open(name: string, a: XmlAttrs, empty: boolean): void {
    switch (name) {
      case "numFmts":
      case "fonts":
      case "fills":
      case "borders":
      case "cellXfs":
      case "cellStyleXfs":
      case "dxfs":
      case "indexedColors":
      case "colors":
      case "cellStyles":
      case "tableStyles":
      case "extLst":
        if (!empty) this.section = name;
        return;
      default:
        break;
    }
    const sec = this.section;
    if (sec === "numFmts" && name === "numFmt") {
      const id = int(a.get("numFmtId"));
      const code = a.get("formatCode");
      if (id !== undefined && code !== undefined) this.numFmts.set(id, code);
      return;
    }
    if (sec === "cellXfs" && name === "xf") {
      this.xf = {
        numFmtId: int(a.get("numFmtId")) ?? 0,
        fontId: int(a.get("fontId")) ?? 0,
        fillId: int(a.get("fillId")) ?? 0,
        borderId: int(a.get("borderId")) ?? 0,
      };
      this.xfs.push(this.xf);
      if (empty) this.xf = undefined;
      return;
    }
    if (sec === "indexedColors" && name === "rgbColor") {
      const rgb = a.get("rgb");
      if (rgb && /^[0-9A-Fa-f]{8}$/.test(rgb)) (this.indexed ??= []).push(rgb.toUpperCase());
      return;
    }
    if (!this.full) return;
    if (sec === "cellXfs" && this.xf) {
      if (name === "alignment") this.xf.alignment = alignment(a);
      else if (name === "protection") {
        const p: { locked?: boolean; hidden?: boolean } = {};
        if (a.get("locked") !== undefined) p.locked = bool(a.get("locked"));
        if (a.get("hidden") !== undefined) p.hidden = bool(a.get("hidden"));
        this.xf.protection = p;
      }
      return;
    }
    if (sec === "fonts") {
      if (name === "font") {
        this.font = new FontBuilder();
        if (empty) this.endFont();
      } else this.font?.child(name, a);
      return;
    }
    if (sec === "fills") {
      if (name === "fill") {
        this.fill = {};
        if (empty) this.endFill();
      } else if (name === "patternFill" && this.fill) {
        const t = a.get("patternType") ?? "none";
        this.fill.pattern = { type: "pattern", pattern: (PATTERNS.has(t) ? t : "none") as PatternType };
      } else if (name === "gradientFill" && this.fill) {
        const g: GradientFill = { type: "gradient", gradient: a.get("type") === "path" ? "path" : "linear", stops: [] };
        for (const k of ["degree", "left", "right", "top", "bottom"] as const) {
          const n = num(a.get(k));
          if (n !== undefined) g[k] = n;
        }
        this.fill.gradient = g;
      } else if (name === "stop" && this.fill?.gradient) {
        this.fill.stop = num(a.get("position")) ?? 0;
        this.fillColorTarget = "stop";
      } else if ((name === "fgColor" || name === "bgColor") && this.fill?.pattern) {
        const c = color(a);
        if (c) this.fill.pattern[name] = c;
      } else if (name === "color" && this.fillColorTarget === "stop" && this.fill?.gradient) {
        const c = color(a);
        if (c) this.fill.gradient.stops.push({ position: this.fill.stop ?? 0, color: c });
      }
      return;
    }
    if (sec === "borders") {
      if (name === "border") {
        const b: Border = {};
        if (a.get("diagonalUp") !== undefined) b.diagonalUp = bool(a.get("diagonalUp"));
        if (a.get("diagonalDown") !== undefined) b.diagonalDown = bool(a.get("diagonalDown"));
        this.border = { b };
        if (empty) this.endBorder();
      } else if (this.border && (name === "left" || name === "right" || name === "top" || name === "bottom" || name === "diagonal" || name === "start" || name === "end")) {
        const side: keyof Border = name === "start" ? "left" : name === "end" ? "right" : name;
        const st = a.get("style");
        if (st !== undefined && st !== "none" && BORDER_STYLES.has(st)) {
          (this.border.b as Record<string, unknown>)[side] = { style: st as BorderStyle } satisfies BorderSide;
          this.border.side = empty ? undefined : side;
        } else this.border.side = undefined;
      } else if (name === "color" && this.border?.side) {
        const c = color(a);
        const s = (this.border.b as Record<string, BorderSide | undefined>)[this.border.side];
        if (c && s) s.color = c;
      }
    }
  }

  close(name: string): void {
    switch (name) {
      case "numFmts":
      case "fonts":
      case "fills":
      case "borders":
      case "cellXfs":
      case "cellStyleXfs":
      case "dxfs":
      case "indexedColors":
      case "colors":
      case "cellStyles":
      case "tableStyles":
      case "extLst":
        this.section = name === "indexedColors" ? "colors" : "";
        return;
      case "font":
        if (this.section === "fonts") this.endFont();
        return;
      case "fill":
        if (this.section === "fills") this.endFill();
        return;
      case "stop":
        this.fillColorTarget = undefined;
        return;
      case "border":
        if (this.section === "borders") this.endBorder();
        return;
      case "left":
      case "right":
      case "top":
      case "bottom":
      case "diagonal":
      case "start":
      case "end":
        if (this.border) this.border.side = undefined;
        return;
      case "xf":
        this.xf = undefined;
        return;
      default:
        return;
    }
  }

  text(): void {}

  private endFont(): void {
    if (this.font) this.fonts.push(this.font.font);
    this.font = undefined;
  }

  private endFill(): void {
    const f = this.fill;
    let out: Fill | undefined;
    if (f?.gradient) out = f.gradient;
    else if (f?.pattern && f.pattern.pattern !== "none") out = f.pattern;
    this.fills.push(out);
    this.fill = undefined;
  }

  private endBorder(): void {
    if (this.border) {
      const b = this.border.b;
      this.borders.push(Object.keys(b).length ? b : undefined);
    }
    this.border = undefined;
  }

  /** Builds the shared, frozen styles. */
  result(): StyleTable {
    const xfs = this.xfs;
    const numFmts = this.numFmts;
    const full = this.full;
    const fmtOf = (x: RawXf): NumFmt | undefined => {
      const custom = numFmts.get(x.numFmtId);
      if (custom !== undefined) return custom === "General" ? undefined : custom;
      return x.numFmtId === 0 ? undefined : x.numFmtId;
    };
    const styles: Array<Style | undefined> = new Array(xfs.length);
    const built: boolean[] = new Array(xfs.length).fill(false);
    const fonts = this.fonts;
    const fills = this.fills;
    const borders = this.borders;
    const make = (i: number): Style | undefined => {
      const x = xfs[i]!;
      const s: Style = {};
      const font = fonts[x.fontId];
      // Font 0 is the workbook default; a style records it only when the xf
      // points elsewhere, so default-font cells don't carry a copy.
      if (font && x.fontId !== 0 && Object.keys(font).length) s.font = font;
      const fill = fills[x.fillId];
      if (fill && x.fillId > 1) s.fill = fill; // fills 0 and 1 are the required none/gray125 placeholders
      const border = borders[x.borderId];
      if (border && x.borderId !== 0) s.border = border;
      if (x.alignment && Object.keys(x.alignment).length) s.alignment = x.alignment;
      const nf = fmtOf(x);
      if (nf !== undefined) s.numFmt = nf;
      if (x.protection && Object.keys(x.protection).length) s.protection = x.protection;
      return Object.keys(s).length ? deepFreeze(s) : undefined;
    };
    return {
      size: xfs.length,
      indexedColors: this.indexed,
      numFmt: (i) => {
        const x = xfs[i];
        return x ? fmtOf(x) : undefined;
      },
      style: (i) => {
        if (!full || i <= 0 || i >= xfs.length) return undefined;
        if (!built[i]) {
          styles[i] = make(i);
          built[i] = true;
        }
        return styles[i];
      },
    };
  }
}

function alignment(a: XmlAttrs): Alignment {
  const al: Alignment = {};
  const h = a.get("horizontal");
  if (h !== undefined && H_ALIGN.has(h)) al.horizontal = h as Alignment["horizontal"];
  const v = a.get("vertical");
  if (v !== undefined && V_ALIGN.has(v)) al.vertical = v as Alignment["vertical"];
  if (a.get("wrapText") !== undefined) al.wrapText = bool(a.get("wrapText"));
  if (a.get("shrinkToFit") !== undefined) al.shrinkToFit = bool(a.get("shrinkToFit"));
  if (a.get("justifyLastLine") !== undefined) al.justifyLastLine = bool(a.get("justifyLastLine"));
  const indent = int(a.get("indent"));
  if (indent !== undefined && indent > 0) al.indent = indent;
  const rot = int(a.get("textRotation"));
  if (rot !== undefined && rot !== 0) {
    if (rot === 255) al.rotation = "vertical";
    else if (rot >= 1 && rot <= 90) al.rotation = rot;
    else if (rot > 90 && rot <= 180) al.rotation = -(rot - 90);
  }
  const ro = int(a.get("readingOrder"));
  if (ro === 1) al.readingOrder = "ltr";
  else if (ro === 2) al.readingOrder = "rtl";
  return al;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
