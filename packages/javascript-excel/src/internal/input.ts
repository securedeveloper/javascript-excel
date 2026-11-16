/** Binary input normalisation shared by readCsv and read. Internal. */

import type { BinaryInput } from "../binary";

/** Uint8Array (Node Buffer included), ArrayBuffer, any ArrayBufferView, or a Blob -> Uint8Array. */
export async function toBytes(input: BinaryInput, fn: string, also = ""): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "object" && input !== null && typeof (input as { arrayBuffer?: unknown }).arrayBuffer === "function") {
    return new Uint8Array(await (input as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer());
  }
  if (ArrayBuffer.isView(input)) {
    const v = input as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  throw new TypeError(`${fn}: input must be ${also}a Uint8Array, ArrayBuffer or Blob`);
}
