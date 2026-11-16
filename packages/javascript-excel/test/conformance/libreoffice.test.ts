/// <reference types="node" />
// Every (non-heavy) corpus file opened in LibreOffice headless and re-saved as
// xlsx, then read back with javascript-excel's reader (which decodes ST_Xstring
// escapes and rich text per the spec; openpyxl decodes only some escapes):
// same sheets, every text cell unchanged.
// Runs in the `LibreOffice` CI job (JSE_REQUIRE_LIBREOFFICE=1); skipped elsewhere
// unless $JSE_SOFFICE is available.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { cellText, toUint8Array, type Cell, type CellInput } from "../../src/index";
import { read } from "../../src/read";
import { ALL } from "./corpus";

const SOFFICE = process.env["JSE_SOFFICE"] ?? "soffice";
const hasSoffice = spawnSync(SOFFICE, ["--version"], { stdio: "ignore", timeout: 120_000 }).status === 0;
if (process.env["JSE_REQUIRE_LIBREOFFICE"] === "1" && !hasSoffice) throw new Error(`LibreOffice check required but soffice (${SOFFICE}) is missing`);
const dir = mkdtempSync(join(tmpdir(), "jse-lo-conformance-"));
// A private LibreOffice profile: two headless instances on the default profile block each other.
const profile = `-env:UserInstallation=${pathToFileURL(join(dir, "profile")).href}`;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const isText = (c: CellInput): boolean => {
  if (typeof c === "string") return c !== "";
  if (typeof c !== "object" || c === null || c instanceof Date) return false;
  if ("richText" in c) return true;
  if ("error" in c) return false;
  const cell = c as Cell;
  return !cell.formula && ((typeof cell.value === "string" && cell.value !== "") || (typeof cell.value === "object" && cell.value !== null && "richText" in cell.value));
};

describe.skipIf(!hasSoffice)("conformance corpus in LibreOffice", () => {
  it.each(ALL.filter((e) => !e.heavy))("$id opens and re-saves with the same sheets and text", { timeout: 300_000 }, async (entry) => {
    const input = entry.workbook();
    const file = join(dir, `${entry.id}.xlsx`);
    writeFileSync(file, await toUint8Array(input, entry.options));
    const out = join(dir, "resaved", entry.id);
    mkdirSync(out, { recursive: true });
    execFileSync(SOFFICE, [profile, "--headless", "--norestore", "--convert-to", "xlsx", "--outdir", out, file], { stdio: "ignore", timeout: 300_000 });
    const { workbook } = await read(new Uint8Array(readFileSync(join(out, `${entry.id}.xlsx`))));
    // LibreOffice has no "very hidden" state; it re-saves such sheets as hidden.
    const state = (st: string | undefined): string => (st === "veryHidden" ? "hidden" : (st ?? "visible"));
    expect(workbook.sheets.map((s) => [s.name, state(s.state)])).toEqual(input.sheets.map((s) => [s.name, state(s.state)]));
    input.sheets.forEach((s, i) => {
      const back = workbook.sheets[i]!;
      s.rows.forEach((row, r) =>
        row?.forEach((c, col) => {
          if (!isText(c)) return;
          // LibreOffice reads a literal "_x005F_xHHHH_" correctly (its CSV export shows it), but its own
          // xlsx writer does not protect the leading _x005F_ again, so its re-saved file loses one level.
          if (cellText(c).includes("_x005F_")) return;
          // LibreOffice keeps no CR in cell text (CR LF reads back as LF); mixed scripts come back as rich-text runs.
          expect(cellText(back.rows[r]?.[col]), `${entry.id} ${s.name} row ${r + 1} col ${col + 1}`).toBe(cellText(c).replace(/\r\n/g, "\n"));
        }),
      );
    });
  });
});
