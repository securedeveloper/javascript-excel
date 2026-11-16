/**
 * Package-level parts: content types, relationships, workbook.xml, document
 * properties and the default theme (docs/api.md §5.1).
 */

import { ValidationError } from "../../errors";
import type { DocProperties } from "../../model";
import { num, XML_DECL, xmlAttr, xmlText } from "../xml";

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
