/** Byte helpers shared by the zip writer and reader. */

/** The parts of AbortSignal the engine uses (AbortSignal is not in lib ES2022). */
export interface SignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

/** Rejects with `signal.reason`, the same as fetch. */
export function throwIfAborted(signal: SignalLike | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("The operation was aborted.");
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Little-endian writer into a fixed-size buffer. */
export class ByteWriter {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  pos = 0;

  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(v: number): void {
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }
  u32(v: number): void {
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }
  raw(b: Uint8Array): void {
    this.bytes.set(b, this.pos);
    this.pos += b.length;
  }
}
