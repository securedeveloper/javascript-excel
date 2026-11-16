/**
 * Package-level parts: content types, relationships, workbook.xml, document
 * properties and the default theme (docs/api.md §5.1).
 */

import { ValidationError } from "../../errors";
import type { DefinedName, DocProperties } from "../../model";
import type { BuiltinName } from "./sheet-features";
import { num, XML_DECL, xmlAttr, xmlText, xstring } from "../xml";

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";

export interface PackagePlan {
  sheetCount: number;
  sharedStrings: boolean;
  customProperties: boolean;
}

export function contentTypesXml(p: PackagePlan): string {
  let x =
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="${CT}.spreadsheetml.sheet.main+xml"/>`;
  for (let i = 1; i <= p.sheetCount; i++) {
    x += `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="${CT}.spreadsheetml.worksheet+xml"/>`;
  }
  x +=
    `<Override PartName="/xl/theme/theme1.xml" ContentType="${CT}.theme+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="${CT}.spreadsheetml.styles+xml"/>`;
  if (p.sharedStrings) x += `<Override PartName="/xl/sharedStrings.xml" ContentType="${CT}.spreadsheetml.sharedStrings+xml"/>`;
  x +=
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="${CT}.extended-properties+xml"/>`;
  if (p.customProperties) x += `<Override PartName="/docProps/custom.xml" ContentType="${CT}.custom-properties+xml"/>`;
  return `${x}</Types>`;
}

export function rootRelsXml(p: PackagePlan): string {
  let x =
    `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>`;
  if (p.customProperties) x += `<Relationship Id="rId4" Type="${REL}/custom-properties" Target="docProps/custom.xml"/>`;
  return `${x}</Relationships>`;
}

export function workbookRelsXml(p: PackagePlan): string {
  let x = `${XML_DECL}<Relationships xmlns="${NS_PKG_REL}">`;
  for (let i = 1; i <= p.sheetCount; i++) {
    x += `<Relationship Id="rId${i}" Type="${REL}/worksheet" Target="worksheets/sheet${i}.xml"/>`;
  }
  const n = p.sheetCount;
  x +=
    `<Relationship Id="rId${n + 1}" Type="${REL}/theme" Target="theme/theme1.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="${REL}/styles" Target="styles.xml"/>`;
  if (p.sharedStrings) x += `<Relationship Id="rId${n + 3}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`;
  return `${x}</Relationships>`;
}

export interface WorkbookPlan {
  sheets: Array<{ name: string; state: "visible" | "hidden" | "veryHidden" }>;
  activeSheet: number;
  date1904: boolean;
  fullCalcOnLoad: boolean;
  /** Validated <definedName> elements (see definedNamesXml). */
  definedNames: string;
}

export function workbookXml(w: WorkbookPlan): string {
  let x =
    `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    (w.date1904 ? '<workbookPr date1904="1"/>' : "<workbookPr/>") +
    `<bookViews><workbookView${w.activeSheet > 0 ? ` activeTab="${w.activeSheet}"` : ""}/></bookViews><sheets>`;
  w.sheets.forEach((s, i) => {
    const state = s.state === "visible" ? "" : ` state="${s.state}"`;
    x += `<sheet name="${xmlAttr(s.name)}" sheetId="${i + 1}"${state} r:id="rId${i + 1}"/>`;
  });
  x += "</sheets>";
  if (w.definedNames) x += w.definedNames;
  if (w.fullCalcOnLoad) x += '<calcPr fullCalcOnLoad="1"/>';
  return `${x}</workbook>`;
}

// ------------------------------------------------------------- properties

function propertyError(message: string, details: Record<string, unknown>): ValidationError {
  return new ValidationError("INVALID_PROPERTY", message, { details });
}

/** W3CDTF timestamp without milliseconds, as Excel writes. */
function w3cdtf(d: Date, field: string): string {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) {
    throw propertyError(`Document property ${field} must be a valid Date.`, { property: field });
  }
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function optString(props: DocProperties, key: keyof DocProperties): string | undefined {
  const v = props[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw propertyError(`Document property ${key} must be a string.`, { property: key });
  return v;
}

export function coreXml(props: DocProperties, now: Date): string {
  const el = (tag: string, key: keyof DocProperties): string => {
    const v = optString(props, key);
    return v === undefined ? "" : `<${tag}>${xmlText(v)}</${tag}>`;
  };
  return (
    `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    el("dc:title", "title") +
    el("dc:subject", "subject") +
    el("dc:creator", "creator") +
    el("cp:keywords", "keywords") +
    el("dc:description", "description") +
    el("cp:lastModifiedBy", "lastModifiedBy") +
    el("cp:category", "category") +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${w3cdtf(props.created ?? now, "created")}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${w3cdtf(props.modified ?? now, "modified")}</dcterms:modified>` +
    "</cp:coreProperties>"
  );
}

export function appXml(props: DocProperties): string {
  const el = (tag: string, key: keyof DocProperties, fallback?: string): string => {
    const v = optString(props, key) ?? fallback;
    return v === undefined ? "" : `<${tag}>${xmlText(v)}</${tag}>`;
  };
  return (
    `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    el("Application", "application", "javascript-excel") +
    el("Manager", "manager") +
    el("Company", "company") +
    "</Properties>"
  );
}

