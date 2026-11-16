/// <reference types="node" />
// Writes the corpus for people and CI, not a check:
//   JSE_CONFORMANCE_OUT=<dir>  every corpus file, CHECKLIST.md and manifest.json
//   JSE_CONFORMANCE_DOC=<file> docs/conformance.md
// Used by scripts/conformance.mjs (npm run conformance:artifact / conformance:doc).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { toUint8Array, VERSION } from "../../src/index";
import { renderChecklist } from "./checklist";
import { ALL } from "./corpus";

const out = process.env["JSE_CONFORMANCE_OUT"];
const doc = process.env["JSE_CONFORMANCE_DOC"];

describe.skipIf(!out && !doc)("conformance corpus builder", () => {
  it.skipIf(!doc)("writes docs/conformance.md", () => {
    writeFileSync(doc!, renderChecklist());
  });

  it.skipIf(!out)("writes the corpus, CHECKLIST.md and manifest.json", { timeout: 300_000 }, async () => {
    mkdirSync(out!, { recursive: true });
    const files: Array<{ file: string; title: string; bytes: number; sha256: string }> = [];
    for (const e of ALL) {
      const bytes = await toUint8Array(e.workbook(), e.options);
      const file = `${e.id}.xlsx`;
      writeFileSync(join(out!, file), bytes);
      files.push({ file, title: e.title, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    writeFileSync(join(out!, "CHECKLIST.md"), renderChecklist());
    writeFileSync(join(out!, "manifest.json"), `${JSON.stringify({ library: "javascript-excel", version: VERSION, files }, null, 2)}\n`);
  });
});
