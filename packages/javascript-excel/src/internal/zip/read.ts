/**
 * Zip container reader (docs/api.md §6, §8). Internal.
 *
 * `openZip` parses the central directory synchronously and validates the whole
 * layout before any data is inflated:
 * - end-of-central-directory record, with zip64 records when present;
 * - single-disk archives only;
 * - every entry's local header must agree with its central record;
 * - entry data must not overlap other entries or the central directory;
 * - duplicate names, encryption and methods other than 0 and 8 are rejected.
 *
 * Reading an entry counts the actual decompressed bytes against the limits
 * (never trusting declared sizes), stops when an entry produces more than it
 * declared, and verifies its CRC-32.
 */

import { FormatError, LimitError } from "../../errors";
import { decodeUtf8Strict } from "../platform";
import { concatBytes, throwIfAborted, type SignalLike } from "./bytes";
import { nativeCodec, type ZipCodec } from "./codec";
import { crc32 } from "./crc32";
import { fromDosDateTime } from "./dos-time";

export interface ZipReadLimits {
  maxInputBytes: number;
  maxEntries: number;
  /** Decompressed bytes of one entry. */
  maxEntryBytes: number;
  /** Decompressed bytes of all entries read from this archive. */
  maxTotalBytes: number;
  /** Decompressed / compressed, per entry. */
  maxRatio: number;
}

/** The zip-related defaults of docs/api.md §5.2. All are [placeholder, set in JSE-6]. */
export const DEFAULT_ZIP_LIMITS: Readonly<ZipReadLimits> = Object.freeze({
  maxInputBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxRatio: 100,
});

export interface ZipEntryInfo {
  readonly name: string;
  readonly method: 0 | 8;
  readonly flags: number;
  readonly crc32: number;
  readonly compressedSize: number;
  /** Declared uncompressed size. Reading fails if the data does not match it. */
  readonly size: number;
  readonly modified: Date;
  /** Offset of the entry's data (after the local header). */
  readonly dataOffset: number;
}

export interface ZipReader {
  /** Entries in central-directory order. */
  readonly entries: readonly ZipEntryInfo[];
  get(name: string): ZipEntryInfo | undefined;
  /** Reads a whole entry. */
  read(entry: ZipEntryInfo | string, signal?: SignalLike): Promise<Uint8Array>;
  /** Streams an entry. The CRC is checked after the last chunk, so consumers must not act on data before the stream ends. */
  stream(entry: ZipEntryInfo | string, signal?: SignalLike): AsyncIterable<Uint8Array>;
  /** Decompressed bytes counted against maxTotalBytes so far. */
  readonly totalBytesRead: number;
}

