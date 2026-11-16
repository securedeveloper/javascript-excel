/**
 * Number rendering for format sections: plain, percent, scaled, grouped,
 * scientific, fractions and General (docs/api.md §5.6).
 *
 * Arithmetic is done on decimal strings taken from `toPrecision(15)`, the
 * precision Excel keeps, so 1.005 rounds to 1.01 as Excel shows it rather
 * than to 1.00 as binary floating point would.
 */

import type { LocaleData } from "./locale";
import type { Section, Tok } from "./parse";

/** A non-negative decimal: value = 0.digits × 10^point (digits has no leading zeros; "" is zero). */
interface Dec {
  digits: string;
  point: number;
}

export function decimalOf(v: number): Dec {
  if (v === 0) return { digits: "", point: 0 };
  const [mant, e] = Math.abs(v).toPrecision(15).split("e") as [string, string | undefined];
  const [ip, fp = ""] = mant.split(".") as [string, string | undefined];
  let digits = ip + fp;
  let point = ip.length + (e ? Number(e) : 0);
  let i = 0;
  while (i < digits.length - 1 && digits[i] === "0") {
    i++;
    point--;
  }
  digits = digits.slice(i).replace(/0+$/, "");
  return digits === "" ? { digits: "", point: 0 } : { digits, point };
}

const shift = (d: Dec, k: number): Dec => (d.digits === "" ? d : { digits: d.digits, point: d.point + k });

/** Rounds half away from zero to `decimals` places: integer digits ("" for zero) and exactly `decimals` fraction digits. */
export function roundDec(d: Dec, decimals: number): { int: string; frac: string } {
  const keep = d.point + decimals;
  if (d.digits === "" || keep < 0) return { int: "", frac: "0".repeat(decimals) };
  let kept = d.digits.slice(0, keep).padEnd(keep, "0");
  const next = d.digits[keep];
  if (next !== undefined && next >= "5") kept = increment(kept);
  const full = kept.padStart(decimals, "0");
  const int = full.slice(0, full.length - decimals).replace(/^0+/, "");
  return { int, frac: decimals > 0 ? full.slice(full.length - decimals) : "" };
}

function increment(s: string): string {
  const a = s.split("");
  let i = a.length - 1;
  while (i >= 0) {
    if (a[i] === "9") {
      a[i] = "0";
      i--;
    } else {
      a[i] = String(Number(a[i]) + 1);
      return a.join("");
    }
  }
  return `1${a.join("")}`;
}

export interface NumberOut {
  text: string;
  fill?: { char: string; at: number } | undefined;
}

/** Collects the output, tracking a `*x` fill position. */
class Out {
  text = "";
  fill: { char: string; at: number } | undefined;
  push(s: string): void {
    this.text += s;
  }
  tok(t: Tok, text?: string): boolean {
    switch (t.t) {
      case "lit":
        this.text += t.s;
        return true;
      case "space":
        this.text += " ";
        return true;
      case "fill":
        if (!this.fill) this.fill = { char: t.c, at: this.text.length };
        return true;
      case "text":
        this.text += text ?? "";
        return true;
      default:
        return false;
    }
  }
  result(): NumberOut {
    return this.fill ? { text: this.text, fill: this.fill } : { text: this.text };
  }
}

/** Formats a non-negative value with a number section (the caller adds any minus sign). */
export function formatNumber(sec: Section, v: number, loc: LocaleData, generalWidth: number): NumberOut {
  const toks = sec.toks;
  const expAt = toks.findIndex((t) => t.t === "exp");
  if (expAt !== -1) return scientific(toks, expAt, v, loc);
  const slashAt = fractionSlash(toks);
  if (slashAt !== -1) return fraction(toks, slashAt, v, loc);
  return plain(toks, v, loc, generalWidth);
}

/** Index of a slash with digit placeholders before it and placeholders or digits after it, else -1. */
function fractionSlash(toks: Tok[]): number {
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]!.t !== "slash") continue;
    const before = toks[i - 1];
    const after = toks[i + 1];
    if (before?.t === "digit" && (after?.t === "digit" || (after?.t === "lit" && /^[1-9]/.test(after.s)))) return i;
  }
  return -1;
}

interface Layout {
  intToks: number[]; // indices of digit placeholders before the decimal point
  fracToks: number[];
  pointAt: number; // index of the decimal point token, or -1
  grouping: boolean;
  scale: number; // power of ten applied: +2 per %, -3 per scaling comma
  commaRole: Map<number, "group" | "scale" | "lit">;
}

