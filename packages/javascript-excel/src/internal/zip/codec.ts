/**
 * ZipCodec: raw DEFLATE (RFC 1951) compression for the zip container
 * (docs/api.md §6). Internal; not exported from any entry point.
 *
 * The default codec uses the platform's CompressionStream /
 * DecompressionStream with the 'deflate-raw' format, so there are no runtime
 * dependencies and every call is asynchronous.
 */

import { FormatError, LimitError } from "../../errors";
import { createStream } from "../platform";
import { concatBytes, throwIfAborted, type SignalLike } from "./bytes";

export interface InflateLimits {
  /** Stop with LIMIT_EXCEEDED (limit `maxEntryBytes`) once more than this many bytes are produced. */
  maxOutputBytes: number;
  /** Stop with LIMIT_EXCEEDED (limit `maxRatio`) once output / input exceeds this, after RATIO_CHECK_FLOOR bytes. */
  maxRatio: number;
}

export type ChunkSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

export interface ZipCodec {
  /** Compresses the chunks, in order, into one raw DEFLATE stream. Chunks must not be mutated afterwards. */
  deflateRaw(chunks: ChunkSource, signal?: SignalLike): Promise<Uint8Array>;
  /** Decompresses one raw DEFLATE stream, yielding output as it is produced and enforcing `limits`. */
  inflateRaw(data: Uint8Array, limits: InflateLimits, signal?: SignalLike): AsyncIterable<Uint8Array>;
}

/**
 * The ratio check starts only after this many output bytes, so small, highly
 * compressible parts (a sheet of identical cells) are not flagged.
 * [placeholder, set in JSE-6]
 */
export const RATIO_CHECK_FLOOR: number = 1024 * 1024;

const ignore = (): void => {};

async function deflateRaw(chunks: ChunkSource, signal?: SignalLike): Promise<Uint8Array> {
  throwIfAborted(signal);
  const stream = createStream("compress");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const out: Uint8Array[] = [];
  // Read concurrently with writing, or backpressure can stall the writer.
  const reading = (async () => {
    for (;;) {
      const r = await reader.read();
      if (r.done) return;
      if (r.value) out.push(r.value);
    }
  })();
  try {
    for await (const chunk of chunks) {
      throwIfAborted(signal);
      if (chunk.length > 0) await writer.write(chunk);
    }
    throwIfAborted(signal);
    await writer.close();
    await reading;
  } catch (err) {
    writer.abort(err).catch(ignore);
    reader.cancel(err).catch(ignore);
    await reading.catch(ignore);
    throw err;
  }
  return concatBytes(out);
}

async function* inflateRaw(data: Uint8Array, limits: InflateLimits, signal?: SignalLike): AsyncGenerator<Uint8Array> {
  throwIfAborted(signal);
  const stream = createStream("decompress");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  // Not awaited before reading: the output must be drained while input is consumed.
  const writing = writer.write(data).then(() => writer.close());
  writing.catch(ignore); // a write failure also errors the readable side, which is where it is reported
  let produced = 0;
  let finished = false;
  try {
    for (;;) {
      throwIfAborted(signal);
      let r;
      try {
        r = await reader.read();
      } catch (cause) {
        throw new FormatError("ZIP_INVALID", "Invalid or truncated DEFLATE data.", { cause });
      }
      if (r.done) break;
      const chunk = r.value;
      if (!chunk || chunk.length === 0) continue;
      produced += chunk.length;
      if (produced > limits.maxOutputBytes) {
        throw new LimitError("LIMIT_EXCEEDED", `Decompressed entry exceeds ${limits.maxOutputBytes} bytes.`, {
          details: { limit: "maxEntryBytes", value: produced, max: limits.maxOutputBytes },
        });
      }
      if (produced > RATIO_CHECK_FLOOR && produced / Math.max(1, data.length) > limits.maxRatio) {
        throw new LimitError("LIMIT_EXCEEDED", `Compression ratio exceeds ${limits.maxRatio}.`, {
          details: { limit: "maxRatio", value: produced / Math.max(1, data.length), max: limits.maxRatio },
        });
      }
      yield chunk;
    }
    try {
      await writing;
    } catch (cause) {
      throw new FormatError("ZIP_INVALID", "Invalid or truncated DEFLATE data.", { cause });
    }
    finished = true;
  } finally {
    if (!finished) {
      reader.cancel().catch(ignore);
      writer.abort().catch(ignore);
    }
  }
}

/** The default codec: native CompressionStream / DecompressionStream('deflate-raw'). */
export const nativeCodec: ZipCodec = { deflateRaw, inflateRaw };