export interface OpenZipOptions {
  limits?: Partial<ZipReadLimits>;
  codec?: ZipCodec;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const EXTRA_ZIP64 = 0x0001;
const EXTRA_UNICODE_PATH = 0x7075;
const METHOD_AES = 99;

/** Code page 437, bytes 0x80..0xFF: the spec's default encoding for names without bit 11. */
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";

function invalid(message: string, details?: Record<string, unknown>): FormatError {
  return new FormatError("ZIP_INVALID", message, details ? { details } : undefined);
}

function limitError(limit: keyof ZipReadLimits, value: number, max: number, what: string): LimitError {
  return new LimitError("LIMIT_EXCEEDED", `${what} exceeds the ${limit} limit (${max}).`, {
    details: { limit, value, max },
  });
}

class Cursor {
  private readonly view: DataView;
  constructor(
    readonly bytes: Uint8Array,
    public pos: number,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  need(n: number): void {
    if (this.pos < 0 || this.pos + n > this.bytes.length) throw invalid("Unexpected end of zip data.");
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u64(): number {
    const lo = this.u32();
    const hi = this.u32();
    const v = hi * 0x1_0000_0000 + lo;
    if (!Number.isSafeInteger(v)) throw invalid("Zip64 value out of range.");
    return v;
  }
  take(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

function decodeName(raw: Uint8Array, flags: number, extra: Uint8Array): string {
  if (flags & FLAG_UTF8) {
    try {
      return decodeUtf8Strict(raw);
    } catch {
      throw invalid("Entry name is not valid UTF-8.");
    }
  }
  // Info-ZIP Unicode Path extra field: a UTF-8 name, valid if its CRC matches the header name.
  const unicode = findExtra(extra, EXTRA_UNICODE_PATH);
  if (unicode && unicode.length >= 5 && unicode[0] === 1) {
    const c = new Cursor(unicode, 1);
    if (c.u32() === crc32(raw)) {
      try {
        return decodeUtf8Strict(unicode.subarray(5));
      } catch {
        // fall back to the header name
      }
    }
  }
  let s = "";
  for (const b of raw) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return s;
}

function findExtra(extra: Uint8Array, id: number): Uint8Array | undefined {
  const c = new Cursor(extra, 0);
  while (c.pos + 4 <= extra.length) {
    const tag = c.u16();
    const len = c.u16();
    if (c.pos + len > extra.length) return undefined; // malformed trailing extra data is ignored
    const body = c.take(len);
    if (tag === id) return body;
  }
  return undefined;
}

function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const last = bytes.length - 22;
  const first = Math.max(0, last - 0xffff);
  for (let p = last; p >= first; p--) {
    if (view.getUint32(p, true) === SIG_EOCD) {
      const commentLength = view.getUint16(p + 20, true);
      if (p + 22 + commentLength <= bytes.length) return p;
    }
  }
  throw invalid("Not a zip file: no end-of-central-directory record.");
}

interface Span {
  start: number;
  end: number;
  name: string;
}

/** Parses and validates the archive layout. Does not inflate anything. */
export function openZip(bytes: Uint8Array, options: OpenZipOptions = {}): ZipReader {
  const limits: ZipReadLimits = { ...DEFAULT_ZIP_LIMITS, ...options.limits };
  const codec = options.codec ?? nativeCodec;
  if (bytes.length > limits.maxInputBytes) {
    throw limitError("maxInputBytes", bytes.length, limits.maxInputBytes, "Input size");
  }
  if (bytes.length < 22) throw invalid("Not a zip file: too short.");

  const eocdPos = findEocd(bytes);
  const e = new Cursor(bytes, eocdPos + 4);
  const disk = e.u16();
  const cdDisk = e.u16();
  const entriesOnDisk = e.u16();
  let entryCount = e.u16();
  let cdSize = e.u32();
  let cdOffset = e.u32();
  let cdLimit = eocdPos; // the central directory must end before this offset

  // Zip64: a locator directly before the EOCD record points to the zip64 EOCD record.
  if (eocdPos >= 20 && new Cursor(bytes, eocdPos - 20).u32() === SIG_ZIP64_LOCATOR) {
    const l = new Cursor(bytes, eocdPos - 16);
    const z64Disk = l.u32();
    const z64Pos = l.u64();
    const totalDisks = l.u32();
    if (z64Disk !== 0 || totalDisks > 1) throw invalid("Multi-disk zip archives are not supported.");
    if (z64Pos + 56 > eocdPos - 20) throw invalid("Zip64 end-of-central-directory record out of range.");
    const z = new Cursor(bytes, z64Pos);
    if (z.u32() !== SIG_ZIP64_EOCD) throw invalid("Bad zip64 end-of-central-directory signature.");
    z.u64(); // record size
    z.u16(); // version made by
    z.u16(); // version needed
    const z64ThisDisk = z.u32();
    const z64CdDisk = z.u32();
    z.u64(); // entries on this disk
    entryCount = z.u64();
    cdSize = z.u64();
    cdOffset = z.u64();
    if (z64ThisDisk !== 0 || z64CdDisk !== 0) throw invalid("Multi-disk zip archives are not supported.");
    cdLimit = z64Pos;
  } else {
    if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== entryCount) {
      throw invalid("Multi-disk zip archives are not supported.");
    }
    if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw invalid("Zip64 values without a zip64 end-of-central-directory locator.");
    }
  }

  if (entryCount > limits.maxEntries) throw limitError("maxEntries", entryCount, limits.maxEntries, "Entry count");
  if (cdOffset + cdSize > cdLimit) throw invalid("Central directory out of range.");
  if (entryCount * 46 > cdSize) throw invalid("Central directory too small for its entry count.");

  const entries: ZipEntryInfo[] = [];
  const byName = new Map<string, ZipEntryInfo>();
  const spans: Span[] = [];
  const c = new Cursor(bytes.subarray(0, cdOffset + cdSize), cdOffset);

  for (let i = 0; i < entryCount; i++) {
    if (c.u32() !== SIG_CENTRAL) throw invalid("Bad central directory signature.", { index: i });
    c.u16(); // version made by
    c.u16(); // version needed
    const flags = c.u16();
    const method = c.u16();
    const time = c.u16();
    const date = c.u16();
    const crc = c.u32();
    let compressedSize = c.u32();
    let size = c.u32();
    const nameLength = c.u16();
    const extraLength = c.u16();
    const commentLength = c.u16();
    let diskStart = c.u16();
    c.u16(); // internal attributes
    c.u32(); // external attributes
    let localOffset = c.u32();
    const rawName = c.take(nameLength);
    const extra = c.take(extraLength);
    c.take(commentLength);

    // Zip64 extra field: only the fields saturated in the record are present, in this order.
    const z64 = findExtra(extra, EXTRA_ZIP64);
    if (z64) {
      const x = new Cursor(z64, 0);
      if (size === 0xffffffff) size = x.u64();
      if (compressedSize === 0xffffffff) compressedSize = x.u64();
      if (localOffset === 0xffffffff) localOffset = x.u64();
      if (diskStart === 0xffff) diskStart = x.u32();
    }
    if (diskStart !== 0) throw invalid("Multi-disk zip archives are not supported.");

    const name = decodeName(rawName, flags, extra);
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION) || method === METHOD_AES) {
      throw new FormatError("ZIP_ENCRYPTED", `Entry ${name} is encrypted.`, { details: { entry: name } });
    }
    if (method !== 0 && method !== 8) {
      throw new FormatError("ZIP_UNSUPPORTED_METHOD", `Entry ${name} uses compression method ${method}.`, {
        details: { entry: name, method },
      });
    }
    if (method === 0 && compressedSize !== size) throw invalid(`Stored entry ${name} has mismatched sizes.`);
    if (byName.has(name)) throw invalid(`Duplicate entry name: ${name}`, { entry: name });

