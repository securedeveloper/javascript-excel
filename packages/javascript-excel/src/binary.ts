/**
 * Binary input and Blob types shared by the reader and the CSV entry.
 *
 * The package compiles without DOM types, so `Blob` cannot be named directly
 * in a published signature. `BlobType` resolves to the platform's own `Blob`
 * whenever the consumer's TypeScript setup declares one (lib "dom", or
 * @types/node), and to the structural `BlobLike` otherwise.
 */

/** The members of `Blob` the library uses. */
export interface BlobLike {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The platform `Blob` type when the consumer has one, else `BlobLike`. */
export type BlobType = typeof globalThis extends { Blob: { prototype: infer B } } ? B : BlobLike;

/** Bytes the library can read. A Node `Buffer` is a `Uint8Array`. */
export type BinaryInput = Uint8Array | ArrayBuffer | BlobType;