function layout(toks: Tok[], from: number, to: number): Layout {
  const intToks: number[] = [];
  const fracToks: number[] = [];
  let pointAt = -1;
  let scale = 0;
  for (let i = from; i < to; i++) {
    const t = toks[i]!;
    if (t.t === "point" && pointAt === -1) pointAt = i;
    else if (t.t === "digit") (pointAt === -1 ? intToks : fracToks).push(i);
    else if (t.t === "pct") scale += 2;
  }
  const commaRole = new Map<number, "group" | "scale" | "lit">();
  let grouping = false;
  const lastInt = intToks[intToks.length - 1] ?? -1;
  const firstInt = intToks[0] ?? -1;
  const lastDigit = fracToks[fracToks.length - 1] ?? lastInt;
  for (let i = from; i < to; i++) {
    if (toks[i]!.t !== "comma") continue;
    if (i > firstInt && i < lastInt && firstInt !== -1) {
      commaRole.set(i, "group");
      grouping = true;
    } else if (lastDigit !== -1 && i > lastDigit) {
      // Commas right after the last digit placeholder (possibly several) scale by 1,000 each.
      let j = lastDigit + 1;
      while (j < i && toks[j]!.t === "comma") j++;
      if (j === i) {
        commaRole.set(i, "scale");
        scale -= 3;
      } else commaRole.set(i, "lit");
    } else commaRole.set(i, "lit");
  }
  return { intToks, fracToks, pointAt, grouping, scale, commaRole };
}

/** Places integer digits into placeholders, right to left; extra digits go to the leftmost one. */
function placeInt(toks: Tok[], idx: number[], digits: string): Map<number, string> {
  const out = new Map<number, string>();
  let d = digits.length;
  for (let k = idx.length - 1; k >= 0; k--) {
    const c = (toks[idx[k]!] as { c: "0" | "#" | "?" }).c;
    let s = d > 0 ? digits[--d]! : c === "0" ? "0" : c === "?" ? " " : "";
    if (k === 0 && d > 0) s = digits.slice(0, d) + s;
    out.set(idx[k]!, s);
  }
  return out;
}

function group(s: string, sep: string): string {
  // Insert the separator between real digits, counting from the right.
  let out = "";
  let count = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]!;
    if (ch >= "0" && ch <= "9") {
      if (count > 0 && count % 3 === 0) out = sep + out;
      count++;
    }
    out = ch + out;
  }
  return out;
}

function placeFrac(toks: Tok[], idx: number[], frac: string): Map<number, string> {
  const out = new Map<number, string>();
  // Trailing zeros are dropped for '#' and shown as spaces for '?', from the right, up to the last '0' placeholder.
  let trim = true;
  for (let k = idx.length - 1; k >= 0; k--) {
    const c = (toks[idx[k]!] as { c: "0" | "#" | "?" }).c;
    const digit = frac[k] ?? "0";
    if (trim && digit === "0" && c !== "0") out.set(idx[k]!, c === "?" ? " " : "");
    else {
      trim = false;
      out.set(idx[k]!, digit);
    }
  }
  return out;
}

function plain(toks: Tok[], v: number, loc: LocaleData, generalWidth: number): NumberOut {
  const lay = layout(toks, 0, toks.length);
  const r = roundDec(shift(decimalOf(v), lay.scale), lay.fracToks.length);
  const ints = placeInt(toks, lay.intToks, r.int);
  const fracs = placeFrac(toks, lay.fracToks, r.frac);
  const out = new Out();
  let intText = "";
  const flushInt = (): void => {
    if (intText) out.push(lay.grouping ? group(intText, loc.group) : intText);
    intText = "";
  };
  const firstInt = lay.intToks[0] ?? -1;
  const lastInt = lay.intToks[lay.intToks.length - 1] ?? -1;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const inInt = i >= firstInt && i <= lastInt && firstInt !== -1;
    if (t.t === "digit") {
      if (ints.has(i)) intText += ints.get(i)!;
      else out.push(fracs.get(i) ?? "");
      if (i === lastInt) flushInt();
      continue;
    }
    if (inInt) {
      if (t.t === "comma") continue; // grouping commas between placeholders
      if (t.t === "lit" || t.t === "space") {
        intText += t.t === "lit" ? t.s : " ";
        continue;
      }
    }
    switch (t.t) {
      case "point":
        if (i === lay.pointAt) out.push(loc.decimal);
        else out.push(".");
        break;
      case "comma":
        if (lay.commaRole.get(i) === "lit") out.push(",");
        break;
      case "pct":
        out.push("%");
        break;
      case "slash":
        out.push("/");
        break;
      case "exp":
        out.push(t.s);
        break;
      case "general":
        out.push(general(v, loc, generalWidth));
        break;
      default:
        out.tok(t);
    }
  }
  flushInt();
  return out.result();
}

