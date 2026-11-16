/**
 * The xlsx-family reader behind javascript-excel/read (docs/api.md §5.2). Internal.
 */

import type { BinaryInput } from "../../binary";
import { FormatError } from "../../errors";
import type { Cell, DefinedName, DocProperties, RichText, Sheet, Workbook } from "../../model";
import type { ReadLimits, ReadOptions, ReadResult, SheetInfo } from "../../read";
import type { AbortSignalLike } from "../../signal";
import { toBytes } from "../input";
import { openZip } from "../zip/read";
import { ReadContext } from "./context";
import { ODS_MIME, OTHER_FORMATS, sniffContainer, WORKBOOK_FORMATS, workbookFormat, type FormatName, type WorkbookFormat } from "./formats";
import { DEFAULT_LIMITS } from "./limits";
import { Package, type Relationship } from "./opc";
import { MAX_ROWS, SheetParser } from "./sheet";
import { SharedStringsParser } from "./strings";
import { EMPTY_STYLES, StylesParser, type StyleTable } from "./styles";
import { CustomPropsParser, PropsParser, ThemeParser, WorkbookParser, type SheetEntry } from "./workbook";
import type { XmlHandler } from "./xml-reader";


/** Friendly names for parts the model does not represent, keyed by relationship kind. */
const UNSUPPORTED: ReadonlyMap<string, string> = new Map([
  ["drawing", "drawings (charts, images, shapes)"],
  ["vmlDrawing", "legacy drawings (VML)"],
  ["comments", "comments"],
  ["threadedComment", "threaded comments"],
  ["pivotTable", "pivot tables"],
  ["pivotCacheDefinition", "pivot caches"],
  ["table", "tables (ListObjects)"],
  ["oleObject", "embedded OLE objects"],
  ["ctrlProp", "form controls"],
  ["image", "images"],
  ["vbaProject", "VBA macros"],
  ["externalLink", "external links"],
  ["connections", "data connections"],
  ["queryTable", "query tables"],
  ["slicer", "slicers"],
  ["slicerCache", "slicer caches"],
  ["timeline", "timelines"],
  ["chartsheet", "chart sheets"],
  ["dialogsheet", "dialog sheets"],
  ["macrosheet", "macro sheets"],
]);

function unsupported(format: string, message: string): FormatError {
  return new FormatError("UNSUPPORTED_FORMAT", message, { details: { format } });
}

function limitsOf(options: { limits?: Partial<ReadLimits> | undefined } | undefined): ReadLimits {
  const l: ReadLimits = { ...DEFAULT_LIMITS };
  const given = options?.limits;
  if (given) {
    for (const k of Object.keys(DEFAULT_LIMITS) as Array<keyof ReadLimits>) {
      const v = given[k];
      if (v === undefined) continue;
      if (typeof v !== "number" || !(v > 0)) throw new TypeError(`limits.${k} must be a positive number`);
      l[k] = v;
    }
  }
  return l;
}

function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) {
    if (signal.reason !== undefined) throw signal.reason;
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  }
}

/** Opens the package and finds the workbook part, rejecting formats the reader has no decoder for. */
async function openPackage(
  bytes: Uint8Array,
  limits: ReadLimits,
  ctxOf: (zip: ReturnType<typeof openZip>) => ReadContext,
): Promise<{ pkg: Package; workbookPart: string; format: WorkbookFormat }> {
  const container = sniffContainer(bytes);
  if (container === "cfb") throw unsupported("cfb", `This is a ${OTHER_FORMATS.cfb.label}. Only .xlsx-family files can be read.`);
  if (container !== "zip") throw unsupported("unknown", "The input is not an .xlsx file (no zip signature).");
  const ctx = ctxOf(openZipChecked(bytes, limits));
  const pkg = new Package(ctx);
  const mimetype = pkg.part("mimetype");
  if (mimetype && (await ctx.text(mimetype)).trim().startsWith(ODS_MIME)) {
    throw unsupported("ods", `This is an ${OTHER_FORMATS.ods.label}. Only .xlsx-family files can be read.`);
  }
  await pkg.loadContentTypes();
  const rels = await pkg.rels("");
  const office = rels.find((r) => r.kind === "officeDocument" && !r.external && pkg.part(r.target));
  if (!office) throw new FormatError("NOT_XLSX", "The zip has no workbook part (no officeDocument relationship).");
  const format = workbookFormat(pkg.contentType(office.target), office.target);
  if (!format.decoder) throw unsupported(format.format, `This is a ${format.label}, which this version cannot read.`);
  return { pkg, workbookPart: office.target, format };
}

function openZipChecked(bytes: Uint8Array, limits: ReadLimits): ReturnType<typeof openZip> {
  return openZip(bytes, {
    limits: {
      maxInputBytes: limits.maxInputBytes,
      maxEntries: limits.maxEntries,
      maxEntryBytes: limits.maxEntryBytes,
      maxTotalBytes: limits.maxTotalBytes,
      maxRatio: limits.maxRatio,
    },
  });
}

