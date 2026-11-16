/**
 * Number-format code parser (docs/api.md §5.6). Turns a code such as
 * `#,##0.00;[Red](#,##0.00)` into compiled sections. Linear in the code's
 * length, no regular expressions with nested quantifiers, and it never
 * throws: anything it does not recognise is kept as literal text, as Excel
 * shows most stray characters.
 */

/** One token of a section. */
export type Tok =
  | { t: "lit"; s: string }
  | { t: "digit"; c: "0" | "#" | "?" }
  | { t: "point" }
  | { t: "comma" }
  | { t: "pct" }
  | { t: "exp"; s: string } // "E+", "E-", "e+", "e-" as written
  | { t: "slash" }
  | { t: "text" } // @
  | { t: "space" } // _x: a space as wide as x; rendered as one space
  | { t: "fill"; c: string } // *x: repeat x to fill the cell
  | { t: "general" }
  | { t: "date"; k: "y" | "m" | "d" | "h" | "s" | "e" | "b" | "g"; n: number }
  | { t: "minute"; n: number } // an "m" run that means minutes (resolved after tokenising)
  | { t: "elapsed"; k: "h" | "m" | "s"; n: number }
  | { t: "ampm"; s: string } // "AM/PM", "am/pm", "A/P", "a/p" as written
  | { t: "subsec"; n: number }; // ".0" to ".000" after seconds

export type Op = "<" | "<=" | ">" | ">=" | "=" | "<>";

export interface Section {
  toks: Tok[];
  kind: "number" | "date" | "text" | "general" | "literal";
  /** Format colour as 'RRGGBB' name or [ColorN] palette index. */
  color?: { name: string } | { index: number } | undefined;
  cond?: { op: Op; v: number } | undefined;
  /** Locale id from a [$-xxxx] or [$sym-xxxx] tag, lower 16 bits. */
  lcid?: number | undefined;
  /** [$-F800] / [$-x-sysdate]: the system long date; [$-F400] / [$-x-systime]: the system time. */
  system?: "longDate" | "time" | undefined;
}

export interface Compiled {
  sections: Section[];
}

const COLOR_NAMES = new Set(["black", "blue", "cyan", "green", "magenta", "red", "white", "yellow"]);

/** Splits a code at top-level semicolons (not inside quotes, brackets or after a backslash). */
function splitSections(code: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === "\\" || ch === "_" || ch === "*") i++;
    else if (ch === '"') {
      const end = code.indexOf('"', i + 1);
      i = end === -1 ? code.length : end;
    } else if (ch === "[") {
      const end = code.indexOf("]", i + 1);
      if (end !== -1) i = end;
    } else if (ch === ";") {
      out.push(code.slice(start, i));
      start = i + 1;
    }
  }
  out.push(code.slice(start));
  return out;
}

const COND = /^(<=|>=|<>|<|>|=)\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;

function bracket(sec: Section, toks: Tok[], inner: string): void {
  const lower = inner.toLowerCase();
  if (COLOR_NAMES.has(lower)) {
    sec.color = { name: lower };
    return;
  }
  const colorN = /^color\s*(\d{1,2})$/.exec(lower);
  if (colorN) {
    const n = Number(colorN[1]);
    if (n >= 1 && n <= 56) sec.color = { index: n };
    return;
  }
  const cond = COND.exec(inner.trim());
  if (cond) {
    sec.cond = { op: cond[1] as Op, v: Number(cond[2]) };
    return;
  }
  if (/^(h+|m+|s+)$/.test(lower)) {
    toks.push({ t: "elapsed", k: lower[0] as "h" | "m" | "s", n: lower.length });
    return;
  }
  if (inner.startsWith("$")) {
    // [$€-407]: currency symbol, then an optional locale id in hex. [$-409]: locale only.
    // [$-x-sysdate] / [$-x-systime]: Excel's system date and time formats.
    const dash = inner.indexOf("-", 1);
    const symbol = dash === -1 ? inner.slice(1) : inner.slice(1, dash);
    const tag = dash === -1 ? "" : inner.slice(dash + 1).toLowerCase();
    if (symbol) toks.push({ t: "lit", s: symbol });
    if (tag === "x-sysdate") sec.system = "longDate";
    else if (tag === "x-systime") sec.system = "time";
    else if (/^[0-9a-f]{1,8}$/.test(tag)) {
      const id = Number.parseInt(tag, 16) & 0xffff;
      if (id === 0xf800) sec.system = "longDate";
      else if (id === 0xf400) sec.system = "time";
      else sec.lcid = id;
    }
    return;
  }
  // Other bracket codes ([DBNum1], [NatNum1], …) are not rendered.
}

