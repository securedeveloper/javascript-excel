/// <reference types="node" />
// Reference check for javascript-excel/format: every case of test/format/cases.ts
// and every number-formatted cell of the conformance corpus's number-format files
// is written to one workbook, LibreOffice exports it to CSV "as shown", and each
// cell must equal formatCell(cell, { locale: "en-US" }).text.
//
// LibreOffice is the automated reference, Excel is the authority: where the two are
// known to differ, a rule in RULES names the reason, and docs/api.md §5.6.4 records
// it as [to verify] in Excel. Any other difference fails the test.
// Runs in the `LibreOffice` CI job (JSE_REQUIRE_LIBREOFFICE=1); skipped elsewhere
// unless $JSE_SOFFICE is available.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { toUint8Array, type Cell, type CellInput, type NumFmt, type Workbook } from "../../src/index";
import { parseCsv } from "../../src/csv";
import { isDateFormat } from "../../src/numfmt";
import { formatCell, formatValue } from "../../src/format";
import { CORPUS } from "../conformance/corpus";
import { FORMAT_CASES } from "./cases";

const SOFFICE = process.env["JSE_SOFFICE"] ?? "soffice";
const hasSoffice = spawnSync(SOFFICE, ["--version"], { stdio: "ignore", timeout: 120_000 }).status === 0;
if (process.env["JSE_REQUIRE_LIBREOFFICE"] === "1" && !hasSoffice) throw new Error(`LibreOffice check required but soffice (${SOFFICE}) is missing`);

/**
 * Known ways LibreOffice differs from Excel (and from formatValue). Each rule must prove its
 * cause where it can (for example by formatting the value truncated to the second), so an
 * unrelated mismatch is never explained away. The first rule that holds wins, so the broad
 * calendar rule comes last. docs/api.md §5.6.4 lists them.
 */
type Rule = { id: string; why: string; test: (p: Probe, lo: string, ours: string) => boolean };
const num = (p: Probe): number | undefined => (typeof p.cell.value === "number" ? p.cell.value : undefined);
const code = (p: Probe): NumFmt | undefined => p.cell.style?.numFmt;
const fmt = (v: number, c: NumFmt | undefined): string => formatValue(v, c, { locale: "en-US" }).text;
const truncated = (p: Probe, lo: string): boolean => {
  const v = num(p);
  if (v === undefined) return false;
  return [86_400, 864_000, 1_440].some((n) => fmt(Math.floor(v * n + 1e-9) / n, code(p)) === lo);
};
const RULES: Rule[] = [
  { id: "time-rounding", why: "LibreOffice truncates to the shown second (15:29:59.997 shows 15:29:59); Excel rounds to it (15:30:00)", test: (p, lo) => truncated(p, lo) },
  { id: "general", why: "LibreOffice's General shows up to 15 significant digits with no width limit and 3-digit exponents; Excel's General fits the number into 11 characters", test: (p) => code(p) === "General" || code(p) === 0 },
  { id: "dangling-point", why: "LibreOffice drops a decimal point with no digits after it (#,##0.### shows 7); Excel keeps it (7.)", test: (_p, lo, ours) => ours.endsWith(".") && lo === ours.slice(0, -1) },
  { id: "question-mark-space", why: "LibreOffice pads ? placeholders with U+2007 FIGURE SPACE; formatValue uses a plain space, as text copied from Excel has", test: (_p, lo, ours) => lo.replace(/\u2007/g, " ") === ours },
  { id: "builtin-39-40-47", why: "LibreOffice's built-in ids 39, 40 and 47 are #,##0.00_);(#,##0.00), its [Red] twin and mm:ss.0; formatValue renders the codes of ECMA-376 §18.8.30 (§11.2), which conformance file 10 asks to check in Excel", test: (p, lo, ours) => [39, 40, 47].includes(code(p) as number) && (lo === `${ours} ` || lo === fmt(num(p) ?? 0, "mm:ss.0") || truncated({ ...p, cell: { ...p.cell, style: { numFmt: "mm:ss.0" } } }, lo)) },
  { id: "ampm-case", why: "LibreOffice shows am/pm as AM/PM and A/P as a/p; formatValue keeps the case written in the code", test: (_p, lo, ours) => lo.toLowerCase() === ours.toLowerCase() },
  { id: "1900-calendar", why: "LibreOffice counts every serial from 1899-12-30, so serials below 61 are one day earlier than in Excel, which keeps the fictitious 1900-02-29 (serial 60) and shows serials below 1 as day 0 (1900-01-00)", test: (p, lo, ours) => (num(p) ?? 99) < 61 && isDateFormat(code(p)) && !truncated(p, lo) && lo.toLowerCase() !== ours.toLowerCase() },
];

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

    const escape = (t: string): string => JSON.stringify(t).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
    const mismatches: string[] = [];
    const explained = new Map<string, string[]>();
    let matched = 0;
    list.forEach((p, i) => {
      const lo = String(rows[i]?.[1] ?? "");
      const ours = formatCell(p.cell, { locale: "en-US" }).text;
      if (lo === ours) {
        matched++;
        return;
      }
      const rule = RULES.find((r) => r.test(p, lo, ours));
      if (rule) explained.set(rule.id, [...(explained.get(rule.id) ?? []), `\`${p.label}\`: LibreOffice ${escape(lo)}, formatValue ${escape(ours)}`]);
      else mismatches.push(`| \`${p.label}\` | \`${escape(lo)}\` | \`${escape(ours)}\` |`);
    });

    const report = [
      `### javascript-excel/format vs LibreOffice`,
      ``,
      `${list.length} probes: ${matched} match, ${[...explained.values()].reduce((n, l) => n + l.length, 0)} differ for a known reason, ${mismatches.length} unexplained.`,
      ``,
      ...(mismatches.length ? [`| probe | LibreOffice | formatValue |`, `|---|---|---|`, ...mismatches, ``] : []),
      ...RULES.filter((r) => explained.has(r.id)).flatMap((r) => [`**${r.id}** (${explained.get(r.id)!.length}): ${r.why}`, ...explained.get(r.id)!.map((l) => `- ${l}`), ``]),
    ].join("\n");
    console.log(report);
    if (process.env["GITHUB_STEP_SUMMARY"]) appendFileSync(process.env["GITHUB_STEP_SUMMARY"], `${report}\n`);
    expect(mismatches, "unexplained differences from LibreOffice").toEqual([]);
  });
});
