/**
 * javascript-excel/read: the xlsx reader (docs/api.md §5.2, §8).
 *
 * Parts are found through relationships, never by fixed path; each part is
 * inflated and streamed through the XML tokenizer; zip limits are counted on
 * the inflated bytes. ISO/IEC 29500 Strict files read like transitional ones,
 * because the tokenizer ignores namespace prefixes and relationship types
 * are matched by their last path segment, which both variants share.
 */

import type { BinaryInput } from "./binary";
import type { AbortSignalLike } from "./signal";
import type { Progress } from "./write";
import { FormatError } from "./errors";
import { toBytes } from "./internal/input";
import { ReadContext } from "./internal/read/context";
import { Package, type Relationship } from "./internal/read/opc";
import { SheetParser } from "./internal/read/sheet";
import { SharedStringsParser } from "./internal/read/strings";
import { EMPTY_STYLES, StylesParser, type StyleTable } from "./internal/read/styles";
import { CustomPropsParser, PropsParser, ThemeParser, WorkbookParser, type SheetEntry } from "./internal/read/workbook";
import type { XmlHandler } from "./internal/read/xml-reader";
import { openZip } from "./internal/zip/read";
import type { Cell, DefinedName, DocProperties, RichText, Sheet, Workbook } from "./model";
import type { ExcelWarning } from "./warnings";

export type { BinaryInput, BlobLike, BlobType } from "./binary";
export type { AbortSignalLike } from "./signal";
export type { Progress } from "./write";
export type { ExcelWarning, ExcelWarningCode } from "./warnings";
export type {
  Alignment,
  Border,
  BorderSide,
  BorderStyle,
  Cell,
  CellErrorValue,
  CellInput,
  CellType,
  CellValue,
  Color,
  ColumnProps,
  ColumnWidth,
  DefinedName,
  DocProperties,
  ErrorCode,
  Fill,
  Font,
  GradientFill,
  Hyperlink,
  NumFmt,
  PatternFill,
  PatternType,
  PrintSetup,
  RichText,
  RichTextRun,
  RowProps,
  Sheet,
  SheetView,
  Style,
  Theme,
  Workbook,
} from "./model";

/** Result of `read`. */
export interface ReadResult {
  workbook: Workbook<Cell>;
  warnings: ExcelWarning[];
}

/** Options for `read`. */
export interface ReadOptions {
  /** Only parse these sheets (by name or index); the others are listed with empty rows. Default: all. */
  sheets?: Array<string | number> | undefined;
  /** Parse styles (default true). false is faster: no `cell.style`, but date detection still uses the number format. */
  styles?: boolean | undefined;
  /** Return formula text (default true). false: cached values only. */
  formulas?: boolean | undefined;
  /** `'date'` (default): date-formatted numbers become `Date`. `'serial'`: leave them as numbers. */
  dates?: "date" | "serial" | undefined;
  /** Default `'local'`. */
  dateZone?: "local" | "utc" | undefined;
  /** Rich text as runs (default) or flattened to a plain string. */
  richText?: "runs" | "plain" | undefined;
  limits?: Partial<ReadLimits> | undefined;
  /** Rejects with `signal.reason` when aborted. */
  signal?: AbortSignalLike | undefined;
  onProgress?: ((p: Progress) => void) | undefined;
  /** Called as warnings occur, in addition to `ReadResult.warnings`. */
  onWarning?: ((w: ExcelWarning) => void) | undefined;
}

/** Limits for untrusted input. Exceeding one throws `LimitError` (`LIMIT_EXCEEDED`, `details.limit` names it). */
export interface ReadLimits {
  maxInputBytes: number;
  maxEntries: number;
  /** Decompressed bytes of one part. */
  maxEntryBytes: number;
  /** Decompressed bytes of all parts read. */
  maxTotalBytes: number;
  /** Decompressed / compressed, per entry, checked once an entry has produced more than 1 MiB. */
  maxRatio: number;
  maxXmlDepth: number;
  /** All sheets together. */
  maxCells: number;
  maxSharedStrings: number;
  /** Then a single `WARNINGS_TRUNCATED`. */
  maxWarnings: number;
}

/** Default limits (docs/api.md §5.2; the measurements behind each value are listed there). */
export const DEFAULT_READ_LIMITS: Readonly<ReadLimits> = Object.freeze({
  maxInputBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxRatio: 1000,
  maxXmlDepth: 64,
  maxCells: 10_000_000,
  maxSharedStrings: 5_000_000,
  maxWarnings: 1000,
});

/** A sheet as listed by `readSheetNames`. */
export interface SheetInfo {
  name: string;
  index: number;
  state: "visible" | "hidden" | "veryHidden";
}

/** What `detectFormat` recognises. `'cfb'` is a legacy `.xls` or an encrypted OOXML file. */
export type DetectedFormat = "xlsx" | "xlsm" | "xlsb" | "ods" | "cfb" | "zip" | "unknown";

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";

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

