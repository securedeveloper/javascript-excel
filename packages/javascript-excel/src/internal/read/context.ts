/**
 * Per-read state shared by the part parsers: the zip, the limits, the
 * warning collector, the abort signal and progress reporting. Internal.
 */

import { FormatError, LimitError } from "../../errors";
import type { ExcelWarning, ExcelWarningCode } from "../../warnings";
import { throwIfAborted, type SignalLike } from "../zip/bytes";
import type { ZipEntryInfo, ZipReader } from "../zip/read";
import { XmlTokenizer, type XmlHandler } from "./xml-reader";
import { throttleProgress } from "../progress";

export interface ReaderLimits {
  maxXmlDepth: number;
  maxCells: number;
  maxSharedStrings: number;
  maxWarnings: number;
}

export interface ProgressInfo {
  phase: "prepare" | "styles" | "sheets" | "zip" | "unzip" | "parse";
  sheet?: string | undefined;
  ratio: number;
}

interface TextDecoderLike {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}
type TextDecoderCtor = new (label?: string, options?: { fatal?: boolean }) => TextDecoderLike;

export class ReadContext {
  readonly warnings: ExcelWarning[] = [];
  /** Names of the parts read so far (for keeping the others, see InternalReadOptions). */
  readonly consumed: Set<string> = new Set();
  private dropped = 0;
  cells = 0;

  constructor(
    readonly zip: ZipReader,
    readonly limits: ReaderLimits,
    readonly signal: SignalLike | undefined,
    private readonly onWarning: ((w: ExcelWarning) => void) | undefined,
    onProgress: ((p: ProgressInfo) => void) | undefined,
  ) {
    this.onProgress = throttleProgress(onProgress);
  }

  private readonly onProgress: ((p: ProgressInfo) => void) | undefined;

  warn(code: ExcelWarningCode, message: string, where?: { part?: string; sheet?: string; ref?: string }): void {
    if (this.warnings.length >= this.limits.maxWarnings) {
      if (this.dropped++ === 0) {
        const w: ExcelWarning = { code: "WARNINGS_TRUNCATED", message: `More than maxWarnings (${this.limits.maxWarnings}) warnings; later ones were dropped.` };
        this.warnings.push(w);
        this.onWarning?.(w);
      }
      return;
    }
    const w: ExcelWarning = { code, message };
    if (where?.part !== undefined) w.part = where.part;
    if (where?.sheet !== undefined) w.sheet = where.sheet;
    if (where?.ref !== undefined) w.ref = where.ref;
    this.warnings.push(w);
    this.onWarning?.(w);
  }

  /** Counts one cell against maxCells. */
  countCell(): void {
    if (++this.cells > this.limits.maxCells) {
      throw new LimitError("LIMIT_EXCEEDED", `The workbook has more than maxCells (${this.limits.maxCells}) cells.`, {
        details: { limit: "maxCells", value: this.cells, max: this.limits.maxCells },
      });
    }
  }

  checkAbort(): void {
    throwIfAborted(this.signal);
  }

  progress(p: ProgressInfo): void {
    this.onProgress?.(p);
  }

  /** Reads a whole part as text (for small parts: rels, content types, workbook). */
  async text(entry: ZipEntryInfo): Promise<string> {
    this.consumed.add(entry.name);
    const bytes = await this.zip.read(entry, this.signal);
    return newDecoder(bytes).decode(stripBom(bytes));
  }

  /**
   * Streams a part through the XML tokenizer. Errors from the tokenizer are
   * re-thrown with the part name in the message and `details.part`.
   */
  async parse(entry: ZipEntryInfo, handler: XmlHandler, onChunk?: (bytes: number) => void): Promise<void> {
    this.consumed.add(entry.name);
    const tok = new XmlTokenizer(handler, this.limits.maxXmlDepth);
    let decoder: TextDecoderLike | undefined;
    try {
      for await (const chunk of this.zip.stream(entry, this.signal)) {
        if (!decoder) {
          decoder = newDecoder(chunk);
          tok.feed(decoder.decode(stripBom(chunk), { stream: true }));
        } else tok.feed(decoder.decode(chunk, { stream: true }));
        onChunk?.(chunk.length);
        this.checkAbort();
      }
      if (decoder) tok.feed(decoder.decode());
      tok.end();
    } catch (err) {
      throw withPart(err, entry.name);
    }
  }
}

export function withPart(err: unknown, part: string): unknown {
  if (err instanceof FormatError && (err.code === "XML_MALFORMED" || err.code === "XML_DTD_FORBIDDEN") && !err.details?.["part"]) {
    return new FormatError(err.code, `${part}: ${err.message}`, { details: { ...err.details, part }, cause: err });
  }
  if (err instanceof LimitError && err.details?.["limit"] === "maxXmlDepth" && !err.details["part"]) {
    return new LimitError(err.code, `${part}: ${err.message}`, { details: { ...err.details, part }, cause: err });
  }
  return err;
}

function newDecoder(first: Uint8Array): TextDecoderLike {
  const Ctor = (globalThis as unknown as { TextDecoder: TextDecoderCtor }).TextDecoder;
  // OOXML parts are UTF-8 or UTF-16 (with a BOM).
  if (first[0] === 0xff && first[1] === 0xfe) return new Ctor("utf-16le");
  if (first[0] === 0xfe && first[1] === 0xff) return new Ctor("utf-16be");
  return new Ctor("utf-8");
}

function stripBom(b: Uint8Array): Uint8Array {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3);
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return b.subarray(2);
  return b;
}
