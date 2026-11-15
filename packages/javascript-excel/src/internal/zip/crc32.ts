/**
 * CRC-32 as used by zip (ISO 3309 / ITU-T V.42): reflected polynomial
 * 0xEDB88320, initial value and final XOR 0xFFFFFFFF.
 *
 * Slicing-by-4 tables: 4 KiB, built lazily on first use so importing the
 * module costs nothing.
 */

let tables: Uint32Array | undefined;

function buildTables(): Uint32Array {
  const t = new Uint32Array(4 * 256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  for (let n = 0; n < 256; n++) {
    let c = t[n]!;
    for (let k = 1; k < 4; k++) {
      c = t[c & 0xff]! ^ (c >>> 8);
      t[k * 256 + n] = c >>> 0;
    }
  }
  return t;
}

/**
 * Returns the CRC-32 of `data`. Pass the previous result as `crc` to continue
 * over several chunks: `crc32(b, crc32(a))` equals `crc32(a + b)`.
 */
export function crc32(data: Uint8Array, crc: number = 0): number {
  const t = (tables ??= buildTables());
  let c = ~crc >>> 0;
  const n = data.length;
  let i = 0;
  for (const end = n - (n % 4); i < end; i += 4) {
    c ^= data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24);
    c = t[768 + (c & 0xff)]! ^ t[512 + ((c >>> 8) & 0xff)]! ^ t[256 + ((c >>> 16) & 0xff)]! ^ t[c >>> 24]!;
  }
  for (; i < n; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}
