/// <reference types="node" />
// Interop with Python's csv module, an independent RFC 4180 implementation.
// python3 is required in CI (GitHub's ubuntu-latest image has it); locally the
// tests are skipped when it is missing.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseCsv, readCsv, toCsv } from "../../src/csv";

const script = fileURLToPath(new URL("../interop/csv_interop.py", import.meta.url));
const python = spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;
if (process.env["CI"] && !python) throw new Error("CI must provide python3 for CSV interop tests");

const work = mkdtempSync(join(tmpdir(), "jse-csv-interop-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const py = (...args: string[]): string => execFileSync("python3", ["-I", script, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const TRICKY = ["plain", "", " spaced ", "a,b", "a;b", "a\tb", "a|b", 'say "hi"', '"', "x\ny", "x\ry", "x\r\ny", "=1+1", "-5", "café", "漢字", "😀"];

describe.skipIf(!python)("Python csv module", () => {
  it("we read every dialect Python writes (auto-detected delimiter, BOM, CRLF/LF, QUOTE_ALL, QUOTE_NONNUMERIC)", async () => {
    const manifest = JSON.parse(py("write", work)) as Record<string, { delimiter: string; encoding: string; rows: string[][] }>;
    expect(Object.keys(manifest)).toHaveLength(6);
    for (const [file, { delimiter, encoding, rows }] of Object.entries(manifest)) {
      const bytes = readFileSync(join(work, file));
      const r = await readCsv(new Uint8Array(bytes), { mode: "strict" });
      expect(r.delimiter, file).toBe(delimiter);
      expect(r.bom, file).toBe(encoding === "utf-8-sig");
      expect(r.rows, file).toEqual(rows);
    }
  });

  for (const [delimiter, newline, quote] of [
    [",", "\r\n", "auto"],
    [";", "\n", "auto"],
    ["\t", "\r\n", "all"],
    ["|", "\n", "all"],
  ] as const) {
    it(`Python reads what we write (delimiter ${JSON.stringify(delimiter)}, ${JSON.stringify(newline)}, quote ${quote}, BOM)`, () => {
      const rows = Array.from({ length: 60 }, (_, r) => Array.from({ length: 4 }, (_, c) => TRICKY[(r * 7 + c * 3) % TRICKY.length]! + (c === 0 ? String(r) : "")));
      const file = join(work, `ours-${delimiter.charCodeAt(0)}-${quote}.csv`);
      writeFileSync(file, toCsv(rows, { delimiter, newline, quote, bom: true, escapeFormulas: false }));
      expect(JSON.parse(py("read", file, delimiter))).toEqual(rows);
    });
  }

  it("Python reads the formula guard's output as the prefixed text", () => {
    const file = join(work, "guarded.csv");
    writeFileSync(file, toCsv([["=1+1", "@x", "-5", -5]]));
    expect(JSON.parse(py("read", file, ","))).toEqual([["'=1+1", "'@x", "'-5", "-5"]]);
  });

  it("parseCsv and Python agree on a large generated file", () => {
    const rows = Array.from({ length: 5000 }, (_, r) => [String(r), TRICKY[r % TRICKY.length]!, `${TRICKY[(r * 5) % TRICKY.length]!}${r}`]);
    const file = join(work, "large.csv");
    const text = toCsv(rows, { escapeFormulas: false });
    writeFileSync(file, text);
    expect(JSON.parse(py("read", file, ","))).toEqual(parseCsv(text).rows);
  });
});
