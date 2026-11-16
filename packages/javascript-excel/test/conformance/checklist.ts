// Renders docs/conformance.md from the corpus metadata, so the checklist and
// the files can never disagree. Regenerate with `npm run conformance:doc`.
import { ALL } from "./corpus";

export function renderChecklist(): string {
  const out: string[] = [];
  out.push(
    "# Conformance check",
    "",
    "<!-- Generated from packages/javascript-excel/test/conformance/corpus.ts by `npm run conformance:doc`. Do not edit by hand. -->",
    "",
    "This checklist is for a one-time manual check of the conformance corpus in **Microsoft Excel (Windows and Mac)** and **Apple Numbers**. The automated checks already open every file in LibreOffice and read it back with openpyxl and with javascript-excel's own reader. Only a person with Excel and Numbers can confirm what those apps show.",
    "",
    "## Getting the files",
    "",
    "- **From CI:** open the latest run of the `CI` workflow on `main` (or on a pull request), find the `LibreOffice` job, and download the **`conformance-corpus`** artifact. It contains every file below, this checklist (`CHECKLIST.md`) and `manifest.json` with each file's SHA-256.",
    "- **Locally:** `npm run conformance:artifact -w packages/javascript-excel` writes `packages/javascript-excel/conformance-corpus/` and `conformance-corpus.zip`.",
    "",
    "Every sheet is self-describing. Column A says what a row tests, column B holds the sample, and column C says what you should see. Open each file in Excel for Windows, Excel for Mac and Numbers.",
    "",
    "## How to record results",
    "",
    "For each file and app, note **pass**, or describe the difference (a screenshot helps). Report:",
    "",
    "- any **repair prompt** (\"We found a problem with some content…\"), which always counts as a failure;",
    "- every row in [Open items](#open-items-this-check-resolves) below; those results update `docs/api.md`.",
    "",
    "Numbers does not support every Excel feature (for example pattern fills, outline groups or print titles), so a missing feature in Numbers is a note, not a failure. A file that does not open, or a wrong value or date, is a failure in every app.",
    "",
    "## Files",
    "",
    "| File | Covers |",
    "|---|---|",
  );
  for (const e of ALL) out.push(`| \`${e.id}.xlsx\` | ${e.title}: ${e.covers}${e.heavy ? " *(large file)*" : ""} |`);
  out.push("");
  for (const e of ALL) {
    out.push(`### ${e.id}.xlsx: ${e.title}`, "", `Covers ${e.covers}.`, "", "| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |", "|---|---|---|---|---|---|");
    for (const c of e.checks) out.push(`| ${esc(c.where)} | ${esc(c.look)} | ${esc(c.expect)}${c.verifies ? " **(open item)**" : ""} | | | |`);
    out.push("");
  }
  out.push(
    "## Open items this check resolves",
    "",
    "These facts are marked `[to verify]` in `docs/api.md`. Each one is checked by the file named here; record the result, and the doc is updated from it.",
    "",
    "| Open item | File | Where |",
    "|---|---|---|",
  );
  for (const e of ALL) for (const c of e.checks) if (c.verifies) out.push(`| ${esc(c.verifies)} | \`${e.id}.xlsx\` | ${esc(c.where)} |`);
  out.push(
    "| how newer Excel errors such as `#SPILL!` are stored (§3.4) | *(make one)* | In Excel 365, enter `=SEQUENCE(3)` in A2 and any value in A3 so it spills into a blocked cell, save as `.xlsx`, and attach the file to the report. The XML is inspected from it. |",
    "",
    "Not covered by a manual check: date detection for custom formats (§3.4.1) is checked automatically by the reader tests, and the maximum digit width for default fonts other than Calibri 11 stays open.",
    "",
  );
  return out.join("\n");
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
