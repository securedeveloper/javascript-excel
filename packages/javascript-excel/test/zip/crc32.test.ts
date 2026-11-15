/// <reference types="node" />
import { randomBytes } from "node:crypto";
import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32 } from "../../src/internal/zip/crc32";

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("crc32", () => {
  // Check values for CRC-32/ISO-HDLC (the zip CRC).
  it.each([
    ["", 0x00000000],
    ["a", 0xe8b7be43],
    ["abc", 0x352441c2],
    ["123456789", 0xcbf43926],
    ["message digest", 0x20159d7f],
    ["The quick brown fox jumps over the lazy dog", 0x414fa339],
  ])("crc32(%j) = %s", (input, expected) => {
    expect(crc32(ascii(input))).toBe(expected);
  });

  it("is unsigned for all-0xFF input", () => {
    const v = crc32(new Uint8Array(32).fill(0xff));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBe(0xff6cab0b);
  });

  it("continues across chunks of every split point", () => {
    const data = ascii("The quick brown fox jumps over the lazy dog");
    for (let i = 0; i <= data.length; i++) {
      expect(crc32(data.subarray(i), crc32(data.subarray(0, i)))).toBe(0x414fa339);
    }
  });

  // zlib.crc32 exists from Node 22.2; the vectors above cover older runtimes.
  it.skipIf(typeof zlib.crc32 !== "function")("matches node:zlib.crc32 on random data of many lengths", () => {
    for (const n of [1, 3, 4, 5, 7, 8, 255, 4096, 100_003]) {
      const data = randomBytes(n);
      expect(crc32(data)).toBe(zlib.crc32(data));
    }
  });

  it("works on a subarray with a non-zero byteOffset", () => {
    const buf = ascii("xx123456789yy");
    expect(crc32(buf.subarray(2, 11))).toBe(0xcbf43926);
  });
});