function scientific(toks: Tok[], expAt: number, v: number, loc: LocaleData): NumberOut {
  const lay = layout(toks, 0, expAt);
  const intCount = Math.max(1, lay.intToks.length);
  const engineering = lay.intToks.some((i) => (toks[i] as { c: string }).c === "#") && lay.intToks.length > 1;
  const d = decimalOf(v);
  let exp = 0;
  let r = { int: "", frac: "0".repeat(lay.fracToks.length) };
  if (d.digits !== "") {
    const e10 = d.point - 1;
    exp = engineering ? Math.floor(e10 / intCount) * intCount : e10 - (intCount - 1);
    r = roundDec(shift(d, -exp), lay.fracToks.length);
    // Rounding can carry into a new digit (9.99 → 10.0): step the exponent and redo.
    if (r.int.length > intCount) {
      exp += engineering ? intCount : 1;
      r = roundDec(shift(d, -exp), lay.fracToks.length);
    }
  }
  const ints = placeInt(toks, lay.intToks, r.int);
  const fracs = placeFrac(toks, lay.fracToks, r.frac);
  const out = new Out();
  for (let i = 0; i < expAt; i++) {
    const t = toks[i]!;
    if (t.t === "digit") out.push(ints.get(i) ?? fracs.get(i) ?? "");
    else if (t.t === "point") out.push(i === lay.pointAt ? loc.decimal : ".");
    else if (t.t === "pct") out.push("%");
    else if (t.t === "comma") continue;
    else out.tok(t);
  }
  const expTok = toks[expAt] as { s: string };
  out.push(expTok.s[0]!);
  if (exp < 0) out.push("-");
  else if (expTok.s[1] === "+") out.push("+");
  const expDigits = String(Math.abs(exp));
  const after = toks.slice(expAt + 1);
  const minDigits = after.filter((t) => t.t === "digit" && t.c === "0").length;
  let placed = false;
  for (const t of after) {
    if (t.t === "digit") {
      if (!placed) {
        out.push(expDigits.padStart(minDigits, "0"));
        placed = true;
      }
      continue;
    }
    out.tok(t);
  }
  if (!placed) out.push(expDigits);
  return out.result();
}

function fraction(toks: Tok[], slashAt: number, v: number, loc: LocaleData): NumberOut {
  // Numerator: the run of placeholders right before the slash. Integer part: an earlier run, if any.
  let numStart = slashAt - 1;
  while (numStart > 0 && toks[numStart - 1]!.t === "digit") numStart--;
  const numIdx = range(numStart, slashAt);
  const intIdx: number[] = [];
  for (let i = 0; i < numStart; i++) if (toks[i]!.t === "digit") intIdx.push(i);
  const after = toks[slashAt + 1]!;
  let denEnd = slashAt + 1;
  let fixedDen = 0;
  let denIdx: number[] = [];
  if (after.t === "lit") {
    const m = /^[1-9]\d*/.exec(after.s)!;
    fixedDen = Number(m[0]);
    denEnd = slashAt + 2;
  } else {
    while (toks[denEnd]?.t === "digit") denEnd++;
    denIdx = range(slashAt + 1, denEnd);
  }
  const hasInt = intIdx.length > 0;
  let whole = hasInt ? Math.floor(v) : 0;
  const part = hasInt ? v - whole : v;
  let num: number;
  let den: number;
  if (fixedDen) {
    den = fixedDen;
    num = Math.round(part * den);
  } else {
    [num, den] = approximate(part, 10 ** denIdx.length - 1);
  }
  if (hasInt && num === den) {
    whole += 1;
    num = 0;
  }

  const out = new Out();
  // Zero shows as "0" in the integer part, with the fraction blanked.
  const intDigits = whole === 0 && !(hasInt && num === 0) ? "" : String(whole);
  const ints = placeInt(toks, intIdx, intDigits);
  const blankFraction = hasInt && num === 0;
  const numText = pad(String(num), numIdx.map((i) => (toks[i] as { c: string }).c), true);
  const denText = fixedDen ? String(fixedDen) : pad(String(den), denIdx.map((i) => (toks[i] as { c: string }).c), false);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (i < numStart) {
      if (t.t === "digit") {
        out.push(ints.get(i) ?? "");
      } else if (t.t === "point") out.push(loc.decimal);
      else if (t.t === "comma") continue;
      else out.tok(t);
      continue;
    }
    if (i === numStart) {
      out.push(blankFraction ? " ".repeat(numText.length) : numText);
      continue;
    }
    if (i > numStart && i < slashAt) continue;
    if (i === slashAt) {
      out.push(blankFraction ? " " : "/");
      continue;
    }
    if (i === slashAt + 1) {
      out.push(blankFraction ? " ".repeat(denText.length) : denText);
      if (fixedDen && t.t === "lit") {
        const rest = t.s.slice(String(fixedDen).length);
        if (rest) out.push(rest);
      }
      continue;
    }
    if (i < denEnd) continue;
    out.tok(t);
  }
  return out.result();
}