/** FMTID_UserDefinedProperties, required on every custom property. */
const FMTID_USER = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";

export function customXml(custom: NonNullable<DocProperties["custom"]>): string {
  const seen = new Set<string>();
  let x =
    `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`;
  custom.forEach((p, i) => {
    if (typeof p?.name !== "string" || p.name.length === 0 || p.name.length > 255) {
      throw propertyError("Custom property names must be 1 to 255 characters.", { index: i });
    }
    const key = p.name.toLowerCase();
    if (seen.has(key)) throw propertyError(`Duplicate custom property ${p.name}.`, { property: p.name });
    seen.add(key);
    const v = p.value;
    let typed: string;
    if (typeof v === "string") typed = `<vt:lpwstr>${xmlText(v)}</vt:lpwstr>`;
    else if (typeof v === "boolean") typed = `<vt:bool>${v ? "true" : "false"}</vt:bool>`;
    else if (typeof v === "number") {
      if (!Number.isFinite(v)) throw propertyError(`Custom property ${p.name} must be a finite number.`, { property: p.name });
      typed = Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? `<vt:i4>${v}</vt:i4>` : `<vt:r8>${num(v)}</vt:r8>`;
    } else if (v instanceof Date) typed = `<vt:filetime>${w3cdtf(v, p.name)}</vt:filetime>`;
    else throw propertyError(`Custom property ${p.name} has an unsupported value.`, { property: p.name });
    x += `<property fmtid="${FMTID_USER}" pid="${i + 2}" name="${xmlAttr(p.name)}">${typed}</property>`;
  });
  return `${x}</Properties>`;
}

// ------------------------------------------------------------------ theme

/**
 * A minimal, schema-complete DrawingML theme with the Office 2013–2022 colour
 * scheme and Calibri / Calibri Light fonts, so `{ theme: n }` colours resolve
 * to the colours users expect. The format scheme is the simplest valid one.
 */
export const THEME_XML: string =
  `${XML_DECL}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements>` +
  '<a:clrScheme name="Office">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
  '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
  '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
  '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
  "</a:clrScheme>" +
  '<a:fontScheme name="Office">' +
  '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
  "</a:fontScheme>" +
  '<a:fmtScheme name="Office">' +
  "<a:fillStyleLst>" +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) +
  "</a:fillStyleLst>" +
  "<a:lnStyleLst>" +
  '<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  "</a:lnStyleLst>" +
  "<a:effectStyleLst>" +
  "<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3) +
  "</a:effectStyleLst>" +
  "<a:bgFillStyleLst>" +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) +
  "</a:bgFillStyleLst>" +
  "</a:fmtScheme></a:themeElements></a:theme>";

// ---------------------------------------------------------- defined names

function nameError(message: string, details: Record<string, unknown>): ValidationError {
  return new ValidationError("INVALID_DEFINED_NAME", message, { details });
}

