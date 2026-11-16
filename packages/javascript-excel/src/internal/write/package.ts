/**
 * The OPC package: which parts exist, their content types and the
 * relationships between them.
 *
 * Parts register themselves here instead of being hard-coded into
 * [Content_Types].xml and the .rels files, so later features (comments,
 * drawings and images, tables, preserved unknown parts) can add parts and
 * relationships without touching the existing ones.
 */

import { XML_DECL, xmlAttr } from "../xml";

const NS_CONTENT_TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";

/** Relationship types used by the writer. */
type RelTypeName = "officeDocument" | "coreProperties" | "extendedProperties" | "customProperties" | "worksheet" | "theme" | "styles" | "sharedStrings" | "hyperlink";
type ContentTypeName = "relationships" | "xml" | "workbook" | "worksheet" | "theme" | "styles" | "sharedStrings" | "coreProperties" | "extendedProperties" | "customProperties";

export const REL_TYPE: Readonly<Record<RelTypeName, string>> = {
  officeDocument: `${REL}/officeDocument`,
  coreProperties: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  extendedProperties: `${REL}/extended-properties`,
  customProperties: `${REL}/custom-properties`,
  worksheet: `${REL}/worksheet`,
  theme: `${REL}/theme`,
  styles: `${REL}/styles`,
  sharedStrings: `${REL}/sharedStrings`,
  hyperlink: `${REL}/hyperlink`,
};

/** Content types used by the writer. */
export const CONTENT_TYPE: Readonly<Record<ContentTypeName, string>> = {
  relationships: "application/vnd.openxmlformats-package.relationships+xml",
  xml: "application/xml",
  workbook: `${CT}.spreadsheetml.sheet.main+xml`,
  worksheet: `${CT}.spreadsheetml.worksheet+xml`,
  theme: `${CT}.theme+xml`,
  styles: `${CT}.spreadsheetml.styles+xml`,
  sharedStrings: `${CT}.spreadsheetml.sharedStrings+xml`,
  coreProperties: "application/vnd.openxmlformats-package.core-properties+xml",
  extendedProperties: `${CT}.extended-properties+xml`,
  customProperties: `${CT}.custom-properties+xml`,
};

interface Rel {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

/** One .rels part. Ids are allocated in order (rId1, rId2, ...); an identical relationship is reused. */
export class Rels {
  private readonly rels: Rel[] = [];

  add(type: string, target: string, external = false): string {
    const found = this.rels.find((r) => r.type === type && r.target === target && r.external === external);
    if (found) return found.id;
    const id = `rId${this.rels.length + 1}`;
    this.rels.push({ id, type, target, external });
    return id;
  }

  get size(): number {
    return this.rels.length;
  }

  /** The .rels XML, or undefined when there are no relationships. */
  xml(): string | undefined {
    if (this.rels.length === 0) return undefined;
    let x = `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">`;
    for (const r of this.rels) {
      x += `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlAttr(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`;
    }
    return `${x}</Relationships>`;
  }
}

/** Content types plus the package-level and workbook-level relationships. */
export class PackageParts {
  private readonly defaults = new Map<string, string>([
    ["rels", CONTENT_TYPE.relationships],
    ["xml", CONTENT_TYPE.xml],
  ]);
  private readonly overrides = new Map<string, string>();
  /** _rels/.rels */
  readonly root: Rels = new Rels();
  /** xl/_rels/workbook.xml.rels */
  readonly workbook: Rels = new Rels();

  /** A content type for every part with this extension (e.g. 'png' for images). */
  addDefault(extension: string, contentType: string): void {
    this.defaults.set(extension.toLowerCase(), contentType);
  }

  /** A content type for one part, by its package path without a leading '/' ('xl/styles.xml'). */
  addOverride(partName: string, contentType: string): void {
    this.overrides.set(`/${partName}`, contentType);
  }

  contentTypesXml(): string {
    let x = `${XML_DECL}<Types xmlns="${NS_CONTENT_TYPES}">`;
    for (const [ext, ct] of this.defaults) x += `<Default Extension="${xmlAttr(ext)}" ContentType="${xmlAttr(ct)}"/>`;
    for (const [part, ct] of this.overrides) x += `<Override PartName="${xmlAttr(part)}" ContentType="${xmlAttr(ct)}"/>`;
    return `${x}</Types>`;
  }
}
