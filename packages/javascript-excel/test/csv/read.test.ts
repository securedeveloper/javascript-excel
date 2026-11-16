/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { parseCsv, readCsv } from "../../src/csv";

const utf16le = (s: string, bom = true): Uint8Array => {
  const body = Buffer.from(s, "utf16le");
  return bom ? new Uint8Array([0xff, 0xfe, ...body]) : new Uint8Array(body);
};
const utf16be = (s: string): Uint8Array => {
  const le = Buffer.from(s, "utf16le");
  const be = new Uint8Array(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1]!;
    be[i + 1] = le[i]!;
  }
  return new Uint8Array([0xfe, 0xff, ...be]);
};

describe("readCsv decoding", () => {
  it("a string is parsed as is", async () => {
    expect((await readCsv("a,b\r\n1,2\r\n")).rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("UTF-8 bytes, with and without BOM; Uint8Array, ArrayBuffer, Buffer, Blob", async () => {
    const bytes = new TextEncoder().encode("é,漢\r\n");
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    for (const input of [bytes, bytes.buffer, Buffer.from(bytes), new Blob([bytes])]) {
      expect(await readCsv(input as Uint8Array)).toMatchObject({ rows: [["é", "漢"]], bom: false, warnings: [] });
    }
    expect(await readCsv(withBom)).toMatchObject({ rows: [["é", "漢"]], bom: true });
    expect(await readCsv(new Blob([withBom]))).toMatchObject({ rows: [["é", "漢"]], bom: true });
  });
  it("a Uint8Array view into a larger buffer reads only its bytes", async () => {
    const all = new TextEncoder().encode("XXa,bYY");
    expect((await readCsv(all.subarray(2, 5))).rows).toEqual([["a", "b"]]);
  });
  it("UTF-16LE and UTF-16BE BOMs win over the encoding option", async () => {
    expect(await readCsv(utf16le("a;b\r\n"), { encoding: "windows-1252" })).toMatchObject({ rows: [["a", "b"]], bom: true, delimiter: ";" });
    expect(await readCsv(utf16be("x,ü\n"))).toMatchObject({ rows: [["x", "ü"]], bom: true });
  });
  it("the encoding option applies without a BOM", async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x2c, 0x80]); // "café,€" in windows-1252
    expect((await readCsv(latin1, { encoding: "windows-1252" })).rows).toEqual([["café", "€"]]);
    expect((await readCsv(utf16le("a,b", false), { encoding: "utf-16le" })).rows).toEqual([["a", "b"]]);
  });
  it("invalid UTF-8 becomes U+FFFD with CSV_INVALID_ENCODING; strict mode throws", async () => {
    const bad = new Uint8Array([0x61, 0x2c, 0xff, 0x62]);
    const r = await readCsv(bad);
    expect(r.rows).toEqual([["a", "�b"]]);
    expect(r.warnings.map((w) => w.code)).toEqual(["CSV_INVALID_ENCODING"]);
    await expect(readCsv(bad, { mode: "strict" })).rejects.toMatchObject({ code: "CSV_MALFORMED", details: { warning: "CSV_INVALID_ENCODING" } });
  });
  it("an unknown encoding label is a TypeError", async () => {
    await expect(readCsv(new Uint8Array([0x61]), { encoding: "no-such-encoding" })).rejects.toThrow(TypeError);
  });
  it("rejects input of the wrong type", async () => {
    await expect(readCsv(42 as unknown as string)).rejects.toThrow(TypeError);
    expect(() => parseCsv(new Uint8Array() as unknown as string)).toThrow(TypeError);
  });
});

describe("readCsv is async and cancellable", () => {
  const big = "id,name,amount\r\n" + Array.from({ length: 200_000 }, (_, i) => `${i},name ${i},${i * 1.5}`).join("\r\n") + "\r\n";

  it("gives the same result as parseCsv on a multi-chunk input", { timeout: 60_000 }, async () => {
    expect(big.length).toBeGreaterThan(3 * 1_048_576);
    const a = await readCsv(big, { inferTypes: true });
    const b = parseCsv(big, { inferTypes: true });
    expect(a.rows.length).toBe(200_001);
    expect(a).toEqual(b);
  });
  it("yields to the event loop between chunks", { timeout: 60_000 }, async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    await readCsv(big);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });
  it("an already-aborted signal rejects with its reason", async () => {
    const ac = new AbortController();
    const reason = new Error("stop");
    ac.abort(reason);
    await expect(readCsv("a", { signal: ac.signal })).rejects.toBe(reason);
  });
  it("aborting mid-parse rejects with the default AbortError", { timeout: 60_000 }, async () => {
    const ac = new AbortController();
    const p = readCsv(big, { signal: ac.signal });
    setTimeout(() => ac.abort(), 0);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});
