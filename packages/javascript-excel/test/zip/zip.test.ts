/// <reference types="node" />
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isExcelError } from "../../src/errors";
import { crc32 } from "../../src/internal/zip/crc32";
import { openZip, type ZipReadLimits } from "../../src/internal/zip/read";
import { STORE_FALLBACK_MAX, writeZip, type ZipWriteEntry } from "../../src/internal/zip/write";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const MODIFIED = new Date(Date.UTC(2024, 0, 15, 10, 30, 0));

async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<unknown> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return isExcelError(e) ? e.code : e;
  }
  return "no error";
}

async function readAll(zip: Uint8Array, limits?: Partial<ZipReadLimits>): Promise<Map<string, Uint8Array>> {
  const r = openZip(zip, limits ? { limits } : {});
  const out = new Map<string, Uint8Array>();
  for (const e of r.entries) out.set(e.name, await r.read(e));
  return out;
}

/** Offsets of every occurrence of a 4-byte little-endian signature. */
function findSig(zip: Uint8Array, sig: number): number[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: number[] = [];
  for (let i = 0; i + 4 <= zip.length; i++) if (v.getUint32(i, true) === sig) out.push(i);
  return out;
}
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

describe("zip writer + reader round trip", () => {
  const entries = (): ZipWriteEntry[] => [
    { name: "[Content_Types].xml", data: '<?xml version="1.0"?><Types/>' },
    { name: "xl/worksheets/sheet1.xml", data: "<row/>".repeat(50_000) },
    { name: "random.bin", data: randomBytes(100_000) },
    { name: "stored.txt", data: "stored", compression: "store" },
    { name: "empty.txt", data: "" },
    { name: "données/ü.xml", data: "été 漢字" },
    { name: "chunks.xml", data: [enc("<a>"), enc("b".repeat(10_000)), enc("</a>")] },
  ];

  it("reads back every entry byte for byte", async () => {
    const input = entries();
    const zip = await writeZip(input, { modified: MODIFIED });
    const back = await readAll(zip);
    expect([...back.keys()]).toEqual(input.map((e) => e.name));
    expect(dec(back.get("xl/worksheets/sheet1.xml")!)).toBe("<row/>".repeat(50_000));
    expect(Buffer.compare(Buffer.from(back.get("random.bin")!), Buffer.from(input[2]!.data as Uint8Array))).toBe(0);
    expect(dec(back.get("données/ü.xml")!)).toBe("été 漢字");
    expect(dec(back.get("chunks.xml")!)).toBe(`<a>${"b".repeat(10_000)}</a>`);
    expect(back.get("empty.txt")).toHaveLength(0);
  });

  it("deflates compressible data and stores data that does not compress", async () => {
    const zip = await writeZip(entries(), { modified: MODIFIED });
    const r = openZip(zip);
    const method = (n: string): number => r.get(n)!.method;
    expect(method("xl/worksheets/sheet1.xml")).toBe(8);
    expect(r.get("xl/worksheets/sheet1.xml")!.compressedSize).toBeLessThan(10_000);
    expect(method("stored.txt")).toBe(0);
    expect(method("empty.txt")).toBe(0); // deflate would be larger than 0 bytes
    expect(method("random.bin")).toBe(8); // too big to keep for the store fallback
    expect(STORE_FALLBACK_MAX).toBeLessThan(100_000);
  });

  it("store mode stores everything", async () => {
    const zip = await writeZip(entries(), { compression: "store", modified: MODIFIED });
    expect(openZip(zip).entries.every((e) => e.method === 0)).toBe(true);
    expect((await readAll(zip)).size).toBe(entries().length);
  });

  it("is deterministic and keeps the timestamp (UTC, 2-second resolution)", async () => {
    const a = await writeZip(entries().filter((e) => e.name !== "random.bin"), { modified: MODIFIED });
    const b = await writeZip(entries().filter((e) => e.name !== "random.bin"), { modified: MODIFIED });
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    expect(openZip(a).entries[0]!.modified.toISOString()).toBe("2024-01-15T10:30:00.000Z");
    const odd = await writeZip([{ name: "x", data: "x", modified: new Date(Date.UTC(2030, 5, 1, 1, 2, 3)) }]);
    expect(openZip(odd).entries[0]!.modified.toISOString()).toBe("2030-06-01T01:02:02.000Z");
  });

  it("sets the UTF-8 flag only for non-ASCII names", async () => {
    const zip = await writeZip(entries(), { modified: MODIFIED });
    const r = openZip(zip);
    expect(r.get("données/ü.xml")!.flags & 0x0800).toBe(0x0800);
    expect(r.get("stored.txt")!.flags & 0x0800).toBe(0);
  });

  it("writes [Content_Types].xml first and no data descriptors", async () => {
    const zip = await writeZip(entries(), { modified: MODIFIED });
    const r = openZip(zip);
    expect(r.entries[0]!.name).toBe("[Content_Types].xml");
    expect(r.entries.every((e) => (e.flags & 0x0008) === 0)).toBe(true);
    expect(findSig(zip, 0x08074b50)).toEqual([]);
  });

  it("streams an entry in chunks", async () => {
    const rows = Array.from({ length: 40_000 }, (_, i) => `<row r="${i + 1}"><c><v>${i * 7}</v></c></row>`).join("");
    const zip = await writeZip([{ name: "big.xml", data: rows }]);
    let n = 0;
    let chunks = 0;
    for await (const c of openZip(zip).stream("big.xml")) {
      n += c.length;
      chunks++;
    }
    expect(n).toBe(new TextEncoder().encode(rows).length);
    expect(chunks).toBeGreaterThan(1);
  });

  it("rejects duplicate and invalid names on write", async () => {
    await expect(writeZip([{ name: "a", data: "" }, { name: "a", data: "" }])).rejects.toThrow(/Duplicate/);
    for (const name of ["", "/abs", "a\\b", "a\0b"]) {
      await expect(writeZip([{ name, data: "" }])).rejects.toThrow(/Invalid zip entry name/);
    }
  });

  it("throws ZIP64_REQUIRED past 65,534 entries", async () => {
    function* many(): Generator<ZipWriteEntry> {
      for (let i = 0; i < 0xffff; i++) yield { name: `e${i}`, data: "", compression: "store" };
    }
    expect(await codeOf(writeZip(many()))).toBe("ZIP64_REQUIRED");
  });

  it("aborts with signal.reason", async () => {
    const ac = new AbortController();
    ac.abort(new Error("cancelled"));
    await expect(writeZip(entries(), { signal: ac.signal })).rejects.toThrow("cancelled");
  });
});

