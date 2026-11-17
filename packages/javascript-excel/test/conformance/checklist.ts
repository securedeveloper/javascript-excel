// Renders docs/conformance.md from the corpus metadata, so the checklist and
// the files can never disagree. Regenerate with `npm run conformance:doc`.
import { ALL, MANUAL_CHECK, type Check } from "./corpus";

export function renderChecklist(): string {
  const out: string[] = [];
  out.push(
    "# Conformance check",
    "",
    "<!-- Generated from packages/javascript-excel/test/conformance/corpus.ts by `npm run conformance:doc`. Do not edit by hand. -->",
    "",
    "This checklist is for a one-time manual check of the conformance corpus in **Microsoft Excel (Windows and Mac)** and **Apple Numbers**. The automated checks already open every file in LibreOffice and read it back with openpyxl and with javascript-excel's own reader. Only a person with Excel and Numbers can confirm what those apps show.",
    "",
    "## Results",
    "",
    `Checked on ${MANUAL_CHECK.date} in **${MANUAL_CHECK.checked.join(", ")}**: every file below opens with no repair prompt and was reported as passing. Eight of the open items were confirmed, one of them only in part. One (the Display sheet) was not reported. What was not checked is marked **Not verified** below.`,
    "",
    `**Not checked by hand: ${MANUAL_CHECK.notChecked.join(" and ")}.** For those apps, only the automated checks apply: CI opens the corpus files in LibreOffice and reads them back with openpyxl and with javascript-excel's own reader ([Automated cross-checks](#automated-cross-checks)). Files saved by Excel, Numbers and Google Sheets (reader fixtures) and a file with a \`#SPILL!\` error were not made, so those items stay open.`,
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
    for (const c of e.checks) out.push(`| ${esc(c.where)} | ${esc(c.look)} | ${esc(c.expect)}${c.verifies ? " **(open item)**" : ""} | ${app("Excel for Windows", c)} | ${app("Excel for Mac", c)} | ${app("Apple Numbers", c)} |`);
    out.push("");
  }
  out.push(
    "## Open items this check resolves",
    "",
    `These facts were marked \`[to verify]\` in \`docs/api.md\`. Each one is checked by the file named here. The result is from ${MANUAL_CHECK.checked.join(", ")} on ${MANUAL_CHECK.date}; \`docs/api.md\` was updated from it. An item without a result is still open.`,
    "",
    "| Open item | File | Where | Result |",
    "|---|---|---|---|",
  );
  for (const e of ALL) for (const c of e.checks) if (c.verifies) out.push(`| ${esc(c.verifies)} | \`${e.id}.xlsx\` | ${esc(c.where)} | ${c.result ? (isConfirmed(c) ? esc(c.result).replace("Not verified:", "**Not verified:**") : `**${esc(c.result)}**`) : "**Open**"} |`);
  out.push(
    "| how newer Excel errors such as `#SPILL!` are stored (§3.4) | *(make one)* | In Excel 365, enter `=SEQUENCE(3)` in A2 and any value in A3 so it spills into a blocked cell, save as `.xlsx`, and attach the file to the report. The XML is inspected from it. | **Open**: no file was made |",
    "",
    "Not covered by a manual check: date detection for custom formats (§3.4.1) is checked automatically by the reader tests, and the maximum digit width for default fonts other than Calibri 11 stays open.",
    "",
    "## Automated cross-checks",
    "",
    "Every pull request checks the writer and reader against independent implementations:",
    "",
    "- **openpyxl** (`packages/javascript-excel/test/interop/xlsx_dump.py`) reads the corpus files and the writer's golden files back: values, formulas with their cached results, number formats and full styles, sheet features and document properties. openpyxl also writes the reader fixtures in `packages/javascript-excel/test/fixtures/read/`.",
    "- **LibreOffice** (headless) opens every corpus file except the large `18-limits.xlsx` and re-saves it as `.xlsx`; javascript-excel's reader then checks that every sheet and text cell survived. Files written by LibreOffice are reader fixtures too.",
    "- **Python's standard library** cross-checks the zip layer (`zipfile`, `packages/javascript-excel/test/interop/zip_interop.py`) and CSV (`csv`, `packages/javascript-excel/test/interop/csv_interop.py`) in both directions.",
    "",
    "The original plan (JSE-9) also called for a cross-check against SheetJS as a devDependency. It was replaced by the openpyxl tests above. openpyxl is a separate implementation in another language and exposes the whole style model, so a test can compare fonts, fills, borders, alignment and number formats cell by cell; SheetJS's community edition reads little of the styling. The SheetJS package on the npm registry is also no longer its current release (newer versions are distributed from the SheetJS CDN), and javascript-excel replaces a SheetJS fork, so a SheetJS comparison would check against the predecessor's lineage rather than an independent reading of the format. Python and openpyxl are CI tools only: the package keeps zero dependencies and no new devDependency was added. Files saved by Excel, Numbers and Google Sheets are not part of the tests yet.",
    "",
  );
  return out.join("\n");
}

function app(name: string, c: Check): string {
  if (!(MANUAL_CHECK.checked as readonly string[]).includes(name)) return "not checked";
  if (c.result === undefined) return "pass";
  return isConfirmed(c) ? "see [Open items](#open-items-this-check-resolves)" : "opened; result not recorded";
}

function isConfirmed(c: Check): boolean {
  return c.result !== undefined && c.result.startsWith("Confirmed");
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
