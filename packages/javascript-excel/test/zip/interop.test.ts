/// <reference types="node" />
// Interop with independent zip implementations: Python's zipfile and Info-ZIP's unzip.
// Both tools are required in CI (GitHub's ubuntu-latest image has them); locally the
// tests are skipped when a tool is missing.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { openZip } from "../../src/internal/zip/read";
import { writeZip } from "../../src/internal/zip/write";

const script = fileURLToPath(new URL("../interop/zip_interop.py", import.meta.url));
const has = (cmd: string, args: string[]): boolean => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const python = has("python3", ["--version"]);
const unzip = has("unzip", ["-v"]);
if (process.env["CI"] && (!python || !unzip)) throw new Error("CI must provide python3 and unzip for zip interop tests");

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const work = mkdtempSync(join(tmpdir(), "jse-zip-interop-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const ours = (): Promise<Uint8Array> =>
  writeZip(
    [
      { name: "[Content_Types].xml", data: '<?xml version="1.0"?><Types/>' },
      { name: "xl/worksheets/sheet1.xml", data: "<row><c><v>1</v></c></row>".repeat(40_000) },
      { name: "stored.txt", data: "stored", compression: "store" },
      { name: "empty.txt", data: "" },
      { name: "données/ü.xml", data: "été 漢字" },
    ],
    { modified: new Date(Date.UTC(2024, 0, 15, 10, 30, 0)) },
  );

describe.skipIf(!python)("Python zipfile", () => {
  it("reads archives we write (testzip passes, contents match)", async () => {
    const zip = await ours();
    const file = join(work, "ours.zip");
    writeFileSync(file, zip);
    const result = JSON.parse(execFileSync("python3", ["-I", script, "read", file], { encoding: "utf8" })) as {
      testzip: string | null;
      entries: Array<{ name: string; sha256: string; method: number; date_time: number[] }>;
    };
    expect(result.testzip).toBeNull();
    const r = openZip(zip);
    expect(result.entries.map((e) => e.name)).toEqual(r.entries.map((e) => e.name));
    for (const e of result.entries) expect(e.sha256).toBe(sha256(await r.read(e.name)));
    expect(result.entries[1]!.method).toBe(8);
    expect(result.entries[0]!.date_time).toEqual([2024, 1, 15, 10, 30, 0]);
  });

  it("we read archives Python writes: deflate, stored, UTF-8 names, comment, data descriptors, zip64 extras", async () => {
    const manifest = JSON.parse(execFileSync("python3", ["-I", script, "write", work], { encoding: "utf8" })) as Record<
      string,
      Record<string, string>
    >;
    expect(Object.keys(manifest)).toEqual(["py-basic.zip", "py-descriptor.zip", "py-zip64.zip"]);
    for (const [file, expected] of Object.entries(manifest)) {
      const r = openZip(new Uint8Array(readFileSync(join(work, file))));
      expect(r.entries.map((e) => e.name).sort()).toEqual(Object.keys(expected).sort());
      for (const [name, digest] of Object.entries(expected)) expect(sha256(await r.read(name)), `${file}:${name}`).toBe(digest);
    }
    const descriptor = openZip(new Uint8Array(readFileSync(join(work, "py-descriptor.zip"))));
    expect(descriptor.entries.every((e) => (e.flags & 0x0008) !== 0)).toBe(true);
  });
});

describe.skipIf(!unzip)("Info-ZIP unzip", () => {
  it("unzip -t accepts archives we write", async () => {
    const file = join(work, "ours-unzip.zip");
    writeFileSync(file, await ours());
    const out = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
    expect(out).toMatch(/No errors detected/);
  });
});