    // The local header must agree with the central record.
    const l = new Cursor(bytes, localOffset);
    if (localOffset + 30 > cdOffset || l.u32() !== SIG_LOCAL) {
      throw invalid(`Bad local header for ${name}.`, { entry: name });
    }
    l.u16(); // version needed
    const lFlags = l.u16();
    const lMethod = l.u16();
    l.u16(); // time
    l.u16(); // date
    const lCrc = l.u32();
    const lCompressed = l.u32();
    const lSize = l.u32();
    const lNameLength = l.u16();
    const lExtraLength = l.u16();
    const lName = l.take(lNameLength);
    l.take(lExtraLength);
    const sameName = lNameLength === nameLength && lName.every((b, k) => b === rawName[k]);
    let agrees = sameName && lMethod === method && (lFlags & FLAG_ENCRYPTED) === 0;
    if (agrees && !(lFlags & FLAG_DATA_DESCRIPTOR)) {
      // With a data descriptor the local CRC and sizes may be zero; otherwise they must match
      // (0xFFFFFFFF in a zip64 local header defers to its extra field, which the central record already covers).
      agrees =
        lCrc === crc &&
        (lCompressed === compressedSize || lCompressed === 0xffffffff) &&
        (lSize === size || lSize === 0xffffffff);
    }
    if (!agrees) throw invalid(`Local header disagrees with the central directory for ${name}.`, { entry: name });

    const dataOffset = l.pos;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > cdOffset) throw invalid(`Data of ${name} runs into the central directory.`, { entry: name });
    spans.push({ start: localOffset, end: dataEnd, name });

    const info: ZipEntryInfo = Object.freeze({
      name,
      method,
      flags,
      crc32: crc,
      compressedSize,
      size,
      modified: fromDosDateTime(date, time),
      dataOffset,
    });
    entries.push(info);
    byName.set(name, info);
  }

  // Overlapping entries are how "overlapping file" zip bombs multiply their output.
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i]!.start < spans[i - 1]!.end) {
      throw invalid(`Entries ${spans[i - 1]!.name} and ${spans[i]!.name} overlap.`);
    }
  }

  let totalBytesRead = 0;

  const resolve = (entry: ZipEntryInfo | string): ZipEntryInfo => {
    const info = typeof entry === "string" ? byName.get(entry) : entry;
    if (!info || byName.get(info.name) !== info) {
      throw new Error(`No such zip entry: ${typeof entry === "string" ? entry : entry.name}`);
    }
    return info;
  };

  const countTotal = (n: number): void => {
    totalBytesRead += n;
    if (totalBytesRead > limits.maxTotalBytes) {
      throw limitError("maxTotalBytes", totalBytesRead, limits.maxTotalBytes, "Total decompressed size");
    }
  };

  async function* stream(entry: ZipEntryInfo | string, signal?: SignalLike): AsyncGenerator<Uint8Array> {
    const info = resolve(entry);
    throwIfAborted(signal);
    if (info.size > limits.maxEntryBytes) {
      throw limitError("maxEntryBytes", info.size, limits.maxEntryBytes, `Entry ${info.name}`);
    }
    const data = bytes.subarray(info.dataOffset, info.dataOffset + info.compressedSize);
    let crc = 0;
    let produced = 0;
    if (info.method === 0) {
      countTotal(data.length);
      crc = crc32(data);
      produced = data.length;
      if (crc !== info.crc32) throw crcMismatch(info);
      yield data;
      return;
    }
    const chunks = codec.inflateRaw(
      data,
      { maxOutputBytes: limits.maxEntryBytes, maxRatio: limits.maxRatio },
      signal,
    );
    for await (const chunk of chunks) {
      produced += chunk.length;
      if (produced > info.size) throw invalid(`Entry ${info.name} is larger than declared.`, { entry: info.name });
      countTotal(chunk.length);
      crc = crc32(chunk, crc);
      yield chunk;
    }
    if (produced !== info.size) throw invalid(`Entry ${info.name} is smaller than declared.`, { entry: info.name });
    if (crc !== info.crc32) throw crcMismatch(info);
  }

  return {
    entries,
    get: (name) => byName.get(name),
    stream,
    async read(entry, signal) {
      const parts: Uint8Array[] = [];
      for await (const chunk of stream(entry, signal)) parts.push(chunk);
      return concatBytes(parts);
    },
    get totalBytesRead() {
      return totalBytesRead;
    },
  };
}

function crcMismatch(info: ZipEntryInfo): FormatError {
  return new FormatError("ZIP_CRC_MISMATCH", `CRC-32 mismatch in ${info.name}.`, { details: { entry: info.name } });
}
