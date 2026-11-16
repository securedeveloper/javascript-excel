/**
 * Format detection tables for the reader (docs/api.md §5.2). Internal.
 *
 * Detection is data: container signatures first, then, for OPC packages, the
 * workbook part's content type. Supporting another format later (.xlsb, .xls)
 * is one more row plus a decoder; the reader dispatches on `decoder`.
 */

/** Every format `detectFormat` can name. */
export type FormatName = "xlsx" | "xlsm" | "xltx" | "xltm" | "xlsb" | "ods" | "cfb" | "zip" | "unknown";

/** The decoders the reader has. Formats without one are rejected with UNSUPPORTED_FORMAT. */
export type Decoder = "spreadsheetml";

export interface ContainerFormat {
  kind: "cfb" | "zip";
  magic: readonly number[];
}

/** Container signatures, checked in order. */
export const CONTAINERS: readonly ContainerFormat[] = [
  { kind: "cfb", magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }, // .xls, and encrypted OOXML
  { kind: "zip", magic: [0x50, 0x4b, 0x03, 0x04] },
  { kind: "zip", magic: [0x50, 0x4b, 0x05, 0x06] }, // empty archive
];

export interface WorkbookFormat {
  format: FormatName;
  /** Content type of the workbook (officeDocument) part. */
  contentType: string;
  decoder?: Decoder | undefined;
  /** The format can carry VBA macros, which the reader never runs. */
  macros?: boolean | undefined;
  /** Shown in UNSUPPORTED_FORMAT messages. */
  label: string;
}

/** OPC workbook formats by the content type of their workbook part. */
export const WORKBOOK_FORMATS: readonly WorkbookFormat[] = [
  { format: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml", decoder: "spreadsheetml", label: "Excel workbook (.xlsx)" },
  { format: "xltx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml", decoder: "spreadsheetml", label: "Excel template (.xltx)" },
  { format: "xlsm", contentType: "application/vnd.ms-excel.sheet.macroEnabled.main+xml", decoder: "spreadsheetml", macros: true, label: "macro-enabled workbook (.xlsm)" },
  { format: "xltm", contentType: "application/vnd.ms-excel.template.macroEnabled.main+xml", decoder: "spreadsheetml", macros: true, label: "macro-enabled template (.xltm)" },
  { format: "xlsb", contentType: "application/vnd.ms-excel.sheet.binary.macroEnabled.main", macros: true, label: "binary workbook (.xlsb)" },
];

/** Formats recognised by something other than a workbook content type. */
export const OTHER_FORMATS: Readonly<Record<"ods" | "cfb" | "unknown", { label: string; decoder?: Decoder }>> = {
  ods: { label: "OpenDocument spreadsheet (.ods)" },
  cfb: { label: "legacy .xls file or a password-protected (encrypted) workbook" },
  unknown: { label: "file that is not a spreadsheet package" },
};

export const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";

export function sniffContainer(b: Uint8Array): "cfb" | "zip" | "unknown" {
  for (const c of CONTAINERS) if (c.magic.every((x, i) => b[i] === x)) return c.kind;
  return "unknown";
}

/**
 * The workbook format for a workbook part, from its content type; when the
 * content type is missing or unknown, from the part's extension (.bin is
 * binary, anything else is read as SpreadsheetML).
 */
export function workbookFormat(contentType: string | undefined, partName: string): WorkbookFormat {
  const ct = (contentType ?? "").toLowerCase();
  const known = WORKBOOK_FORMATS.find((f) => f.contentType.toLowerCase() === ct);
  if (known) return known;
  if (partName.toLowerCase().endsWith(".bin")) return WORKBOOK_FORMATS.find((f) => f.format === "xlsb")!;
  return WORKBOOK_FORMATS[0]!;
}