async function parseWorkbook(pkg: Package, part: string): Promise<WorkbookParser> {
  const wb = new WorkbookParser();
  await pkg.ctx.parse(pkg.part(part)!, wb);
  return wb;
}

/** Detects the file format from the bytes. Never throws for unreadable input. */
export async function detectFormatImpl(bytes: Uint8Array): Promise<FormatName> {
  const container = sniffContainer(bytes);
  if (container !== "zip") return container;
  try {
    const ctx = new ReadContext(openZipChecked(bytes, DEFAULT_LIMITS), DEFAULT_LIMITS, undefined, undefined, undefined);
    const pkg = new Package(ctx);
    const mimetype = pkg.part("mimetype");
    if (mimetype && (await ctx.text(mimetype)).trim().startsWith(ODS_MIME)) return "ods";
    if (!pkg.part("[Content_Types].xml")) return "zip";
    await pkg.loadContentTypes();
    const rels = await pkg.rels("");
    const office = rels.find((r) => r.kind === "officeDocument" && !r.external && pkg.part(r.target));
    if (office) return workbookFormat(pkg.contentType(office.target), office.target).format;
    // No package relationships: fall back to the content types alone.
    for (const t of pkg.overrideTypes) {
      const f = WORKBOOK_FORMATS.find((w) => w.contentType === t);
      if (f) return f.format;
    }
    return "zip";
  } catch {
    return "zip";
  }
}

/** Lists the worksheets (name, index, visibility) without parsing any sheet. */
export async function readSheetNamesImpl(
  bytes: Uint8Array,
  options?: { limits?: Partial<ReadLimits> | undefined; signal?: AbortSignalLike | undefined },
): Promise<SheetInfo[]> {
  const limits = limitsOf(options);
  throwIfAborted(options?.signal);
  const { pkg, workbookPart } = await openPackage(bytes, limits, (zip) => new ReadContext(zip, limits, options?.signal, undefined, undefined));
  const wb = await parseWorkbook(pkg, workbookPart);
  const rels = await pkg.rels(workbookPart);
  return worksheetsOf(wb.sheets, rels).map((s, index) => ({ name: s.entry.name, index, state: s.entry.state }));
}

function worksheetsOf(sheets: SheetEntry[], rels: Relationship[]): Array<{ entry: SheetEntry; rel: Relationship | undefined; bookIndex: number }> {
  const out: Array<{ entry: SheetEntry; rel: Relationship | undefined; bookIndex: number }> = [];
  sheets.forEach((entry, bookIndex) => {
    const rel = entry.relId ? rels.find((r) => r.id === entry.relId) : undefined;
    if (rel && rel.kind !== "worksheet") return; // chart, dialog and macro sheets are not worksheets
    out.push({ entry, rel, bookIndex });
  });
  return out;
}

/** Internal options, not part of the public API yet. */
export interface InternalReadOptions {
  /**
   * Keep the bytes of every part the reader did not parse (drawings, comments,
   * VBA, custom XML, ...), keyed by part name, so a later writer can carry
   * them through unchanged. Counted against the zip limits like any read.
   */
  retainParts?: boolean;
}

export interface InternalReadResult extends ReadResult {
  /** Unparsed parts, with `retainParts`. */
  parts?: Map<string, Uint8Array>;
}

