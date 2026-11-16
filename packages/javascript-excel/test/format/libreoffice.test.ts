/// <reference types="node" />
// Reference check for javascript-excel/format: every case of test/format/cases.ts
// and every number-formatted cell of the conformance corpus's number-format files
// is written to one workbook, LibreOffice exports it to CSV "as shown", and each
// cell must equal formatCell(cell, { locale: "en-US" }).text.
//
// LibreOffice is the automated reference, Excel is the authority: where the two are
// known to differ, the case is listed in LIBREOFFICE_DIFFERS with LibreOffice's
// output and the reason, and docs/api.md §5.6 records it as [to verify] in Excel.
// Runs in the `LibreOffice` CI job (JSE_REQUIRE_LIBREOFFICE=1); skipped elsewhere
// unless $JSE_SOFFICE is available.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { toUint8Array, type Cell, type CellInput, type Workbook } from "../../src/index";
import { parseCsv } from "../../src/csv";
import { formatCell } from "../../src/format";
import { CORPUS } from "../conformance/corpus";
import { FORMAT_CASES } from "./cases";

const SOFFICE = process.env["JSE_SOFFICE"] ?? "soffice";
const hasSoffice = spawnSync(SOFFICE, ["--version"], { stdio: "ignore", timeout: 120_000 }).status === 0;
if (process.env["JSE_REQUIRE_LIBREOFFICE"] === "1" && !hasSoffice) throw new Error(`LibreOffice check required but soffice (${SOFFICE}) is missing`);

/** `${code} | ${value}` → LibreOffice's output, where LibreOffice is known to differ from formatValue (and why). */
const LIBREOFFICE_DIFFERS: Record<string, { libreoffice: string; why: string }> = {};

interface Probe {
  label: string;
  cell: Cell;
}

function probes(): Probe[] {
  const out: Probe[] = [];
  for (const c of FORMAT_CASES) {
    for (const value of c.values) out.push({ label: `${String(c.code)} | ${String(value)}`, cell: { value, style: { numFmt: c.code } } });
  }
  // The conformance corpus's number-format files.
  for (const entry of CORPUS.filter((e) => e.id === "10-number-formats" || e.id === "11-number-formats-locale")) {
    for (const sheet of entry.workbook().sheets) {
      sheet.rows.forEach((row) =>
        row?.forEach((c: CellInput) => {
          if (typeof c !== "object" || c === null || c instanceof Date || "error" in c || "richText" in c) return;
          const cell = c as Cell;
          if (cell.style?.numFmt === undefined || cell.formula) return;
          out.push({ label: `${String(cell.style.numFmt)} | ${cell.value instanceof Date ? cell.value.toISOString() : String(cell.value)} (conformance)`, cell });
        }),
      );
    }
  }
  return out;
}

const dir = mkdtempSync(join(tmpdir(), "jse-lo-format-"));
const profile = `-env:UserInstallation=${pathToFileURL(join(dir, "profile")).href}`;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!hasSoffice)("javascript-excel/format against LibreOffice", () => {
  it("every probe matches LibreOffice's 'as shown' CSV, except the listed differences", { timeout: 300_000 }, async () => {
    const list = probes();
    // One probe per row: column A is the label (text), column B the formatted cell.
    const wb: Workbook = { sheets: [{ name: "Formats", rows: list.map((p) => [p.label, p.cell]) }] };
    const file = join(dir, "formats.xlsx");
    writeFileSync(file, await toUint8Array(wb));
    // Filter options: comma, double quote, UTF-8, from line 1, no column types, en-US,
    // quoted as text off, detect special numbers on, save cell contents AS SHOWN on.
    const filter = "csv:Text - txt - csv (StarCalc):44,34,76,1,,1033,false,true,true,false,false";
    execFileSync(SOFFICE, [profile, "--headless", "--norestore", "--convert-to", filter, "--outdir", dir, file], {
      stdio: "ignore",
      timeout: 300_000,
      env: { ...process.env, LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" },
    });
    const csv = readFileSync(join(dir, "formats.csv"), "utf8").replace(/^﻿/, "");
    const rows = parseCsv(csv, { delimiter: ",", inferTypes: false }).rows;

    const mismatches: string[] = [];
    const stale: string[] = [];
    let matched = 0;
    list.forEach((p, i) => {
      const lo = String(rows[i]?.[1] ?? "");
      const ours = formatCell(p.cell, { locale: "en-US" }).text;
      const known = LIBREOFFICE_DIFFERS[p.label];
      if (known) {
        if (lo !== known.libreoffice) stale.push(`${p.label}: LibreOffice now gives ${JSON.stringify(lo)}, listed ${JSON.stringify(known.libreoffice)}`);
        return;
      }
      if (lo === ours) matched++;
      else mismatches.push(`| \`${p.label}\` | \`${JSON.stringify(lo)}\` | \`${JSON.stringify(ours)}\` |`);
    });

    const report = [
      `### javascript-excel/format vs LibreOffice`,
      ``,
      `${list.length} probes: ${matched} match, ${Object.keys(LIBREOFFICE_DIFFERS).length} listed differences, ${mismatches.length} unexpected mismatches, ${stale.length} stale entries.`,
      ``,
      ...(mismatches.length ? [`| probe | LibreOffice | formatValue |`, `|---|---|---|`, ...mismatches, ``] : []),
      ...stale.map((s) => `- stale: ${s}`),
    ].join("\n");
    console.log(report);
    if (process.env["GITHUB_STEP_SUMMARY"]) appendFileSync(process.env["GITHUB_STEP_SUMMARY"], `${report}\n`);
    expect(mismatches, "unexpected differences from LibreOffice").toEqual([]);
    expect(stale, "listed differences that changed").toEqual([]);
  });
});
