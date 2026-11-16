/**
 * xlsx writer (docs/api.md §5.1).
 *
 * Writes cells (strings, numbers, booleans, dates, errors, rich text,
 * formulas with cached values, styled empty cells), the full style model, the
 * workbook structure (sheet order, names, visibility, active sheet, 1904 dates,
 * default font) and document properties.
 */

import type { BlobType } from "./binary";
import { EnvironmentError, ValidationError } from "./errors";
import type { AbortSignalLike } from "./signal";
import type { Sheet, Workbook } from "./model";
import { throwIfAborted } from "./internal/zip/bytes";
import { writeZip, type ZipWriteEntry } from "./internal/zip/write";
import { encodeUtf8 } from "./internal/platform";
import {
  appXml,
  contentTypesXml,
  coreXml,
  customXml,
  rootRelsXml,
  THEME_XML,
  workbookRelsXml,
  definedNamesXml,
  workbookXml,
  type PackagePlan,
} from "./internal/write/parts";
import { planRowCount, planSheet, SharedStrings, sheetXml, type SheetPlan, type WriteContext } from "./internal/write/sheet";
import { hyperlinkSchemes } from "./internal/write/sheet-features";
import { StyleRegistry } from "./internal/write/style-registry";
import { validateSheetName, type SheetNameProblem } from "./sheet-names";

/** MIME type of an .xlsx file. */
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Progress of a write or read. */
export interface Progress {
  phase: "prepare" | "styles" | "sheets" | "zip" | "unzip" | "parse";
  sheet?: string | undefined;
  /** Overall progress estimate 0..1, non-decreasing. */
  ratio: number;
}

/** Options for toUint8Array and toBlob. */
export interface WriteOptions {
  /** 'deflate' (default) or 'store' (no compression; faster, bigger). */
  compression?: "deflate" | "store" | undefined;
  /** Shared strings table (default true) or inline strings (false). */
  sharedStrings?: boolean | undefined;
  /** Time zone used to turn Date into serials. Default 'local'. */
  dateZone?: "local" | "utc" | undefined;
  /** URL schemes allowed in external hyperlinks. Default ['http', 'https', 'mailto']. */
  hyperlinkSchemes?: string[] | undefined;
  signal?: AbortSignalLike | undefined;
  onProgress?: ((p: Progress) => void) | undefined;
}

/** Report progress at most once per this many rows. [placeholder, set in JSE-8] */
const PROGRESS_EVERY_ROWS = 1000;

const SHEET_NAME_PROBLEMS: Record<SheetNameProblem, string> = {
  empty: "must be a non-empty string",
  "too-long": "is longer than 31 characters",
  "forbidden-char": "contains one of \\ / ? * [ ] :",
  apostrophe: "starts or ends with an apostrophe",
  reserved: "'History' is reserved by Excel",
};

function checkSheetName(name: unknown, index: number): asserts name is string {
  const problem = typeof name === "string" ? validateSheetName(name) : "empty";
  if (problem) {
    throw new ValidationError("INVALID_SHEET_NAME", `Sheet ${index + 1} name ${JSON.stringify(name)} ${SHEET_NAME_PROBLEMS[problem]}.`, {
      details: { sheet: name, index, problem },
    });
  }
}

interface Plan {
  sheets: SheetPlan[];
  activeSheet: number;
  totalRows: number;
}

function planWorkbook(wb: Workbook, styles: StyleRegistry, schemes: ReadonlySet<string>): Plan {
  if (typeof wb !== "object" || wb === null || !Array.isArray(wb.sheets) || wb.sheets.length === 0) {
    throw new ValidationError("NO_SHEETS", "A workbook needs at least one sheet.");
  }
  const seen = new Map<string, number>();
  wb.sheets.forEach((sheet: Sheet, i) => {
    if (typeof sheet !== "object" || sheet === null) {
      throw new ValidationError("INVALID_SHEET_NAME", `Sheet ${i + 1} is not an object.`, { details: { index: i } });
    }
    checkSheetName(sheet.name, i);
    const key = sheet.name.toLowerCase();
    const prev = seen.get(key);
    if (prev !== undefined) {
      throw new ValidationError("DUPLICATE_SHEET_NAME", `Sheets ${prev + 1} and ${i + 1} are both named ${JSON.stringify(sheet.name)} (names are case-insensitive).`, {
        details: { sheet: sheet.name, index: i },
      });
    }
    seen.set(key, i);
    const state = sheet.state ?? "visible";
    if (state !== "visible" && state !== "hidden" && state !== "veryHidden") {
      throw new ValidationError("INVALID_SHEET_PROPERTY", `Sheet ${sheet.name}: state must be 'visible', 'hidden' or 'veryHidden'.`, {
        details: { sheet: sheet.name, path: "state", value: state },
      });
    }
  });
  const activeSheet = wb.activeSheet ?? 0;
  const active = wb.sheets[activeSheet];
  if (!Number.isInteger(activeSheet) || !active) {
    throw new ValidationError("INVALID_ACTIVE_SHEET", `activeSheet ${String(activeSheet)} is not a sheet index.`, { details: { activeSheet } });
  }
  if ((active.state ?? "visible") !== "visible") {
    throw new ValidationError("INVALID_ACTIVE_SHEET", `The active sheet ${JSON.stringify(active.name)} must be visible.`, { details: { activeSheet } });
  }
  const sheets = wb.sheets.map((s, i) => planSheet(s, i, i === activeSheet, styles, schemes));
  return { sheets, activeSheet, totalRows: sheets.reduce((n, p) => n + planRowCount(p), 0) };
}

