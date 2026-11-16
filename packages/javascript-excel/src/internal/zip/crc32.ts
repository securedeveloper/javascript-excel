/**
 * CRC-32 as used by zip (ISO 3309 / ITU-T V.42): reflected polynomial
 * 0xEDB88320, initial value and final XOR 0xFFFFFFFF.
 *
 * Slicing-by-8 tables: 8 KiB, built lazily on first use so importing the
 * module costs nothing. Slicing-by-8 measured 1,150–1,270 MB/s against
 * 850–940 MB/s for slicing-by-4 on Node 24 (JSE-8).
 */

let tables: Uint32Array | undefined;

function buildTables(): Uint32Array {
  const t = new Uint32Array(8 * 256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  for (let n = 0; n < 256; n++) {
    let c = t[n]!;
    for (let k = 1; k < 8; k++) {
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
  for (const end = n - (n % 8); i < end; i += 8) {
    c ^= data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24);
    const hi = data[i + 4]! | (data[i + 5]! << 8) | (data[i + 6]! << 16) | (data[i + 7]! << 24);
    c =
      t[1792 + (c & 0xff)]! ^
      t[1536 + ((c >>> 8) & 0xff)]! ^
      t[1280 + ((c >>> 16) & 0xff)]! ^
      t[1024 + (c >>> 24)]! ^
      t[768 + (hi & 0xff)]! ^
      t[512 + ((hi >>> 8) & 0xff)]! ^
      t[256 + ((hi >>> 16) & 0xff)]! ^
      t[hi >>> 24]!;
  }
  for (; i < n; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}