function isCfb(b: Uint8Array): boolean {
  return CFB_MAGIC.every((x, i) => b[i] === x);
}

function isZip(b: Uint8Array): boolean {
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);
}

function unsupported(format: string, message: string): FormatError {
  return new FormatError("UNSUPPORTED_FORMAT", message, { details: { format } });
}

function limitsOf(options: { limits?: Partial<ReadLimits> | undefined } | undefined): ReadLimits {
  const l: ReadLimits = { ...DEFAULT_READ_LIMITS };
  const given = options?.limits;
  if (given) {
    for (const k of Object.keys(DEFAULT_READ_LIMITS) as Array<keyof ReadLimits>) {
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

/** Opens the package and finds the workbook part, rejecting formats the reader does not read. */
async function openPackage(
  bytes: Uint8Array,
  limits: ReadLimits,
  ctxOf: (zip: ReturnType<typeof openZip>) => ReadContext,
): Promise<{ pkg: Package; workbookPart: string }> {
  if (isCfb(bytes)) {
    throw unsupported("cfb", "This is a legacy .xls file or a password-protected (encrypted) workbook. Only .xlsx files can be read.");
  }
  if (!isZip(bytes)) throw unsupported("unknown", "The input is not an .xlsx file (no zip signature).");
  const ctx = ctxOf(openZipChecked(bytes, limits));
  const pkg = new Package(ctx);
  const mimetype = pkg.part("mimetype");
  if (mimetype && (await ctx.text(mimetype)).trim().startsWith(ODS_MIME)) {
    throw unsupported("ods", "This is an OpenDocument spreadsheet (.ods). Only .xlsx files can be read.");
  }
  await pkg.loadContentTypes();
  const rels = await pkg.rels("");
  const office = rels.find((r) => r.kind === "officeDocument" && !r.external && pkg.part(r.target));
  if (!office) throw new FormatError("NOT_XLSX", "The zip has no workbook part (no officeDocument relationship).");
  const type = pkg.contentType(office.target) ?? "";
  if (type.includes("binary") || office.target.toLowerCase().endsWith(".bin")) {
    throw unsupported("xlsb", "This is a binary workbook (.xlsb). Only .xlsx files can be read.");
  }
  return { pkg, workbookPart: office.target };
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

/** Detects the file format from the bytes. Never throws for unreadable input; returns `'unknown'` instead. */
export async function detectFormat(input: BinaryInput): Promise<DetectedFormat> {
  const bytes = await toBytes(input, "detectFormat");
  if (isCfb(bytes)) return "cfb";
  if (!isZip(bytes)) return "unknown";
  try {
    const ctx = new ReadContext(openZipChecked(bytes, DEFAULT_READ_LIMITS), DEFAULT_READ_LIMITS, undefined, undefined, undefined);
    const pkg = new Package(ctx);
    const mimetype = pkg.part("mimetype");
    if (mimetype && (await ctx.text(mimetype)).trim().startsWith(ODS_MIME)) return "ods";
    if (!pkg.part("[Content_Types].xml")) return "zip";
    await pkg.loadContentTypes();
    const types = pkg.overrideTypes.join(" ");
    if (types.includes("application/vnd.ms-excel.sheet.binary.macroEnabled.main")) return "xlsb";
    if (types.includes("application/vnd.ms-excel.sheet.macroEnabled.main+xml") || types.includes("application/vnd.ms-excel.template.macroEnabled.main+xml")) return "xlsm";
    if (types.includes("spreadsheetml.sheet.main+xml") || types.includes("spreadsheetml.template.main+xml")) return "xlsx";
    const rels = await pkg.rels("");
    const office = rels.find((r) => r.kind === "officeDocument" && pkg.part(r.target));
    if (office) return office.target.toLowerCase().endsWith(".bin") ? "xlsb" : "xlsx";
    return "zip";
  } catch {
    return "zip";
  }
}

/** Lists the worksheets (name, index, visibility) without parsing any sheet. */
export async function readSheetNames(
  input: BinaryInput,
  options?: { limits?: Partial<ReadLimits> | undefined; signal?: AbortSignalLike | undefined },
): Promise<SheetInfo[]> {
  const limits = limitsOf(options);
  throwIfAborted(options?.signal);
  const bytes = await toBytes(input, "readSheetNames");
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

/** Reads an .xlsx file into the model. */
export async function read(input: BinaryInput, options?: ReadOptions): Promise<ReadResult> {
  const o = options ?? {};
  const limits = limitsOf(o);
  checkEnum("dates", o.dates, ["date", "serial"]);
  checkEnum("dateZone", o.dateZone, ["local", "utc"]);
  checkEnum("richText", o.richText, ["runs", "plain"]);
  throwIfAborted(o.signal);
  const bytes = await toBytes(input, "read");
  throwIfAborted(o.signal);
  let ctx!: ReadContext;
  const { pkg, workbookPart } = await openPackage(bytes, limits, (zip) => {
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
  ctx.progress({ phase: "parse", ratio: 1 });
  return { workbook, warnings: ctx.warnings };
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