/** Reads an .xlsx-family file into the model. */
export async function readImpl(input: BinaryInput, options?: ReadOptions, internal?: InternalReadOptions): Promise<InternalReadResult> {
  const o = options ?? {};
  const limits = limitsOf(o);
  checkEnum("dates", o.dates, ["date", "serial"]);
  checkEnum("dateZone", o.dateZone, ["local", "utc"]);
  checkEnum("richText", o.richText, ["runs", "plain"]);
  if (o.maxRows !== undefined && (!Number.isInteger(o.maxRows) || o.maxRows < 0)) throw new TypeError(`maxRows must be a non-negative integer, got ${String(o.maxRows)}`);
  throwIfAborted(o.signal);
  const bytes = await toBytes(input, "read");
  throwIfAborted(o.signal);
  let ctx!: ReadContext;
  const { pkg, workbookPart, format } = await openPackage(bytes, limits, (zip) => {
    ctx = new ReadContext(zip, limits, o.signal, o.onWarning, o.onProgress);
    return ctx;
  });
  ctx.progress({ phase: "unzip", ratio: 0.02 });

  const wbp = await parseWorkbook(pkg, workbookPart);
  const wbRels = await pkg.rels(workbookPart);
  const seen = new Set<string>();
  const warnUnsupported = (rels: Relationship[], part: string): void => {
    for (const r of rels) {
      const what = UNSUPPORTED.get(r.kind);
      if (what && !seen.has(r.kind)) {
        seen.add(r.kind);
        ctx.warn("UNSUPPORTED_PART", `The workbook contains ${what}, which are not read.`, { part: r.external ? part : r.target });
      }
    }
  };
  if (format.macros) {
    seen.add("vbaProject");
    ctx.warn("UNSUPPORTED_PART", `The workbook is a ${format.label}; its VBA macros are not read or run.`, { part: workbookPart });
  }
  warnUnsupported(wbRels, workbookPart);

  // Styles, theme, shared strings.
  const relOf = (kind: string): Relationship | undefined => wbRels.find((r) => r.kind === kind && !r.external);
  let styles: StyleTable = EMPTY_STYLES;
  const stylesRel = relOf("styles");
  if (stylesRel) {
    const entry = pkg.part(stylesRel.target);
    if (!entry) ctx.warn("MISSING_PART", `The styles part ${stylesRel.target} is missing; default styles were used.`, { part: stylesRel.target });
    else {
      const sp = new StylesParser(o.styles !== false);
      await ctx.parse(entry, sp);
      styles = sp.result();
    }
  }
  ctx.progress({ phase: "styles", ratio: 0.05 });

  let theme: Workbook["theme"];
  const themeRel = relOf("theme");
  if (themeRel && o.styles !== false) {
    const entry = pkg.part(themeRel.target);
    if (!entry) ctx.warn("MISSING_PART", `The theme part ${themeRel.target} is missing; the default theme applies.`, { part: themeRel.target });
    else {
      const tp = new ThemeParser();
      if (await optional(ctx, entry.name, () => ctx.parse(entry, tp))) theme = tp.result();
    }
  }

  let sst: Array<string | RichText> = [];
  const sstRel = relOf("sharedStrings");
  if (sstRel) {
    const entry = pkg.part(sstRel.target);
    if (!entry) ctx.warn("MISSING_PART", `The shared strings part ${sstRel.target} is missing; cells that use it are empty.`, { part: sstRel.target });
    else {
      const sp = new SharedStringsParser(o.richText ?? "runs", limits.maxSharedStrings);
      await ctx.parse(entry, sp);
      sst = sp.strings;
    }
  }

  const properties = await readProperties(pkg, ctx);

  // Sheets.
  const listed = worksheetsOf(wbp.sheets, wbRels);
  for (const s of wbp.sheets) {
    const rel = s.relId ? wbRels.find((r) => r.id === s.relId) : undefined;
    if (rel && rel.kind !== "worksheet") warnUnsupported([rel], workbookPart);
  }
  const wanted = selector(o.sheets);
  const totalBytes = listed.reduce((n, s) => n + (s.rel && wanted(s.entry.name, listed.indexOf(s)) ? (pkg.part(s.rel.target)?.size ?? 0) : 0), 0) || 1;
  let doneBytes = 0;
  const sheets: Array<Sheet<Cell>> = [];
  for (let i = 0; i < listed.length; i++) {
    const { entry, rel } = listed[i]!;
    const parser = new SheetParser(entry.name, entry.state, ctx, styles, {
      formulas: o.formulas !== false,
      dates: o.dates ?? "date",
      dateZone: o.dateZone ?? "local",
      richText: o.richText ?? "runs",
      date1904: wbp.date1904,
      maxRows: o.maxRows ?? MAX_ROWS,
    }, rel?.target ?? workbookPart);
    parser.sharedStrings = sst;
    const part = rel ? pkg.part(rel.target) : undefined;
    if (!part) {
      ctx.warn("MISSING_PART", `The part for sheet "${entry.name}" is missing; the sheet is empty.`, { sheet: entry.name });
      sheets.push(parser.finish([]));
      continue;
    }
    if (!wanted(entry.name, i)) {
      sheets.push(parser.finish([]));
      continue;
    }
    const sheetRels = await pkg.rels(part.name);
    warnUnsupported(sheetRels, part.name);
    const base = doneBytes;
    ctx.progress({ phase: "parse", sheet: entry.name, ratio: 0.1 + 0.9 * (base / totalBytes) });
    let read = 0;
    await ctx.parse(part, parser, (n) => {
      read += n;
      ctx.progress({ phase: "parse", sheet: entry.name, ratio: 0.1 + 0.9 * (Math.min(base + read, totalBytes) / totalBytes) });
    });
    doneBytes += part.size;
    sheets.push(parser.finish(sheetRels));
  }

  // Defined names: print areas and titles go to their sheets; the rest stay workbook names.
  const bookToSheet = new Map<number, number>();
  listed.forEach((s, i) => bookToSheet.set(s.bookIndex, i));
  const definedNames: DefinedName[] = [];
  for (const d of wbp.definedNames) {
    const local = d.sheet === undefined ? undefined : bookToSheet.get(d.sheet);
    if (d.sheet !== undefined && local === undefined) continue; // refers to a sheet that is not a worksheet
    const sheet = local === undefined ? undefined : sheets[local];
    if (d.name === "_xlnm._FilterDatabase") continue; // implied by sheet.autoFilter
    if (sheet && d.name === "_xlnm.Print_Area") {
      (sheet.print ??= {}).printArea = refsOnly(d.ref);
      continue;
    }
    if (sheet && d.name === "_xlnm.Print_Titles") {
      const titles: { rows?: string; cols?: string } = {};
      for (const part of refsOnly(d.ref).split(",")) {
        if (/^\d+:\d+$/.test(part)) titles.rows = part;
        else if (/^[A-Za-z]+:[A-Za-z]+$/.test(part)) titles.cols = part;
      }
      if (Object.keys(titles).length) (sheet.print ??= {}).printTitles = titles;
      continue;
    }
    const out: DefinedName = { ...d };
    if (local === undefined) delete out.sheet;
    else out.sheet = local;
    definedNames.push(out);
  }

  const workbook: Workbook<Cell> = { sheets };
  if (wbp.activeTab !== undefined) {
    const active = bookToSheet.get(wbp.activeTab);
    if (active !== undefined && active !== 0) workbook.activeSheet = active;
  }
  if (wbp.date1904) workbook.date1904 = true;
  if (properties) workbook.properties = properties;
  if (definedNames.length) workbook.definedNames = definedNames;
  if (theme) workbook.theme = theme;
  if (styles.indexedColors) workbook.indexedColors = styles.indexedColors;
  if (wbp.fullCalcOnLoad !== undefined) workbook.calc = { fullCalcOnLoad: wbp.fullCalcOnLoad };
  const result: InternalReadResult = { workbook, warnings: ctx.warnings };
  if (internal?.retainParts) {
    const parts = new Map<string, Uint8Array>();
    for (const name of pkg.partNames) {
      if (ctx.consumed.has(name)) continue;
      parts.set(name, await ctx.zip.read(name, o.signal));
    }
    result.parts = parts;
  }
  ctx.progress({ phase: "parse", ratio: 1 });
  return result;
}

