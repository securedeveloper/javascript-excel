/**
 * CSV parser (RFC 4180, lenient by default). docs/api.md §5.3.
 *
 * A hand-written scanner: one pass over the string, no regular expressions on
 * the hot path, no recursion. The parser works one record at a time, so the
 * async API can stop between records to check an AbortSignal and yield.
 */

import { CsvError, LimitError } from "../../errors";
import type { CellValue } from "../../model";
import type { ExcelWarning, ExcelWarningCode } from "../../warnings";
import { cellRef } from "./ref";
import { inferValue } from "./infer";

export interface ParseConfig {
  delimiter: string | "auto";
  quote: string;
  inferTypes: boolean;
  skipEmptyLines: boolean;
  strict: boolean;
  maxRows: number;
  maxFieldBytes: number;
  dateZone: "local" | "utc";
}

export interface ParseOutput {
  rows: CellValue[][];
  delimiter: string;
  newline: "\r\n" | "\n" | "\r";
  bom: boolean;
  warnings: ExcelWarning[];
}

/** Default `maxFieldBytes`: 1 MiB of UTF-8 per field. */
export const DEFAULT_MAX_FIELD_BYTES = 1_048_576;
/** Warnings kept per parse; the rest are summarised by one WARNINGS_TRUNCATED. */
export const MAX_WARNINGS = 1000;

const CANDIDATES = [",", ";", "\t", "|"] as const;
const SNIFF_RECORDS = 20;
const SNIFF_CHARS = 65_536;

const LF = 10;
const CR = 13;

type Newline = "\r\n" | "\n" | "\r";

/** The resumable state of one parse. */
export class CsvParser {
  readonly rows: CellValue[][] = [];
  readonly warnings: ExcelWarning[] = [];
  readonly delimiter: string;
  readonly bom: boolean;
  newline: Newline | undefined;
  done = false;

  private readonly text: string;
  private readonly cfg: ParseConfig;
  private readonly delimCode: number;
  private readonly quoteCode: number;
  private pos: number;
  private line = 1;
  private expectedFields = -1;
  private dropped = 0;

  constructor(text: string, cfg: ParseConfig) {
    validateConfig(cfg);
    this.bom = text.charCodeAt(0) === 0xfeff;
    this.text = text;
    this.pos = this.bom ? 1 : 0;
    this.cfg = cfg;
    this.delimiter = cfg.delimiter === "auto" ? detectDelimiter(text, this.pos, cfg.quote) : cfg.delimiter;
    this.delimCode = this.delimiter.charCodeAt(0);
    this.quoteCode = cfg.quote.charCodeAt(0);
  }

  /** Characters consumed so far (for chunking). */
  get position(): number {
    return this.pos;
  }

  /** Parses records until `pos` passes `untilPos` or the input ends. */
  run(untilPos: number = Number.POSITIVE_INFINITY): void {
    const { text, cfg } = this;
    while (!this.done && this.pos < untilPos) {
      if (this.pos >= text.length) {
        this.finish();
        return;
      }
      const startLine = this.line;
      const fields = this.record();
      if (fields.length === 0 && cfg.skipEmptyLines) continue;
      if (this.rows.length >= cfg.maxRows) {
        this.warn("CSV_ROWS_TRUNCATED", `Stopped after maxRows (${cfg.maxRows}) rows; the rest of the input was not read.`, undefined, false);
        this.finish();
        return;
      }
      const rowIndex = this.rows.length;
      if (fields.length > 0) {
        if (this.expectedFields === -1) this.expectedFields = fields.length;
        else if (fields.length !== this.expectedFields) {
          this.warn(
            "CSV_FIELD_COUNT",
            `Row ${rowIndex + 1} (line ${startLine}) has ${fields.length} fields; the first row has ${this.expectedFields}.`,
            cellRef(rowIndex, 0),
          );
        }
      }
      this.rows.push(cfg.inferTypes ? fields.map((f) => (f.quoted ? f.text : inferValue(f.text, cfg.dateZone))) : fields.map((f) => f.text));
    }
  }