function range(a: number, b: number): number[] {
  return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
}

/** Pads per placeholders: '0' zero, '?' space, '#' nothing. Numerators pad on the left, denominators on the right. */
function pad(s: string, cs: string[], left: boolean): string {
  if (s.length >= cs.length) return s;
  const fill = cs.slice(0, cs.length - s.length).map((c) => (c === "0" ? "0" : c === "?" ? " " : ""));
  if (left) return fill.join("") + s;
  // Denominators: zeros would change the value, so '0' pads with spaces too on the right.
  return s + fill.map((f) => (f === "" ? "" : " ")).join("");
}

/** Best fraction num/den ≈ x with den ≤ maxDen (continued fractions, then the closest semiconvergent). */
export function approximate(x: number, maxDen: number): [number, number] {
  if (maxDen < 1) maxDen = 1;
  let [p0, q0, p1, q1] = [0, 1, 1, 0];
  let y = x;
  for (let iter = 0; iter < 64; iter++) {
    const a = Math.floor(y);
    const q2 = q0 + a * q1;
    if (q2 > maxDen) {
      const k = Math.floor((maxDen - q0) / q1);
      const [pk, qk] = [p0 + k * p1, q0 + k * q1];
      return Math.abs(x - pk / qk) < Math.abs(x - p1 / q1) ? [pk, qk] : [p1, q1];
    }
    [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
    const frac = y - a;
    if (frac < 1e-12 || Math.abs(x - p1 / q1) < 1e-15) break;
    y = 1 / frac;
  }
  return [p1, q1];
}

/**
 * Excel's General format for a number: as many digits as fit in `width`
 * characters (11 by default, the standard column), switching to scientific
 * notation for numbers of 1E+11 and above, and below 1E-04 `[to verify]`.
 */
export function general(v: number, loc: LocaleData, width: number): string {
  if (!Number.isFinite(v)) return "#NUM!";
  if (v === 0) return "0";
  const neg = v < 0;
  const d = decimalOf(v);
  const e10 = d.point - 1;
  const room = width - (neg ? 1 : 0);
  const sign = neg ? "-" : "";
  if (e10 >= -4 && e10 < room) {
    const intLen = Math.max(1, d.point);
    const decimals = Math.max(0, room - intLen - 1);
    const r = roundDec(d, decimals);
    if ((r.int || "0").length <= room) {
      const frac = r.frac.replace(/0+$/, "");
      return sign + (r.int || "0") + (frac ? loc.decimal + frac : "");
    }
  }
  // Scientific: d.ddddE+XX within the width.
  let exp = e10;
  let expText = (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  let decimals = Math.max(0, room - 2 - 1 - expText.length);
  let r = roundDec(shift(d, -exp), decimals);
  if (r.int.length > 1) {
    exp += 1;
    expText = (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
    decimals = Math.max(0, room - 2 - 1 - expText.length);
    r = roundDec(shift(d, -exp), decimals);
  }
  const frac = r.frac.replace(/0+$/, "");
  return `${sign}${r.int || "0"}${frac ? loc.decimal + frac : ""}E${expText}`;
}
