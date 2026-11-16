// Builds small .xlsx packages from XML strings for reader tests.
import { writeZip, type ZipWriteEntry } from "../../src/internal/zip/write";

export const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

export interface BuildOptions {
  /** Worksheet XML bodies (inside <worksheet>), or full documents when they start with '<?xml' or '<worksheet'. */
  sheets: Array<string | { name: string; xml: string; state?: string }>;
  sharedStrings?: string[] | string;
  styles?: string;
  workbookExtra?: string;
  workbookPr?: string;
  /** Extra package parts. */
  parts?: Record<string, string | Uint8Array>;
  /** Extra workbook relationships: [id, typeSuffix, target]. */
  workbookRels?: Array<[string, string, string]>;
  /** Per-sheet relationships (index -> [id, typeSuffix, target, external?]). */
  sheetRels?: Record<number, Array<[string, string, string, boolean?]>>;
  /** Replace these parts entirely. */
  override?: Record<string, string | Uint8Array | null>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function sheetXml(body: string): string {
  return body.startsWith("<?xml") || body.startsWith("<worksheet") ? body : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}>${body}</worksheet>`;
}

export async function build(o: BuildOptions): Promise<Uint8Array> {
  const parts = new Map<string, string | Uint8Array>();
  const sheets = o.sheets.map((s, i) => (typeof s === "string" ? { name: `Sheet${i + 1}`, xml: s, state: undefined } : s));
  parts.set(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
  );
  parts.set("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const wbRels: string[] = [];
  const sheetEls: string[] = [];
  sheets.forEach((s, i) => {
    wbRels.push(`<Relationship Id="rS${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
    sheetEls.push(`<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ""} r:id="rS${i + 1}"/>`);
    parts.set(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.xml));
    const rels = o.sheetRels?.[i];
    if (rels) {
      parts.set(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        `<?xml version="1.0"?><Relationships xmlns="${PKG_REL}">${rels.map(([id, t, target, ext]) => `<Relationship Id="${id}" Type="${REL}/${t}" Target="${esc(target)}"${ext ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`,
      );
    }
  });
  if (o.sharedStrings !== undefined) {
    const body = typeof o.sharedStrings === "string" ? o.sharedStrings : o.sharedStrings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("");
    parts.set("xl/sharedStrings.xml", `<?xml version="1.0"?><sst ${NS}>${body}</sst>`);
    wbRels.push(`<Relationship Id="rSST" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`);
  }
  if (o.styles !== undefined) {
    parts.set("xl/styles.xml", `<?xml version="1.0"?><styleSheet ${NS}>${o.styles}</styleSheet>`);
    wbRels.push(`<Relationship Id="rSt" Type="${REL}/styles" Target="styles.xml"/>`);
  }
  for (const [id, t, target] of o.workbookRels ?? []) wbRels.push(`<Relationship Id="${id}" Type="${REL}/${t}" Target="${esc(target)}"/>`);
  parts.set("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="${PKG_REL}">${wbRels.join("")}</Relationships>`);
  parts.set(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook ${NS}>${o.workbookPr ?? ""}<sheets>${sheetEls.join("")}</sheets>${o.workbookExtra ?? ""}</workbook>`,
  );
  for (const [k, v] of Object.entries(o.parts ?? {})) parts.set(k, v);
  for (const [k, v] of Object.entries(o.override ?? {})) {
    if (v === null) parts.delete(k);
    else parts.set(k, v);
  }
  const entries: ZipWriteEntry[] = [...parts].map(([name, data]) => ({ name, data }));
  return writeZip(entries, { modified: new Date(Date.UTC(2024, 0, 1)) });
}

/** A minimal styles.xml body with the given number formats (id -> code) and cellXfs (numFmtId per xf). */
export function numFmtStyles(custom: Record<number, string>, xfNumFmts: number[]): string {
  const nf = Object.entries(custom).map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join("");
  return (
    (nf ? `<numFmts count="${Object.keys(custom).length}">${nf}</numFmts>` : "") +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellXfs count="${xfNumFmts.length}">${xfNumFmts.map((id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0"/>`).join("")}</cellXfs>`
  );
}
