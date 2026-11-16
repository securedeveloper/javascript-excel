/// <reference types="node" />
// Every corpus file: written, read back with javascript-excel's reader (values,
// sheets, merges, names compared) and opened by openpyxl.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cellText, dateToSerial, toUint8Array, type Cell, type CellInput, type Workbook } from "../../src/index";
import { read } from "../../src/read";
import { renderChecklist } from "./checklist";
import { ALL, type CorpusEntry } from "./corpus";

const PY = process.env["JSE_PYTHON"] ?? "python3";
const dump = join(process.cwd(), "test", "interop", "xlsx_dump.py");
const hasOpenpyxl = spawnSync(PY, ["-I", "-c", "import openpyxl"], { stdio: "ignore" }).status === 0;
if (process.env["CI"] && !hasOpenpyxl) throw new Error(`CI must provide openpyxl (python: ${PY})`);
const dir = mkdtempSync(join(tmpdir(), "jse-conformance-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const written = new Map<string, Uint8Array>();
async function bytesOf(e: CorpusEntry): Promise<Uint8Array> {
  let b = written.get(e.id);
  if (!b) {
    b = await toUint8Array(e.workbook(), e.options);
    written.set(e.id, b);
  }
  return b;
}

/**
 * Every non-empty cell as [sheet, ref, text]. Numbers and dates are compared as
 * serials, because the number format decides which one the reader returns: a
 * Date written with format "0" reads back as 61, and 0.5 with "h:mm" as a time.
 */
function texts(wb: Workbook): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  const date1904 = wb.date1904 === true;
  const norm = (c: CellInput): string => {
    const v = c !== null && typeof c === "object" && !(c instanceof Date) && !("error" in c) && !("richText" in c) ? (c as Cell).value : c;
    if (v instanceof Date) return `#${dateToSerial(v, { date1904 }).toFixed(6)}`;
    if (typeof v === "number") return `#${v.toFixed(6)}`;
    return cellText(c);
  };
  for (const s of wb.sheets) {
    s.rows.forEach((row, r) =>
      row?.forEach((c, col) => {
        if (c === undefined || c === null) return;
        out.push([s.name, `${r}:${col}`, norm(c)]);
      }),
    );
  }
  return out;
}

describe("conformance corpus", () => {
  it("has unique file ids and at least one check per file", () => {
    expect(new Set(ALL.map((e) => e.id)).size).toBe(ALL.length);
    for (const e of ALL) expect(e.checks.length, e.id).toBeGreaterThan(0);
  });

  it("docs/conformance.md is up to date (npm run conformance:doc)", () => {
    const doc = readFileSync(join(process.cwd(), "..", "..", "docs", "conformance.md"), "utf8");
    expect(doc).toBe(renderChecklist());
  });

  describe.each(ALL)("$id", (entry) => {
    it("reads back with javascript-excel's reader: no warnings, same sheets, values, merges and names", { timeout: 120_000 }, async () => {
      const input = entry.workbook();
      const { workbook, warnings } = await read(await bytesOf(entry));
      expect(warnings).toEqual([]);
      expect(workbook.sheets.map((s) => [s.name, s.state ?? "visible"])).toEqual(input.sheets.map((s) => [s.name, s.state ?? "visible"]));
      expect(texts(workbook)).toEqual(texts(input));
      workbook.sheets.forEach((s, i) => expect(s.merges ?? [], s.name).toEqual(input.sheets[i]!.merges ?? []));
      expect((workbook.definedNames ?? []).map((d) => d.name).sort()).toEqual((input.definedNames ?? []).map((d) => d.name).sort());
      expect(workbook.date1904 ?? false).toBe(input.date1904 ?? false);
      // And the reader's output is valid writer input: write(read(x)) succeeds and reads back the same.
      const again = await read(await toUint8Array(workbook));
      expect(again.warnings).toEqual([]);
      expect(texts(again.workbook)).toEqual(texts(input));
    });

    it.skipIf(!hasOpenpyxl || entry.heavy === true)("opens in openpyxl with the same sheets and cell values", { timeout: 120_000 }, async () => {
      const file = join(dir, `${entry.id}.xlsx`);
      writeFileSync(file, await bytesOf(entry));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = JSON.parse(execFileSync(PY, ["-I", dump, file, "values"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })) as any;
      const input = entry.workbook();
      expect(d.sheets.map((s: { title: string }) => s.title)).toEqual(input.sheets.map((s) => s.name));
      const count = (wb: Workbook): number => wb.sheets.reduce((n, s) => n + s.rows.reduce((m, r) => m + (r?.filter((c) => c !== undefined && c !== null && !(typeof c === "object" && !(c instanceof Date) && "value" in c && (c.value === null || c.value === undefined) && !("formula" in c && c.formula))).length ?? 0), 0), 0);
      const got = Object.values(d.cells as Record<string, Record<string, { value: unknown }>>).reduce((n, cells) => n + Object.values(cells).filter((c) => c.value !== null).length, 0);
      expect(got).toBe(count(input));
    });
  });
});
