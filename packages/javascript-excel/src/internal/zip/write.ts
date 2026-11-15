/**
 * Zip container writer (docs/api.md §6). Internal.
 *
 * - Methods 8 (deflate) and 0 (store). With 'deflate', an entry whose
 *   compressed form would not be smaller is stored instead, when its input is
 *   small enough to have been kept (STORE_FALLBACK_MAX bytes).
 * - CRC-32 and sizes are computed before the headers are written, so no data
 *   descriptors are used (general-purpose bit 3 is never set).
 * - Names are UTF-8; bit 11 is set when a name is not plain ASCII.
 * - No zip64: more than 65,534 entries, or a size or offset that does not fit
 *   in 32 bits, throws ZIP64_REQUIRED.
 * - Deterministic: the same entries and dates give the same bytes.
 */

import { ValidationError } from "../../errors";
import { encodeUtf8 } from "../platform";
import { ByteWriter, concatBytes, throwIfAborted, type SignalLike } from "./bytes";
import { nativeCodec, type ChunkSource, type ZipCodec } from "./codec";
import { crc32 } from "./crc32";
import { toDosDateTime } from "./dos-time";

export interface ZipWriteEntry {
  /** Entry name, '/'-separated, no leading '/'. */
  name: string;
  /** Bytes, a string (written as UTF-8), or chunks in order. */
  data: Uint8Array | string | ChunkSource;
  /** Overrides ZipWriteOptions.compression for this entry. */
  compression?: "deflate" | "store";
  /** Overrides ZipWriteOptions.modified for this entry. */
  modified?: Date;
}

export interface ZipWriteOptions {
  /** Default 'deflate'. */
  compression?: "deflate" | "store";
  /** Timestamp for entries without their own. Default: now. */
  modified?: Date;
  codec?: ZipCodec;
  signal?: SignalLike;
}

/** Inputs up to this size are kept so a deflated entry can fall back to store. */
export const STORE_FALLBACK_MAX: number = 64 * 1024;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const MAX_U32 = 0xffffffff;
const MAX_ENTRIES = 0xfffe; // 0xFFFF is the zip64 sentinel

interface Written {
  nameBytes: Uint8Array;
  flags: number;
  method: 0 | 8;
  crc: number;
  size: number;
  data: Uint8Array;
  time: number;
  date: number;
  offset: number;
}

function zip64Required(what: string): ValidationError {
  return new ValidationError("ZIP64_REQUIRED", `The archive needs zip64 (${what}), which the writer does not produce.`);
}

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return false;
  return true;
}

function toChunks(data: ZipWriteEntry["data"]): ChunkSource {
  if (typeof data === "string") return [encodeUtf8(data)];
  if (data instanceof Uint8Array) return [data];
  return data;
}

/** Writes the entries, in order, into one zip archive. */
export async function writeZip(
  entries: Iterable<ZipWriteEntry> | AsyncIterable<ZipWriteEntry>,
  options: ZipWriteOptions = {},
): Promise<Uint8Array> {
  const codec = options.codec ?? nativeCodec;
  const defaultModified = options.modified ?? new Date();
  const seen = new Set<string>();
  const written: Written[] = [];
  let offset = 0;

  for await (const entry of entries) {
    throwIfAborted(options.signal);
    const { name } = entry;
    if (name.length === 0 || name.startsWith("/") || name.includes("\0") || name.includes("\\")) {
      throw new Error(`Invalid zip entry name: ${JSON.stringify(name)}`);
    }
    if (seen.has(name)) throw new Error(`Duplicate zip entry name: ${name}`);
    seen.add(name);
    if (written.length >= MAX_ENTRIES) throw zip64Required("more than 65,534 entries");

    const nameBytes = encodeUtf8(name);
    if (nameBytes.length > 0xffff) throw new Error(`Zip entry name too long: ${name.slice(0, 40)}...`);

    // Tap the chunks to compute size and CRC as they pass to the compressor.
    let size = 0;
    let crc = 0;
    let kept: Uint8Array[] | undefined = [];
    async function* tap(src: ChunkSource): AsyncGenerator<Uint8Array> {
      for await (const chunk of src) {
        size += chunk.length;
        if (size > MAX_U32 - 1) throw zip64Required(`entry ${name} over 4 GiB`);
        crc = crc32(chunk, crc);
        if (kept) {
          if (size <= STORE_FALLBACK_MAX) kept.push(chunk);
          else kept = undefined;
        }
        yield chunk;
      }
    }

    const compression = entry.compression ?? options.compression ?? "deflate";
    let method: 0 | 8;
    let data: Uint8Array;
    if (compression === "store") {
      const parts: Uint8Array[] = [];
      for await (const chunk of tap(toChunks(entry.data))) parts.push(chunk);
      method = 0;
      data = concatBytes(parts);
    } else {
      const deflated = await codec.deflateRaw(tap(toChunks(entry.data)), options.signal);
      if (kept && deflated.length >= size) {
        method = 0;
        data = concatBytes(kept);
      } else {
        method = 8;
        data = deflated;
      }
    }

    const { time, date } = toDosDateTime(entry.modified ?? defaultModified);
    const flags = isAscii(name) ? 0 : FLAG_UTF8;
    written.push({ nameBytes, flags, method, crc, size, data, time, date, offset });
    offset += 30 + nameBytes.length + data.length;
    if (offset > MAX_U32 - 1) throw zip64Required("archive over 4 GiB");
  }

  const parts: Uint8Array[] = [];
  for (const w of written) {
    const h = new ByteWriter(30 + w.nameBytes.length);
    h.u32(SIG_LOCAL);
    h.u16(w.method === 8 ? 20 : 10); // version needed to extract
    h.u16(w.flags);
    h.u16(w.method);
    h.u16(w.time);
    h.u16(w.date);
    h.u32(w.crc);
    h.u32(w.data.length);
    h.u32(w.size);
    h.u16(w.nameBytes.length);
    h.u16(0); // extra field length
    h.raw(w.nameBytes);
    parts.push(h.bytes, w.data);
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const w of written) {
    const c = new ByteWriter(46 + w.nameBytes.length);
    c.u32(SIG_CENTRAL);
    c.u16(20); // version made by: MS-DOS host, spec 2.0
    c.u16(w.method === 8 ? 20 : 10);
    c.u16(w.flags);
    c.u16(w.method);
    c.u16(w.time);
    c.u16(w.date);
    c.u32(w.crc);
    c.u32(w.data.length);
    c.u32(w.size);
    c.u16(w.nameBytes.length);
    c.u16(0); // extra field length
    c.u16(0); // comment length
    c.u16(0); // disk number start
    c.u16(0); // internal attributes
    c.u32(0); // external attributes
    c.u32(w.offset);
    c.raw(w.nameBytes);
    parts.push(c.bytes);
    cdSize += c.bytes.length;
  }
  if (cdOffset + cdSize > MAX_U32 - 1) throw zip64Required("archive over 4 GiB");

  const e = new ByteWriter(22);
  e.u32(SIG_EOCD);
  e.u16(0); // this disk
  e.u16(0); // disk with central directory
  e.u16(written.length);
  e.u16(written.length);
  e.u32(cdSize);
  e.u32(cdOffset);
  e.u16(0); // comment length
  parts.push(e.bytes);

  return concatBytes(parts);
}
