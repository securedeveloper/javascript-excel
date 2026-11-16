/**
 * A1 reference shifter for shared formulas (docs/api.md §12 Q6). Internal.
 *
 * Shifts relative cell references, `$` anchors stay; handles ranges, whole
 * column (`A:C`) and whole row (`1:3`) ranges and sheet-qualified references.
 * String literals, quoted sheet names and bracketed parts (structured
 * references, external workbook indexes) are copied unchanged. Returns
 * undefined when a shifted reference would leave the sheet, so the caller
 * keeps the cached value only.
 */

const MAX_ROW = 1_048_576;
const MAX_COL = 16_384;

const CELL = /\$?([A-Za-z]{1,3})\$?(\d{1,7})/y;
const CELL_PARTS = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;
const COLS = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/y;
const ROWS = /(\$?)(\d{1,7}):(\$?)(\d{1,7})/y;

export function colNumber(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  return n;
}

export function colLetters(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_.\\]/.test(c);
}

export function shiftFormula(formula: string, dRow: number, dCol: number): string | undefined {
  if (dRow === 0 && dCol === 0) return formula;
  let out = "";
  let i = 0;
  const n = formula.length;
  while (i < n) {
    const ch = formula[i]!;
    // String literal "..." with "" escapes.
    if (ch === '"') {
      let j = i + 1;
      for (; j < n; j++) {
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') j++;
          else break;
        }
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Quoted sheet name 'It''s'.
    if (ch === "'") {
      let j = i + 1;
      for (; j < n; j++) {
        if (formula[j] === "'") {
          if (formula[j + 1] === "'") j++;
          else break;
        }
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Brackets: structured references and external workbook indexes; nesting allowed.
    if (ch === "[") {
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (formula[j] === "[") depth++;
        else if (formula[j] === "]" && --depth === 0) break;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const prev = i > 0 ? formula[i - 1] : undefined;
    if ((ch === "$" || /[A-Za-z0-9]/.test(ch)) && !isWordChar(prev) && prev !== "$") {
      const shifted = tryRef(formula, i, dRow, dCol);
      if (shifted === null) return undefined; // a reference would leave the sheet
      if (shifted !== undefined) {
        out += shifted.text;
        i = shifted.end;
        continue;
      }
      // Not a reference: copy the whole word.
      let j = i + 1;
      while (j < n && isWordChar(formula[j])) j++;
      out += formula.slice(i, j);
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** A reference at `i`: { text, end }, undefined if there is none, null if shifting fails. */
function tryRef(f: string, i: number, dRow: number, dCol: number): { text: string; end: number } | undefined | null {
  const after = (end: number): string | undefined => f[end];
  const isEnd = (end: number): boolean => {
    const c = after(end);
    return c === undefined || !(isWordChar(c) || c === "(" || c === "!" || c === "$");
  };
  COLS.lastIndex = i;
  let m = COLS.exec(f);
  if (m && isEnd(COLS.lastIndex)) {
    const a = shiftPart(m[1]!, colNumber(m[2]!), dCol, MAX_COL);
    const b = shiftPart(m[3]!, colNumber(m[4]!), dCol, MAX_COL);
    if (colNumber(m[2]!) > MAX_COL || colNumber(m[4]!) > MAX_COL) return undefined;
    if (a === undefined || b === undefined) return null;
    return { text: `${m[1]}${colLetters(a)}:${m[3]}${colLetters(b)}`, end: COLS.lastIndex };
  }
  ROWS.lastIndex = i;
  m = ROWS.exec(f);
  if (m && isEnd(ROWS.lastIndex)) {
    const a = shiftPart(m[1]!, Number(m[2]), dRow, MAX_ROW);
    const b = shiftPart(m[3]!, Number(m[4]), dRow, MAX_ROW);
    if (a === undefined || b === undefined) return null;
    return { text: `${m[1]}${a}:${m[3]}${b}`, end: ROWS.lastIndex };
  }
  CELL.lastIndex = i;
  m = CELL.exec(f);
  if (m && isEnd(CELL.lastIndex)) {
    const parts = CELL_PARTS.exec(m[0])!;
    const col = colNumber(parts[2]!);
    if (col > MAX_COL) return undefined; // a name such as ABCD1, not a reference
    const c = shiftPart(parts[1]!, col, dCol, MAX_COL);
    const r = shiftPart(parts[3]!, Number(parts[4]), dRow, MAX_ROW);
    if (c === undefined || r === undefined) return null;
    return { text: `${parts[1]}${colLetters(c)}${parts[3]}${r}`, end: CELL.lastIndex };
  }
  return undefined;
}

function shiftPart(anchor: string, value: number, delta: number, max: number): number | undefined {
  if (anchor === "$") return value;
  const v = value + delta;
  return v >= 1 && v <= max ? v : undefined;
}
