/**
 * Minimal structural types for the web platform APIs the engine uses.
 *
 * The package compiles against `lib: ES2022` with no DOM or Node types, so the
 * published declarations never depend on a consumer's `lib` setting. These
 * interfaces describe only the members the engine calls. They are internal and
 * never appear in a public signature.
 */

import { EnvironmentError } from "../errors";

export interface ReadResultLike<T> {
  done: boolean;
  value?: T | undefined;
}

export interface ReaderLike<T> {
  read(): Promise<ReadResultLike<T>>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

export interface WriterLike<T> {
  write(chunk: T): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
  readonly ready: Promise<undefined | void>;
}

export interface TransformStreamLike {
  readonly readable: { getReader(): ReaderLike<Uint8Array> };
  readonly writable: { getWriter(): WriterLike<Uint8Array> };
}

type CompressionFormat = "deflate-raw";
type StreamCtor = new (format: CompressionFormat) => TransformStreamLike;

interface TextEncoderLike {
  encode(input: string): Uint8Array;
}
interface TextDecoderLike {
  decode(input: Uint8Array): string;
}

interface PlatformGlobals {
  CompressionStream?: StreamCtor;
  DecompressionStream?: StreamCtor;
  TextEncoder?: new () => TextEncoderLike;
  TextDecoder?: new (label?: string, options?: { fatal?: boolean }) => TextDecoderLike;
}

const g = globalThis as unknown as PlatformGlobals;

function missing(api: string): EnvironmentError {
  return new EnvironmentError(
    "ENVIRONMENT_UNSUPPORTED",
    `${api} is not available in this runtime. javascript-excel needs Node.js 22 or later, or a browser with CompressionStream('deflate-raw') support.`,
    { details: { api } },
  );
}

/** Creates a raw-DEFLATE compression or decompression stream, or throws ENVIRONMENT_UNSUPPORTED. */
export function createStream(kind: "compress" | "decompress"): TransformStreamLike {
  const name = kind === "compress" ? "CompressionStream" : "DecompressionStream";
  const Ctor = kind === "compress" ? g.CompressionStream : g.DecompressionStream;
  if (typeof Ctor !== "function") throw missing(name);
  try {
    return new Ctor("deflate-raw");
  } catch (cause) {
    // Runtimes that have the class but not the 'deflate-raw' format throw a TypeError here.
    const err = missing(`${name}('deflate-raw')`);
    (err as { cause?: unknown }).cause = cause;
    throw err;
  }
}

let encoder: TextEncoderLike | undefined;
let strictDecoder: TextDecoderLike | undefined;

export function encodeUtf8(text: string): Uint8Array {
  if (!encoder) {
    if (typeof g.TextEncoder !== "function") throw missing("TextEncoder");
    encoder = new g.TextEncoder();
  }
  return encoder.encode(text);
}

/** Decodes UTF-8 and throws a TypeError on invalid bytes. */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  if (!strictDecoder) {
    if (typeof g.TextDecoder !== "function") throw missing("TextDecoder");
    strictDecoder = new g.TextDecoder("utf-8", { fatal: true });
  }
  return strictDecoder.decode(bytes);
}