function tokenize(src: string): Section {
  const sec: Section = { toks: [], kind: "literal" };
  const toks = sec.toks;
  const lit = (s: string): void => {
    const last = toks[toks.length - 1];
    if (last?.t === "lit") last.s += s;
    else toks.push({ t: "lit", s });
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    const rest = (n: number): string => src.slice(i, i + n).toLowerCase();
    switch (ch) {
      case '"': {
        const end = src.indexOf('"', i + 1);
        const stop = end === -1 ? src.length : end;
        if (stop > i + 1) lit(src.slice(i + 1, stop));
        i = stop;
        continue;
      }
      case "\\":
        if (i + 1 < src.length) lit(src[++i]!);
        continue;
      case "_":
        if (i + 1 < src.length) i++;
        toks.push({ t: "space" });
        continue;
      case "*":
        if (i + 1 < src.length) toks.push({ t: "fill", c: src[++i]! });
        continue;
      case "[": {
        const end = src.indexOf("]", i + 1);
        if (end === -1) {
          lit(src.slice(i));
          i = src.length;
          continue;
        }
        bracket(sec, toks, src.slice(i + 1, end));
        i = end;
        continue;
      }
      case "0":
      case "#":
      case "?":
        toks.push({ t: "digit", c: ch });
        continue;
      case ".":
        toks.push({ t: "point" });
        continue;
      case ",":
        toks.push({ t: "comma" });
        continue;
      case "%":
        toks.push({ t: "pct" });
        continue;
      case "/":
        toks.push({ t: "slash" });
        continue;
      case "@":
        toks.push({ t: "text" });
        continue;
    }
    if (rest(7) === "general") {
      toks.push({ t: "general" });
      i += 6;
      continue;
    }
    if (rest(5) === "am/pm") {
      toks.push({ t: "ampm", s: src.slice(i, i + 5) });
      i += 4;
      continue;
    }
    if (rest(3) === "a/p") {
      toks.push({ t: "ampm", s: src.slice(i, i + 3) });
      i += 2;
      continue;
    }
    if ((ch === "E" || ch === "e") && (src[i + 1] === "+" || src[i + 1] === "-")) {
      toks.push({ t: "exp", s: src.slice(i, i + 2) });
      i++;
      continue;
    }
    const k = ch.toLowerCase();
    if (k === "y" || k === "m" || k === "d" || k === "h" || k === "s" || k === "e" || k === "b" || k === "g") {
      let n = 1;
      while (i + n < src.length && src[i + n]!.toLowerCase() === k) n++;
      toks.push({ t: "date", k, n });
      i += n - 1;
      continue;
    }
    lit(ch);
  }
  return sec;
}

const isDateTok = (t: Tok): boolean => t.t === "date" || t.t === "elapsed" || t.t === "ampm" || t.t === "minute";

/** Classifies a section and resolves date-only tokens (minutes vs months, sub-seconds). */
function finish(sec: Section): Section {
  const toks = sec.toks;
  if (toks.some(isDateTok)) {
    sec.kind = "date";
    // "m"/"mm" is minutes right after an hour token or right before a seconds token (literals skipped).
    const dateIdx = toks.map((t, i) => (isDateTok(t) ? i : -1)).filter((i) => i >= 0);
    dateIdx.forEach((idx, j) => {
      const t = toks[idx]!;
      if (t.t !== "date" || t.k !== "m" || t.n > 2) return;
      const prev = j > 0 ? toks[dateIdx[j - 1]!] : undefined;
      const next = j + 1 < dateIdx.length ? toks[dateIdx[j + 1]!] : undefined;
      const afterHour = (prev?.t === "date" && prev.k === "h") || (prev?.t === "elapsed" && prev.k === "h");
      const beforeSecond = (next?.t === "date" && next.k === "s") || (next?.t === "elapsed" && next.k === "s");
      if (afterHour || beforeSecond) toks[idx] = { t: "minute", n: t.n };
    });
    // In a date section, "." followed by 0s after seconds is a fraction of a second; other number tokens are literal.
    const out: Tok[] = [];
    let seenSeconds = false;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if ((t.t === "date" && t.k === "s") || (t.t === "elapsed" && t.k === "s")) seenSeconds = true;
      if (t.t === "point" && seenSeconds && toks[i + 1]?.t === "digit" && (toks[i + 1] as { c: string }).c === "0") {
        let n = 0;
        while (toks[i + 1 + n]?.t === "digit" && (toks[i + 1 + n] as { c: string }).c === "0") n++;
        out.push({ t: "subsec", n: Math.min(n, 3) });
        i += n;
        continue;
      }
      out.push(literalInDate(t));
    }
    sec.toks = mergeLits(out);
    return sec;
  }
  if (toks.some((t) => t.t === "text")) sec.kind = "text";
  else if (toks.some((t) => t.t === "digit")) sec.kind = "number";
  else if (toks.some((t) => t.t === "general")) sec.kind = "general";
  else sec.kind = "literal";
  return sec;
}

function literalInDate(t: Tok): Tok {
  switch (t.t) {
    case "digit":
      return { t: "lit", s: t.c };
    case "point":
      return { t: "lit", s: "." };
    case "comma":
      return { t: "lit", s: "," };
    case "pct":
      return { t: "lit", s: "%" };
    case "slash":
      return { t: "lit", s: "/" };
    case "exp":
      return { t: "lit", s: t.s };
    default:
      return t;
  }
}

function mergeLits(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (const t of toks) {
    const last = out[out.length - 1];
    if (t.t === "lit" && last?.t === "lit") last.s += t.s;
    else out.push(t);
  }
  return out;
}

/** Compiles a format code. At most four sections are used, as in Excel. */
export function compile(code: string): Compiled {
  const sections = splitSections(code).slice(0, 4).map((s) => finish(tokenize(s)));
  return { sections };
}
