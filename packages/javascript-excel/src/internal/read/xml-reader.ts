/**
 * Streaming XML pull tokenizer for the reader (docs/api.md §5.2, §8). Internal.
 *
 * - Push-fed: `feed()` text chunks as they are inflated, then `end()`. Only
 *   the unfinished tail of a chunk is kept, so a part is never held whole.
 * - Iterative, never recursive. Element depth is limited (`maxXmlDepth`).
 * - Any `<!DOCTYPE` is rejected (XML_DTD_FORBIDDEN), so there is no entity
 *   expansion and nothing external is ever fetched. Only the five predefined
 *   entities and numeric character references are decoded.
 * - Well-formedness is checked as far as the reader needs: tags must nest and
 *   match, attributes must be quoted, references must be valid.
 * - Names are reported without their namespace prefix (`x:row` -> `row`), so
 *   prefixed SpreadsheetML and ISO 29500 Strict parts read like transitional
 *   ones. Attributes keep their qualified names; see `XmlAttrs`.
 */

import { FormatError, LimitError } from "../../errors";

/** Attributes of one start tag. Names are never used as object keys. */
export class XmlAttrs {
  /** Flat [qname, value, qname, value, ...]. */
  constructor(private readonly items: string[]) {}

  /** Value of the unprefixed attribute `local`. */
  get(local: string): string | undefined {
    const items = this.items;
    for (let i = 0; i < items.length; i += 2) if (items[i] === local) return items[i + 1];
    return undefined;
  }

  /**
   * Value of a prefixed attribute with local name `local` (e.g. `r:id` for
   * "id"), whatever the prefix; `xml:` and `xmlns:` are skipped.
   */
  getPrefixed(local: string): string | undefined {
    const items = this.items;
    for (let i = 0; i < items.length; i += 2) {
      const q = items[i]!;
      const colon = q.indexOf(":");
      if (colon <= 0 || q.slice(colon + 1) !== local) continue;
      const prefix = q.slice(0, colon);
      if (prefix === "xml" || prefix === "xmlns") continue;
      return items[i + 1];
    }
    return undefined;
  }

  /** Value of the attribute with exactly this qualified name (e.g. `xml:space`, `xmlns`). */
  getQualified(qname: string): string | undefined {
    return this.get(qname);
  }

  /** Every [qualified name, value] pair, in document order. */
  *entries(): IterableIterator<[string, string]> {
    for (let i = 0; i < this.items.length; i += 2) yield [this.items[i]!, this.items[i + 1]!];
  }
}

export interface XmlHandler {
  /** A start tag. `name` is the local name. `empty` is true for `<x/>` (no close() follows). */
  open(name: string, attrs: XmlAttrs, empty: boolean): void;
  close(name: string): void;
  /** Character data (entities decoded, newlines normalised). May arrive in several pieces. */
  text(text: string): void;
}

export function malformed(message: string): FormatError {
  return new FormatError("XML_MALFORMED", message);
}

const EMPTY_ATTRS = new XmlAttrs([]);

export class XmlTokenizer {
  private buf = "";
  private readonly stack: string[] = [];
  private rootSeen = false;
  private rootClosed = false;
  private pendingCR = false;

  constructor(
    private readonly handler: XmlHandler,
    private readonly maxDepth: number,
  ) {}

  feed(chunk: string): void {
    this.buf = this.buf.length === 0 ? chunk : this.buf + chunk;
    this.pump(false);
  }

  end(): void {
    this.pump(true);
    if (this.buf.trim() !== "") throw malformed("Unexpected end of XML data.");
    if (this.stack.length > 0) throw malformed(`Element <${this.stack.at(-1)!}> is not closed.`);
    if (!this.rootSeen) throw malformed("XML part has no root element.");
  }

