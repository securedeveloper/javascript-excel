/// <reference types="node" />
import { randomBytes } from "node:crypto";
import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { isExcelError } from "../../src/errors";
import { nativeCodec, RATIO_CHECK_FLOOR } from "../../src/internal/zip/codec";

const NO_LIMITS = { maxOutputBytes: Number.MAX_SAFE_INTEGER, maxRatio: Number.MAX_SAFE_INTEGER };

async function inflateAll(data: Uint8Array, limits = NO_LIMITS): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of nativeCodec.inflateRaw(data, limits)) parts.push(c);
  return Buffer.concat(parts);
}

const compressible = (n: number): Uint8Array => {
  const row = new TextEncoder().encode('<row r="1"><c r="A1" t="s"><v>42</v></c></row>');
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = row[i % row.length]!;
  return out;
};

describe("native deflate-raw codec", () => {
  it("runtime supports CompressionStream('deflate-raw') and DecompressionStream('deflate-raw')", () => {
    expect(() => new CompressionStream("deflate-raw")).not.toThrow();
    expect(() => new DecompressionStream("deflate-raw")).not.toThrow();
  });

  it.each([0, 1, 1000, 300_000])("our deflate output inflates with zlib (%i bytes)", async (n) => {
    for (const data of [compressible(n), randomBytes(n)]) {
      const deflated = await nativeCodec.deflateRaw([data]);
      expect(Buffer.compare(zlib.inflateRawSync(deflated), Buffer.from(data))).toBe(0);
    }
  });

  it.each([0, 1, 6, 9])("zlib deflateRaw level %i inflates with our codec", async (level) => {
    for (const data of [compressible(250_000), randomBytes(70_000), new Uint8Array(0)]) {
      const deflated = zlib.deflateRawSync(data, { level });
      expect(Buffer.compare(Buffer.from(await inflateAll(deflated)), Buffer.from(data))).toBe(0);
    }
  });

  it("accepts input as many chunks, sync or async", async () => {
    const data = compressible(200_000);
    const chunks = [data.subarray(0, 1), data.subarray(1, 70_000), data.subarray(70_000)];
    async function* gen(): AsyncGenerator<Uint8Array> {
      yield* chunks;
    }
    for (const src of [chunks, gen()]) {
      const deflated = await nativeCodec.deflateRaw(src);
      expect(Buffer.compare(zlib.inflateRawSync(deflated), Buffer.from(data))).toBe(0);
    }
  });

  it("rejects corrupt and truncated input with ZIP_INVALID", async () => {
    const good = zlib.deflateRawSync(compressible(100_000));
    for (const bad of [good.subarray(0, good.length >> 1), new Uint8Array([0xff, 0xff, 0xff, 0xff])]) {
      const err = await inflateAll(bad).catch((e: unknown) => e);
      expect(isExcelError(err) && err.code).toBe("ZIP_INVALID");
    }
  });

  it("stops at maxOutputBytes", async () => {
    const bomb = zlib.deflateRawSync(new Uint8Array(8 * 1024 * 1024));
    const err = await inflateAll(bomb, { maxOutputBytes: 1024 * 1024, maxRatio: Infinity }).catch((e: unknown) => e);
    expect(isExcelError(err) && err.code).toBe("LIMIT_EXCEEDED");
    expect(isExcelError(err) && err.details?.["limit"]).toBe("maxEntryBytes");
  });

  it("stops when the ratio limit is passed, but only after the floor", async () => {
    const zeros = new Uint8Array(RATIO_CHECK_FLOOR * 4);
    const bomb = zlib.deflateRawSync(zeros);
    const err = await inflateAll(bomb, { maxOutputBytes: Infinity, maxRatio: 100 }).catch((e: unknown) => e);
    expect(isExcelError(err) && err.details?.["limit"]).toBe("maxRatio");

    const small = zlib.deflateRawSync(new Uint8Array(RATIO_CHECK_FLOOR / 2)); // ratio far above 100, below the floor
    await expect(inflateAll(small, { maxOutputBytes: Infinity, maxRatio: 100 })).resolves.toHaveLength(
      RATIO_CHECK_FLOOR / 2,
    );
  });

  it("rejects with signal.reason when aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("stop"));
    await expect(nativeCodec.deflateRaw([compressible(10)], ac.signal)).rejects.toThrow("stop");
    await expect(inflateAll(zlib.deflateRawSync(compressible(10)), NO_LIMITS).then(() => "ok")).resolves.toBe("ok");
    const gen = nativeCodec.inflateRaw(zlib.deflateRawSync(compressible(10)), NO_LIMITS, ac.signal);
    await expect(gen[Symbol.asyncIterator]().next()).rejects.toThrow("stop");
  });
});
