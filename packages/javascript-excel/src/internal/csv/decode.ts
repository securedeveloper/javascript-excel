/**
 * Bytes -> text for readCsv (docs/api.md §5.3): a UTF-8, UTF-16LE or UTF-16BE
 * BOM wins; otherwise the `encoding` label applies (default utf-8). Invalid
 * bytes become U+FFFD and the caller adds a CSV_INVALID_ENCODING warning.
 */

import { EnvironmentError } from "../../errors";

interface TextDecoderLike {
  decode(input: Uint8Array): string;
}
type TextDecoderCtor = new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }) => TextDecoderLike;

export interface Decoded {
  text: string;
  bom: boolean;
  encoding: string;
  invalid: boolean;
}

export function decodeBytes(bytes: Uint8Array, label: string): Decoded {
  const Ctor = (globalThis as unknown as { TextDecoder?: TextDecoderCtor }).TextDecoder;
  if (typeof Ctor !== "function") {
    throw new EnvironmentError("ENVIRONMENT_UNSUPPORTED", "TextDecoder is not available in this runtime.", { details: { api: "TextDecoder" } });
  }
  let encoding = label;
  let body = bytes;
  let bom = false;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = "utf-8";
    body = bytes.subarray(3);
    bom = true;
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    body = bytes.subarray(2);
    bom = true;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    body = bytes.subarray(2);
    bom = true;
  }
  let strict: TextDecoderLike;
  try {
    strict = new Ctor(encoding, { fatal: true, ignoreBOM: true });
  } catch {
    throw new TypeError(`encoding ${JSON.stringify(label)} is not supported by this runtime's TextDecoder`);
  }
  try {
    return { text: strict.decode(body), bom, encoding, invalid: false };
  } catch {
    const loose = new Ctor(encoding, { fatal: false, ignoreBOM: true });
    return { text: loose.decode(body), bom, encoding, invalid: true };
  }
}