// Excel's rules: start with a letter, '_' or '\'; then letters, digits, '.', '_', '\' or '?';
// at most 255 characters; not a cell reference; not R/C on their own or an R1C1 reference.
const NAME_RE = /^[\p{L}_\\][\p{L}\p{N}_.\\?]*$/u;
const A1_LIKE = /^\$?([A-Za-z]{1,3})\$?([0-9]+)$/;
const R1C1_LIKE = /^[Rr]([0-9]*)([Cc]([0-9]*))?$|^[Cc][0-9]*$/;

function isCellLike(name: string): boolean {
  const m = A1_LIKE.exec(name);
  if (!m) return false;
  const letters = m[1]!.toUpperCase();
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number(m[2]);
  return col <= 16384 && row >= 1 && row <= 1_048_576;
}

/**
 * Validates user defined names and adds the built-in ones the sheets imply
 * (autofilter database, print area, print titles). Names are unique per scope,
 * case-insensitively. Returns the <definedNames> element, or ''.
 */
export function definedNamesXml(user: DefinedName[] | undefined, builtins: BuiltinName[], sheetCount: number): string {
  const seen = new Set<string>();
  const items: string[] = [];
  const scopeKey = (name: string, sheet: number | undefined): string => `${sheet ?? "wb"}\u0000${name.toLowerCase()}`;
  if (user !== undefined && !Array.isArray(user)) throw nameError("definedNames must be an array.", {});
  (user ?? []).forEach((d, i) => {
    if (typeof d !== "object" || d === null) throw nameError(`definedNames[${i}] must be an object.`, { index: i });
    const { name } = d;
    if (typeof name !== "string" || name.length === 0 || name.length > 255 || !NAME_RE.test(name) || isCellLike(name) || R1C1_LIKE.test(name)) {
      throw nameError(`Defined name ${JSON.stringify(name)} is not a valid Excel name (start with a letter, '_' or '\\'; letters, digits, '.', '_'; no spaces; not a cell reference).`, { index: i, name });
    }
    if (name.toLowerCase().startsWith("_xlnm.")) {
      throw nameError(`Defined name ${name} is reserved; set print.printArea, print.printTitles or autoFilter instead.`, { index: i, name });
    }
    if (d.sheet !== undefined && (!Number.isInteger(d.sheet) || d.sheet < 0 || d.sheet >= sheetCount)) {
      throw nameError(`Defined name ${name}: sheet ${String(d.sheet)} is not a sheet index.`, { index: i, name, sheet: d.sheet });
    }
    if (typeof d.ref !== "string" || d.ref.replace(/^=/, "").length === 0) {
      throw nameError(`Defined name ${name}: ref must be a non-empty formula such as "'Sheet 1'!$A$1".`, { index: i, name });
    }
    if (d.hidden !== undefined && typeof d.hidden !== "boolean") throw nameError(`Defined name ${name}: hidden must be a boolean.`, { index: i, name });
    if (d.comment !== undefined && typeof d.comment !== "string") throw nameError(`Defined name ${name}: comment must be a string.`, { index: i, name });
    const key = scopeKey(name, d.sheet);
    if (seen.has(key)) throw nameError(`Defined name ${name} is defined twice in the same scope.`, { index: i, name });
    seen.add(key);
    let attrs = ` name="${xmlAttr(name)}"`;
    if (d.comment) attrs += ` comment="${xmlAttr(d.comment)}"`;
    if (d.sheet !== undefined) attrs += ` localSheetId="${d.sheet}"`;
    if (d.hidden) attrs += ' hidden="1"';
    items.push(`<definedName${attrs}>${xstring(d.ref.replace(/^=/, ""))}</definedName>`);
  });
  for (const b of builtins) {
    items.push(`<definedName name="${b.name}" localSheetId="${b.sheet}"${b.hidden ? ' hidden="1"' : ""}>${xstring(b.ref)}</definedName>`);
  }
  return items.length ? `<definedNames>${items.join("")}</definedNames>` : "";
}