function checkEnum(name: string, v: unknown, allowed: string[]): void {
  if (v !== undefined && !allowed.includes(v as string)) throw new TypeError(`${name} must be one of ${allowed.map((a) => `'${a}'`).join(", ")}`);
}

function selector(sheets: Array<string | number> | undefined): (name: string, index: number) => boolean {
  if (!sheets) return () => true;
  if (!Array.isArray(sheets)) throw new TypeError("sheets must be an array of names or indices");
  const byName = new Set<string>();
  const byIndex = new Set<number>();
  for (const s of sheets) {
    if (typeof s === "number") byIndex.add(s);
    else if (typeof s === "string") byName.add(s.toLowerCase());
    else throw new TypeError("sheets must contain names or indices");
  }
  return (name, index) => byIndex.has(index) || byName.has(name.toLowerCase());
}

/** "'My Sheet'!$A$1:$F$40" -> "A1:F40"; several areas keep their commas. */
function refsOnly(ref: string): string {
  return ref
    .split(",")
    .map((p) => {
      const bang = p.lastIndexOf("!");
      return (bang === -1 ? p : p.slice(bang + 1)).replace(/\$/g, "").trim();
    })
    .join(",");
}

/** Parses an optional part; on a format problem, warns BROKEN_OPTIONAL_PART and returns false. */
async function optional(ctx: ReadContext, part: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    if (err instanceof FormatError && err.code === "XML_MALFORMED") {
      ctx.warn("BROKEN_OPTIONAL_PART", `${part} is not well-formed XML and was skipped.`, { part });
      return false;
    }
    throw err;
  }
}

async function readProperties(pkg: Package, ctx: ReadContext): Promise<DocProperties | undefined> {
  const rels = await pkg.rels("");
  const props: DocProperties = {};
  for (const kind of ["core-properties", "metadata/core-properties", "extended-properties"]) {
    const rel = rels.find((r) => (r.kind === kind || r.type.endsWith(`/${kind}`)) && !r.external);
    const entry = rel ? pkg.part(rel.target) : undefined;
    if (!entry) continue;
    const handler: XmlHandler = new PropsParser(props);
    await optional(ctx, entry.name, () => ctx.parse(entry, handler));
  }
  const customRel = rels.find((r) => r.kind === "custom-properties" && !r.external);
  const custom = customRel ? pkg.part(customRel.target) : undefined;
  if (custom) {
    const cp = new CustomPropsParser();
    if (await optional(ctx, custom.name, () => ctx.parse(custom, cp)) && cp.items.length) props.custom = cp.items;
  }
  return Object.keys(props).length ? props : undefined;
}