/** Writes a workbook as .xlsx bytes. */
export async function toUint8Array(wb: Workbook, options: WriteOptions = {}): Promise<Uint8Array> {
  const { signal, onProgress } = options;
  throwIfAborted(signal);
  onProgress?.({ phase: "prepare", ratio: 0 });
  const styles = new StyleRegistry(wb.defaultFont);
  const plan = planWorkbook(wb, styles, hyperlinkSchemes(options.hyperlinkSchemes));
  const definedNames = definedNamesXml(
    wb.definedNames,
    plan.sheets.flatMap((p) => p.features.builtinNames),
    plan.sheets.length,
  );
  const props = wb.properties ?? {};
  const now = new Date();
  const modified = props.modified ?? now;
  const custom = props.custom ?? [];
  const sharedStrings = options.sharedStrings !== false;
  const pkg: PackagePlan = { sheetCount: plan.sheets.length, sharedStrings, customProperties: custom.length > 0 };

  // Properties first: they fail fast and are cheap.
  const core = coreXml(props, now);
  const app = appXml(props);
  const customPart = custom.length > 0 ? customXml(custom) : undefined;

  const ctx: WriteContext = {
    styles,
    strings: sharedStrings ? new SharedStrings() : undefined,
    date1904: wb.date1904 === true,
    dateZone: options.dateZone ?? "local",
    formulaWithoutValue: false,
  };

  let rowsDone = 0;
  let lastReported = 0;
  // Sheets take 90% of the estimate; the remaining parts and the zip directory the rest.
  const ratioOf = (): number => (plan.totalRows === 0 ? 0.9 : 0.9 * (rowsDone / plan.totalRows));
  const onRow = (sheet: string) => (): void => {
    rowsDone++;
    if (onProgress && rowsDone - lastReported >= PROGRESS_EVERY_ROWS) {
      lastReported = rowsDone;
      onProgress({ phase: "sheets", sheet, ratio: ratioOf() });
    }
  };

  async function* entries(): AsyncGenerator<ZipWriteEntry> {
    yield { name: "[Content_Types].xml", data: contentTypesXml(pkg) };
    yield { name: "_rels/.rels", data: rootRelsXml(pkg) };
    yield { name: "docProps/core.xml", data: core };
    yield { name: "docProps/app.xml", data: app };
    if (customPart) yield { name: "docProps/custom.xml", data: customPart };
    for (let i = 0; i < plan.sheets.length; i++) {
      const sp = plan.sheets[i]!;
      const name = sp.sheet.name;
      onProgress?.({ phase: "sheets", sheet: name, ratio: ratioOf() });
      const chunks = sheetXml(sp, ctx, onRow(name));
      yield {
        name: `xl/worksheets/sheet${i + 1}.xml`,
        data: (async function* () {
          for await (const chunk of chunks) {
            throwIfAborted(signal);
            yield chunk;
          }
        })(),
      };
      // Hyperlink relationships are known once the sheet XML has been written.
      const rels = sp.links.relsXml();
      if (rels) yield { name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: rels };
    }
    // Written after the sheets, which fill the string table and the style registry.
    onProgress?.({ phase: "styles", ratio: 0.9 });
    if (ctx.strings) yield { name: "xl/sharedStrings.xml", data: encodeUtf8(ctx.strings.toXml()) };
    yield { name: "xl/styles.xml", data: ctx.styles.toXml() };
    yield { name: "xl/theme/theme1.xml", data: THEME_XML };
    const fullCalc = wb.calc?.fullCalcOnLoad;
    yield {
      name: "xl/workbook.xml",
      data: workbookXml({
        sheets: plan.sheets.map((p) => ({ name: p.sheet.name, state: p.sheet.state ?? "visible" })),
        activeSheet: plan.activeSheet,
        date1904: ctx.date1904,
        fullCalcOnLoad: fullCalc === true || ((fullCalc === undefined || fullCalc === "auto") && ctx.formulaWithoutValue),
        definedNames,
      }),
    };
    yield { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml(pkg) };
    onProgress?.({ phase: "zip", ratio: 0.95 });
  }

  const bytes = await writeZip(entries(), {
    compression: options.compression ?? "deflate",
    modified,
    ...(signal ? { signal } : {}),
  });
  onProgress?.({ phase: "zip", ratio: 1 });
  return bytes;
}

/** Writes a workbook as an .xlsx Blob (type XLSX_MIME). */
export async function toBlob(wb: Workbook, options?: WriteOptions): Promise<BlobType> {
  const BlobCtor = (globalThis as unknown as { Blob?: new (parts: Uint8Array[], opts: { type: string }) => BlobType }).Blob;
  if (typeof BlobCtor !== "function") {
    throw new EnvironmentError("ENVIRONMENT_UNSUPPORTED", "Blob is not available in this runtime; use toUint8Array instead.", {
      details: { api: "Blob" },
    });
  }
  return new BlobCtor([await toUint8Array(wb, options)], { type: XLSX_MIME });
}