  private finish(): void {
    this.done = true;
    if (this.dropped > 0) {
      this.warnings.push({
        code: "WARNINGS_TRUNCATED",
        message: `${this.dropped} more warning(s) were not recorded (limit ${MAX_WARNINGS}).`,
      });
    }
  }

  /** Reads one record starting at `pos`. A blank line gives zero fields. */
  private record(): Array<{ text: string; quoted: boolean }> {
    const { text } = this;
    const len = text.length;
    const fields: Array<{ text: string; quoted: boolean }> = [];
    const first = text.charCodeAt(this.pos);
    if (first === LF || first === CR) {
      this.newlineAt(this.pos);
      return fields;
    }
    for (;;) {
      const col = fields.length;
      const row = this.rows.length;
      let value: string;
      let quoted = false;
      if (text.charCodeAt(this.pos) === this.quoteCode) {
        quoted = true;
        value = this.quotedField(row, col);
      } else {
        value = this.plainField(row, col);
      }
      this.checkSize(value, row, col);
      fields.push({ text: value, quoted });
      if (this.pos >= len) return fields;
      const c = text.charCodeAt(this.pos);
      if (c === this.delimCode) {
        this.pos++;
        if (this.pos >= len) {
          // Trailing delimiter at end of input: one more empty field.
          fields.push({ text: "", quoted: false });
          return fields;
        }
        continue;
      }
      // Newline (the field scanners stop only at delimiter, newline or end).
      this.newlineAt(this.pos);
      return fields;
    }
  }

  /** Consumes the newline at `i` and records the first style seen. */
  private newlineAt(i: number): void {
    const { text } = this;
    let nl: Newline;
    if (text.charCodeAt(i) === CR) {
      if (text.charCodeAt(i + 1) === LF) {
        nl = "\r\n";
        this.pos = i + 2;
      } else {
        nl = "\r";
        this.pos = i + 1;
      }
    } else {
      nl = "\n";
      this.pos = i + 1;
    }
    this.newline ??= nl;
    this.line++;
  }

  private plainField(row: number, col: number): string {
    const { text, delimCode, quoteCode } = this;
    const len = text.length;
    const start = this.pos;
    let i = start;
    let strayReported = false;
    for (; i < len; i++) {
      const c = text.charCodeAt(i);
      if (c === delimCode || c === LF || c === CR) break;
      if (c === quoteCode && !strayReported) {
        strayReported = true;
        this.warn("CSV_STRAY_QUOTE", `Quote character inside an unquoted field at row ${row + 1}, line ${this.line}; kept as text.`, cellRef(row, col));
      }
    }
    this.pos = i;
    return text.slice(start, i);
  }

  private quotedField(row: number, col: number): string {
    const { text, delimCode, quoteCode } = this;
    const len = text.length;
    const startLine = this.line;
    let i = this.pos + 1; // after the opening quote
    let out = "";
    let chunk = i;
    for (;;) {
      if (i >= len) {
        out += text.slice(chunk, i);
        this.pos = i;
        this.warn(
          "CSV_UNTERMINATED_QUOTE",
          `Quoted field at row ${row + 1}, line ${startLine} is not closed; it runs to the end of the input.`,
          cellRef(row, col),
        );
        return out;
      }
      const c = text.charCodeAt(i);
      if (c === quoteCode) {
        if (text.charCodeAt(i + 1) === quoteCode) {
          out += text.slice(chunk, i + 1); // keep one quote
          i += 2;
          chunk = i;
          continue;
        }
        out += text.slice(chunk, i);
        i++; // closing quote
        const next = i < len ? text.charCodeAt(i) : -1;
        if (next === -1 || next === delimCode || next === LF || next === CR) {
          this.pos = i;
          return out;
        }
        // Text after the closing quote: keep it, like Python's csv module.
        this.warn(
          "CSV_STRAY_QUOTE",
          `Text after the closing quote at row ${row + 1}, line ${this.line}; kept as part of the field.`,
          cellRef(row, col),
        );
        this.pos = i;
        return out + this.plainFieldNoWarn();
      }
      if (c === LF) this.line++;
      else if (c === CR && text.charCodeAt(i + 1) !== LF) this.line++;
      i++;
    }
  }