  private pump(final: boolean): void {
    const buf = this.buf;
    const len = buf.length;
    let i = 0;
    while (i < len) {
      if (buf.charCodeAt(i) !== 60 /* < */) {
        let j = buf.indexOf("<", i);
        if (j === -1) {
          if (!final) {
            // Keep a trailing, possibly incomplete reference for the next chunk.
            const amp = buf.lastIndexOf("&");
            j = amp >= i && buf.indexOf(";", amp) === -1 ? amp : len;
            if (j > i) this.chars(buf.slice(i, j));
            i = j;
            break;
          }
          j = len;
        }
        this.chars(buf.slice(i, j));
        i = j;
        continue;
      }
      // Markup. Need enough lookahead to classify it.
      if (len - i < 9 && !final && buf.startsWith("<!", i)) break;
      const c1 = buf.charCodeAt(i + 1);
      if (c1 === 63 /* ? */) {
        const e = buf.indexOf("?>", i + 2);
        if (e === -1) {
          if (final) throw malformed("Unterminated processing instruction.");
          break;
        }
        i = e + 2;
        continue;
      }
      if (c1 === 33 /* ! */) {
        if (buf.startsWith("<!--", i)) {
          const e = buf.indexOf("-->", i + 4);
          if (e === -1) {
            if (final) throw malformed("Unterminated comment.");
            break;
          }
          i = e + 3;
          continue;
        }
        if (buf.startsWith("<![CDATA[", i)) {
          const e = buf.indexOf("]]>", i + 9);
          if (e === -1) {
            if (final) throw malformed("Unterminated CDATA section.");
            break;
          }
          if (this.stack.length === 0) throw malformed("CDATA outside the root element.");
          this.handler.text(normaliseNewlines(buf.slice(i + 9, e)));
          i = e + 3;
          continue;
        }
        if (/^<!DOCTYPE/i.test(buf.slice(i, i + 9))) {
          throw new FormatError("XML_DTD_FORBIDDEN", "XML parts must not contain a document type declaration (<!DOCTYPE).");
        }
        throw malformed("Unexpected markup declaration.");
      }
      if (c1 === 47 /* / */) {
        const e = buf.indexOf(">", i + 2);
        if (e === -1) {
          if (final) throw malformed("Unterminated end tag.");
          break;
        }
        const qname = buf.slice(i + 2, e).trim();
        const open = this.stack.pop();
        if (open === undefined || open !== qname) {
          throw malformed(open === undefined ? `Unexpected end tag </${qname}>.` : `End tag </${qname}> does not match <${open}>.`);
        }
        if (this.stack.length === 0) this.rootClosed = true;
        this.handler.close(localName(qname));
        i = e + 1;
        continue;
      }
      // Start tag: find the closing '>' outside quoted attribute values.
      const e = findTagEnd(buf, i + 1);
      if (e === -1) {
        if (final) throw malformed("Unterminated start tag.");
        break;
      }
      this.startTag(buf, i + 1, e);
      i = e + 1;
    }
    this.buf = i >= len ? "" : buf.slice(i);
  }

  private chars(raw: string): void {
    if (this.stack.length === 0) {
      if (raw.trim() !== "") throw malformed("Text outside the root element.");
      return;
    }
    let s = raw.indexOf("&") === -1 ? raw : decodeReferences(raw);
    // Line-end normalisation across chunk boundaries (CR LF -> LF, CR -> LF).
    if (this.pendingCR) {
      if (s.charCodeAt(0) === 10) s = s.slice(1);
      this.pendingCR = false;
    }
    if (s.length > 0 && s.charCodeAt(s.length - 1) === 13) {
      this.pendingCR = true;
    }
    if (s.indexOf("\r") !== -1) s = s.replace(/\r\n?/g, "\n");
    if (s.length > 0) this.handler.text(s);
  }