describe("zip reader: hostile and malformed archives", () => {
  const base = (): Promise<Uint8Array> =>
    writeZip(
      [
        { name: "a.txt", data: "first entry", compression: "store" },
        { name: "b.txt", data: "second entry".repeat(1000) },
      ],
      { modified: MODIFIED },
    );

  const patch = (zip: Uint8Array, at: number, bytes: number[]): Uint8Array => {
    const out = zip.slice();
    out.set(bytes, at);
    return out;
  };
  const u16 = (v: number): number[] => [v & 0xff, v >>> 8];
  const u32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];

  it("not a zip", async () => {
    expect(await codeOf(() => openZip(new Uint8Array(0)))).toBe("ZIP_INVALID");
    expect(await codeOf(() => openZip(randomBytes(1000)))).toBe("ZIP_INVALID");
    expect(await codeOf(() => openZip(enc("PK\x05\x06")))).toBe("ZIP_INVALID");
  });

  it("truncated archive", async () => {
    const zip = await base();
    for (const n of [zip.length - 1, zip.length - 30, 40]) {
      expect(await codeOf(() => openZip(zip.subarray(0, n)))).toBe("ZIP_INVALID");
    }
  });

  it("reads an archive with a comment after the EOCD record", async () => {
    const zip = await base();
    const comment = enc("a comment with PK\x05\x06 inside");
    const out = new Uint8Array(zip.length + comment.length);
    out.set(zip);
    out.set(comment, zip.length);
    out.set(u16(comment.length), zip.length - 2);
    expect((await readAll(out)).get("a.txt")).toEqual(enc("first entry"));
  });

  it("encrypted entry (flag bit 0) → ZIP_ENCRYPTED", async () => {
    const zip = await base();
    let out = zip;
    for (const at of findSig(zip, LOCAL)) out = patch(out, at + 6, u16(1));
    for (const at of findSig(zip, CENTRAL)) out = patch(out, at + 8, u16(1));
    expect(await codeOf(() => openZip(out))).toBe("ZIP_ENCRYPTED");
  });

  it("unsupported method (bzip2 = 12) → ZIP_UNSUPPORTED_METHOD", async () => {
    const zip = await base();
    const [, l2] = findSig(zip, LOCAL);
    const [, c2] = findSig(zip, CENTRAL);
    const out = patch(patch(zip, l2! + 8, u16(12)), c2! + 10, u16(12));
    expect(await codeOf(() => openZip(out))).toBe("ZIP_UNSUPPORTED_METHOD");
  });

  it("duplicate names → ZIP_INVALID", async () => {
    const zip = await base();
    const [, l2] = findSig(zip, LOCAL);
    const [, c2] = findSig(zip, CENTRAL);
    const out = patch(patch(zip, l2! + 30, [...enc("a")]), c2! + 46, [...enc("a")]);
    expect(await codeOf(() => openZip(out))).toBe("ZIP_INVALID");
  });

  it("local header disagreeing with the central directory → ZIP_INVALID", async () => {
    const zip = await base();
    const [, l2] = findSig(zip, LOCAL);
    expect(await codeOf(() => openZip(patch(zip, l2! + 8, u16(0))))).toBe("ZIP_INVALID"); // method
    expect(await codeOf(() => openZip(patch(zip, l2! + 30, [...enc("x")])))).toBe("ZIP_INVALID"); // name
  });

  it("CRC mismatch → ZIP_CRC_MISMATCH (stored and deflated)", async () => {
    const zip = await base();
    const [l1] = findSig(zip, LOCAL);
    const stored = patch(zip, l1! + 30 + 5, [0x21]);
    expect(await codeOf(readAll(stored))).toBe("ZIP_CRC_MISMATCH");

    const r = openZip(zip);
    const b = r.get("b.txt")!;
    let wrong = zip;
    for (const at of findSig(zip, LOCAL).slice(1)) wrong = patch(wrong, at + 14, u32(b.crc32 ^ 1));
    for (const at of findSig(zip, CENTRAL).slice(1)) wrong = patch(wrong, at + 16, u32(b.crc32 ^ 1));
    expect(await codeOf(readAll(wrong))).toBe("ZIP_CRC_MISMATCH");
  });

  it("entry producing more or less than its declared size → ZIP_INVALID", async () => {
    const zip = await base();
    const b = openZip(zip).get("b.txt")!;
    const withSize = (size: number): Uint8Array => {
      let out = zip;
      for (const at of findSig(zip, LOCAL).slice(1)) out = patch(out, at + 22, u32(size));
      for (const at of findSig(zip, CENTRAL).slice(1)) out = patch(out, at + 24, u32(size));
      return out;
    };
    expect(await codeOf(readAll(withSize(b.size - 1)))).toBe("ZIP_INVALID");
    expect(await codeOf(readAll(withSize(b.size + 1)))).toBe("ZIP_INVALID");
  });

  it("overlapping entries (an entry inside another's data) → ZIP_INVALID", async () => {
    // Entry "outer" is stored and its data is a complete local header + data for "inner".
    const innerData = enc("hidden");
    const inner = new Uint8Array([
      ...u32(LOCAL), ...u16(10), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc32(innerData)), ...u32(innerData.length), ...u32(innerData.length),
      ...u16(5), ...u16(0), ...enc("inner"), ...innerData,
    ]);
    const outerName = enc("outer");
    const local = (name: Uint8Array, data: Uint8Array): number[] => [
      ...u32(LOCAL), ...u16(10), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc32(data)), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name,
    ];
    const central = (name: Uint8Array, data: Uint8Array, offset: number): number[] => [
      ...u32(CENTRAL), ...u16(20), ...u16(10), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc32(data)), ...u32(data.length), ...u32(data.length), ...u16(name.length),
      ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    ];
    const head = [...local(outerName, inner), ...inner];
    const cd = [...central(outerName, inner, 0), ...central(enc("inner"), innerData, 30 + outerName.length)];
    const eocd = [...u32(EOCD), ...u16(0), ...u16(0), ...u16(2), ...u16(2), ...u32(cd.length), ...u32(head.length), ...u16(0)];
    const zip = new Uint8Array([...head, ...cd, ...eocd]);
    expect(await codeOf(() => openZip(zip))).toBe("ZIP_INVALID");
  });

  it("enforces maxInputBytes, maxEntries, maxEntryBytes and maxTotalBytes", async () => {
    const zip = await base();
    const limitOf = async (limits: Partial<ZipReadLimits>): Promise<unknown> => {
      try {
        await readAll(zip, limits);
      } catch (e) {
        return isExcelError(e) ? `${e.code}:${String(e.details?.["limit"])}` : e;
      }
      return "no error";
    };
    expect(await limitOf({ maxInputBytes: zip.length - 1 })).toBe("LIMIT_EXCEEDED:maxInputBytes");
    expect(await limitOf({ maxEntries: 1 })).toBe("LIMIT_EXCEEDED:maxEntries");
    expect(await limitOf({ maxEntryBytes: 100 })).toBe("LIMIT_EXCEEDED:maxEntryBytes");
    expect(await limitOf({ maxTotalBytes: 1000 })).toBe("LIMIT_EXCEEDED:maxTotalBytes");
    expect(await limitOf({})).toBe("no error");
  });

  it("does not trust a declared size: a lying deflate bomb stops at maxEntryBytes", async () => {
    // Declares 100 bytes but inflates to 64 MiB of zeros; it must stop early, not after 64 MiB.
    const zip = await writeZip([{ name: "bomb", data: new Uint8Array(64 * 1024 * 1024) }]);
    let out = zip;
    for (const at of findSig(zip, LOCAL)) out = patch(out, at + 22, u32(100));
    for (const at of findSig(zip, CENTRAL)) out = patch(out, at + 24, u32(100));
    expect(await codeOf(readAll(out))).toBe("ZIP_INVALID");
    expect(await codeOf(readAll(zip, { maxEntryBytes: 1024 * 1024 }))).toBe("LIMIT_EXCEEDED");
    expect(await codeOf(readAll(zip, { maxRatio: 50 }))).toBe("LIMIT_EXCEEDED");
  });

  it("reads zip64 end-of-central-directory records", async () => {
    // Rewrite a normal archive into zip64 form: zip64 EOCD + locator, EOCD fields saturated.
    const zip = await base();
    const eocdPos = findSig(zip, EOCD).at(-1)!;
    const v = new DataView(zip.buffer, zip.byteOffset);
    const count = v.getUint16(eocdPos + 10, true);
    const cdSize = v.getUint32(eocdPos + 12, true);
    const cdOffset = v.getUint32(eocdPos + 16, true);
    const u64 = (n: number): number[] => [...u32(n), ...u32(0)];
    const z64 = [
      ...u32(0x06064b50), ...u64(44), ...u16(45), ...u16(45), ...u32(0), ...u32(0),
      ...u64(count), ...u64(count), ...u64(cdSize), ...u64(cdOffset),
    ];
    const locator = [...u32(0x07064b50), ...u32(0), ...u64(eocdPos), ...u32(1)];
    const eocd = [...u32(EOCD), ...u16(0), ...u16(0), ...u16(0xffff), ...u16(0xffff), ...u32(0xffffffff), ...u32(0xffffffff), ...u16(0)];
    const out = new Uint8Array([...zip.subarray(0, eocdPos), ...z64, ...locator, ...eocd]);
    const back = await readAll(out);
    expect(dec(back.get("b.txt")!)).toBe("second entry".repeat(1000));
  });

  it("saturated EOCD values without a zip64 locator → ZIP_INVALID", async () => {
    const zip = await base();
    const eocdPos = findSig(zip, EOCD).at(-1)!;
    expect(await codeOf(() => openZip(patch(zip, eocdPos + 16, u32(0xffffffff))))).toBe("ZIP_INVALID");
  });
});
