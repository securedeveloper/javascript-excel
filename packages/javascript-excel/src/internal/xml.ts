/**
 * XML text helpers for the writer.
 *
 * Two escapings:
 * - `xstring` for SpreadsheetML text that is an ST_Xstring (cell text, shared
 *   strings, formulas): characters XML 1.0 cannot carry, and CR (which XML
 *   parsers normalise to LF), are written as `_xHHHH_`. Text that already
 *   contains a literal `_xHHHH_` is protected as `_x005F_xHHHH_`
 *   (ECMA-376 Part 1, §22.9.2.19).
 * - `xmlText` / `xmlAttr` for ordinary XML (document properties, sheet names):
 *   only the markup characters are escaped, and characters XML 1.0 cannot
 *   carry are dropped, because those parts have no escape convention.
 */

// XML 1.0 Char: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
// Matches one character that is not allowed, including a lone surrogate.
const INVALID_XML_CHAR =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const NEEDS_XSTRING = /[\u0000-\u0008\u000B-\u001F\uD800-\uDFFF\uFFFE\uFFFF]|_x[0-9A-Fa-f]{4}_/;
const MARKUP_TEXT = /[&<>]/g;
const MARKUP_ATTR = /[&<>"\t\n\r]/g;

const ENTITY: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};
const entity = (c: string): string => ENTITY[c]!;

const hex4 = (code: number): string => code.toString(16).toUpperCase().padStart(4, "0");

/** Applies the ST_Xstring encoding (no markup escaping). */
function encodeXstring(s: string): string {
  if (!NEEDS_XSTRING.test(s)) return s;
  // Protect every '_' that starts an _xHHHH_ sequence. A lookahead, not a match, because sequences
  // can share an underscore: "_x005F_x0041_" needs both of its escapes protected.
  let out = s.replace(/_(?=x[0-9A-Fa-f]{4}_)/g, "_x005F_");
  out = out.replace(/\r/g, "_x000D_");
  out = out.replace(INVALID_XML_CHAR, (c) => `_x${hex4(c.charCodeAt(0))}_`);
  return out;
}

/** ST_Xstring text content: `_xHHHH_` encoding, then markup escaping. */
export function xstring(s: string): string {
  return encodeXstring(s).replace(MARKUP_TEXT, entity);
}

/** ST_Xstring in an attribute value. */
export function xstringAttr(s: string): string {
  return encodeXstring(s).replace(MARKUP_ATTR, entity);
}

/** Plain XML text content. Characters XML 1.0 cannot carry are dropped. */
export function xmlText(s: string): string {
  return s.replace(INVALID_XML_CHAR, "").replace(MARKUP_TEXT, entity);
}

/** Plain XML attribute value. Characters XML 1.0 cannot carry are dropped. */
export function xmlAttr(s: string): string {
  return s.replace(INVALID_XML_CHAR, "").replace(MARKUP_ATTR, entity);
}

/** True when text needs `xml:space="preserve"` to keep its whitespace. */
const WS = /\s/;

export function needsPreserve(s: string): boolean {
  // Test only the first and last characters: an end-anchored regex scans the whole string (JSE-8 profile).
  return s.length > 0 && (WS.test(s[0]!) || WS.test(s[s.length - 1]!) || s.includes("\n") || s.includes("\t"));
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/**
 * Formats a number for `<v>` and numeric attributes: shortest round-trip form,
 * which is valid xsd:double lexical form. -0 is written as 0.
 */
export function num(n: number): string {
  return Object.is(n, -0) ? "0" : String(n);
}