  private plainFieldNoWarn(): string {
    const { text, delimCode } = this;
    const len = text.length;
    const start = this.pos;
    let i = start;
    for (; i < len; i++) {
      const c = text.charCodeAt(i);
      if (c === delimCode || c === LF || c === CR) break;
    }
    this.pos = i;
    return text.slice(start, i);
  }

  private checkSize(value: string, row: number, col: number): void {
    const max = this.cfg.maxFieldBytes;
    if (value.length * 3 <= max) return; // a UTF-16 code unit is at most 3 UTF-8 bytes
    const bytes = utf8Length(value);
    if (bytes > max) {
      throw new LimitError("LIMIT_EXCEEDED", `Field at row ${row + 1} is ${bytes} bytes; maxFieldBytes is ${max}.`, {
        details: { limit: "maxFieldBytes", value: bytes, max, ref: cellRef(row, col) },
      });
    }
  }

  private warn(code: ExcelWarningCode, message: string, ref: string | undefined, malformed = true): void {
    if (this.cfg.strict && malformed) {
      throw new CsvError("CSV_MALFORMED", message, { details: { warning: code, ...(ref === undefined ? {} : { ref }), line: this.line } });
    }
    if (this.warnings.length >= MAX_WARNINGS) {
      this.dropped++;
      return;
    }
    this.warnings.push(ref === undefined ? { code, message } : { code, message, ref });
  }
}

/** UTF-8 length of a string without encoding it. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function validateConfig(cfg: ParseConfig): void {
  if (cfg.delimiter !== "auto") checkSeparator("delimiter", cfg.delimiter);
  checkSeparator("quote", cfg.quote);
  if (cfg.delimiter === cfg.quote) throw new TypeError("delimiter and quote must differ");
  if (!(cfg.maxRows >= 0)) throw new TypeError("maxRows must be a non-negative number");
  if (!(cfg.maxFieldBytes > 0)) throw new TypeError("maxFieldBytes must be a positive number");
}

/** A delimiter or quote: exactly one UTF-16 code unit, not CR or LF. */
export function checkSeparator(name: string, value: unknown): void {
  if (typeof value !== "string" || value.length !== 1 || value === "\r" || value === "\n") {
    throw new TypeError(`${name} must be a single character other than CR or LF, got ${JSON.stringify(value)}`);
  }
}

/**
 * Picks the delimiter from `, ; TAB |` by field-count consistency over the
 * first records: the candidate whose most common field count (> 1) covers the
 * most records wins; ties go to the earlier candidate. Falls back to ','.
 */
export function detectDelimiter(text: string, start: number, quote: string): string {
  const sample = text.slice(start, start + SNIFF_CHARS);
  let best: string = ",";
  let bestScore = 0;
  for (const d of CANDIDATES) {
    const counts = sniffCounts(sample, d, quote.charCodeAt(0));
    const freq = new Map<number, number>();
    for (const n of counts) if (n > 1) freq.set(n, (freq.get(n) ?? 0) + 1);
    let score = 0;
    for (const v of freq.values()) if (v > score) score = v;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Field counts of the first records, quote-aware. Blank lines are skipped. */
function sniffCounts(sample: string, delim: string, quoteCode: number): number[] {
  const delimCode = delim.charCodeAt(0);
  const counts: number[] = [];
  let fields = 1;
  let inQuotes = false;
  let empty = true;
  for (let i = 0; i < sample.length && counts.length < SNIFF_RECORDS; i++) {
    const c = sample.charCodeAt(i);
    if (inQuotes) {
      if (c === quoteCode) {
        if (sample.charCodeAt(i + 1) === quoteCode) i++;
        else inQuotes = false;
      }
      continue;
    }
    if (c === quoteCode) {
      inQuotes = true;
      empty = false;
    } else if (c === delimCode) {
      fields++;
      empty = false;
    } else if (c === LF || c === CR) {
      if (!empty) counts.push(fields);
      if (c === CR && sample.charCodeAt(i + 1) === LF) i++;
      fields = 1;
      empty = true;
    } else empty = false;
  }
  if (!empty && counts.length < SNIFF_RECORDS) counts.push(fields);
  return counts;
}
