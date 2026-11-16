/**
 * Sheet-name rules (docs/api.md §3.3, §4.6).
 *
 * Excel rejects names that are empty, longer than 31 characters, contain any
 * of \ / ? * [ ] :, or start or end with an apostrophe. It reserves 'History'
 * [to verify]. Names are unique case-insensitively (checked by the writer).
 */

/** Why a sheet name is invalid. */
export type SheetNameProblem = "empty" | "too-long" | "forbidden-char" | "apostrophe" | "reserved";

const FORBIDDEN = /[\\/?*[\]:]/;
const FORBIDDEN_ALL = /[\\/?*[\]:]/g;

/** Returns null when `name` is a valid sheet name, or the reason it is not. */
export function validateSheetName(name: string): SheetNameProblem | null {
  if (typeof name !== "string" || name.length === 0) return "empty";
  if (name.length > 31) return "too-long";
  if (FORBIDDEN.test(name)) return "forbidden-char";
  if (name.startsWith("'") || name.endsWith("'")) return "apostrophe";
  if (name.toLowerCase() === "history") return "reserved";
  return null;
}

/**
 * Makes any string a valid sheet name: forbidden characters become '_',
 * leading and trailing apostrophes are removed, the result is cut to 31
 * characters (without splitting a surrogate pair), and an empty or reserved
 * result becomes 'Sheet'. Uniqueness is the caller's job.
 */
export function sanitizeSheetName(name: string): string {
  let s = String(name ?? "").replace(FORBIDDEN_ALL, "_").replace(/^'+|'+$/g, "");
  if (s.length > 31) {
    s = s.slice(0, 31);
    if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, 30);
    s = s.replace(/'+$/, "");
  }
  return s.length === 0 || s.toLowerCase() === "history" ? "Sheet" : s;
}