  private startTag(buf: string, start: number, end: number): void {
    let selfClosing = false;
    let stop = end;
    if (buf.charCodeAt(end - 1) === 47 /* / */) {
      selfClosing = true;
      stop = end - 1;
    }
    // Element name.
    let p = start;
    while (p < stop && !isSpace(buf.charCodeAt(p))) p++;
    const qname = buf.slice(start, p);
    if (qname.length === 0) throw malformed("Start tag without a name.");
    if (this.rootClosed) throw malformed("Content after the root element.");
    const items: string[] = [];
    // Attributes: name = "value" | 'value'
    for (;;) {
      while (p < stop && isSpace(buf.charCodeAt(p))) p++;
      if (p >= stop) break;
      const nameStart = p;
      while (p < stop && buf.charCodeAt(p) !== 61 /* = */ && !isSpace(buf.charCodeAt(p))) p++;
      const aname = buf.slice(nameStart, p);
      while (p < stop && isSpace(buf.charCodeAt(p))) p++;
      if (buf.charCodeAt(p) !== 61 || aname.length === 0) throw malformed(`Malformed attribute in <${qname}>.`);
      p++;
      while (p < stop && isSpace(buf.charCodeAt(p))) p++;
      const q = buf.charCodeAt(p);
      if (q !== 34 && q !== 39) throw malformed(`Unquoted attribute value in <${qname}>.`);
      const close = buf.indexOf(q === 34 ? '"' : "'", p + 1);
      if (close === -1 || close >= stop) throw malformed(`Unterminated attribute value in <${qname}>.`);
      const raw = buf.slice(p + 1, close);
      if (raw.indexOf("<") !== -1) throw malformed(`'<' in an attribute value of <${qname}>.`);
      items.push(aname, normaliseAttr(raw));
      p = close + 1;
    }
    this.rootSeen = true;
    const attrs = items.length ? new XmlAttrs(items) : EMPTY_ATTRS;
    if (!selfClosing) {
      this.stack.push(qname);
      if (this.stack.length > this.maxDepth) {
        throw new LimitError("LIMIT_EXCEEDED", `XML nesting is deeper than maxXmlDepth (${this.maxDepth}).`, {
          details: { limit: "maxXmlDepth", value: this.stack.length, max: this.maxDepth },
        });
      }
    } else if (this.stack.length === 0) {
      this.rootClosed = true;
    }
    this.handler.open(localName(qname), attrs, selfClosing);
  }
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

export function localName(qname: string): string {
  const colon = qname.indexOf(":");
  return colon === -1 ? qname : qname.slice(colon + 1);
}

/** Index of the '>' that ends the tag starting before `from`, skipping quoted values; -1 if not in `buf`. */
function findTagEnd(buf: string, from: number): number {
  let quote = 0;
  for (let i = from; i < buf.length; i++) {
    const c = buf.charCodeAt(i);
    if (quote !== 0) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 62 /* > */) return i;
    else if (c === 60 /* < */) throw malformed("'<' inside a tag.");
  }
  return -1;
}

function normaliseNewlines(s: string): string {
  return s.indexOf("\r") === -1 ? s : s.replace(/\r\n?/g, "\n");
}

/** Attribute-value normalisation (XML 1.0 §3.3.3): literal TAB, CR, LF become spaces; references are decoded after. */
function normaliseAttr(raw: string): string {
  let s = raw;
  if (/[\t\n\r]/.test(s)) s = s.replace(/\r\n|[\t\n\r]/g, " ");
  return s.indexOf("&") === -1 ? s : decodeReferences(s);
}

/** Decodes the five predefined entities and numeric character references. */
export function decodeReferences(s: string): string {
  let out = "";
  let last = 0;
  for (let i = s.indexOf("&"); i !== -1; i = s.indexOf("&", last)) {
    const semi = s.indexOf(";", i + 1);
    if (semi === -1 || semi - i > 12) throw malformed("Unterminated character or entity reference.");
    const ref = s.slice(i + 1, semi);
    let ch: string;
    switch (ref) {
      case "lt":
        ch = "<";
        break;
      case "gt":
        ch = ">";
        break;
      case "amp":
        ch = "&";
        break;
      case "quot":
        ch = '"';
        break;
      case "apos":
        ch = "'";
        break;
      default: {
        let cp: number;
        if (/^#x[0-9A-Fa-f]{1,6}$/.test(ref)) cp = parseInt(ref.slice(2), 16);
        else if (/^#[0-9]{1,7}$/.test(ref)) cp = parseInt(ref.slice(1), 10);
        else throw malformed(`Unknown entity &${ref}; (only the five predefined entities are allowed).`);
        if (!isXmlChar(cp)) throw malformed(`Character reference &${ref}; is not a valid XML character.`);
        ch = String.fromCodePoint(cp);
      }
    }
    out += s.slice(last, i) + ch;
    last = semi + 1;
  }
  return out + s.slice(last);
}

/** XML 1.0 Char production. */
function isXmlChar(cp: number): boolean {
  return cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
}
