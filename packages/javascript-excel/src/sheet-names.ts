/**
 * Sheet-name rules (docs/api.md §3.3, §4.6).
 *
 * Excel rejects names that are empty, longer than 31 characters (code points,
 * not UTF-16 units: 30 x's and an emoji are accepted), contain any
 * of \ / ? * [ ] :, or start or end with an apostrophe. It reserves 'History'
 * (Excel for Mac: "History is a reserve word"); the check here ignores case.
 * Names are unique case-insensitively (checked by the writer).
 */

/** Why a sheet name is invalid. */
export type SheetNameProblem = "empty" | "too-long" | "forbidden-char" | "apostrophe" | "reserved";

const FORBIDDEN = /[\\/?*[\]:]/;
const FORBIDDEN_ALL = /[\\/?*[\]:]/g;
const MAX_LENGTH = 31;

/** Length in code points, as Excel counts sheet names (a surrogate pair is one). */
function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Returns null when `name` is a valid sheet name, or the reason it is not. */
export function validateSheetName(name: string): SheetNameProblem | null {
  if (typeof name !== "string" || name.length === 0) return "empty";
  if (codePoints(name) > MAX_LENGTH) return "too-long";
  if (FORBIDDEN.test(name)) return "forbidden-char";
  if (name.startsWith("'") || name.endsWith("'")) return "apostrophe";
  if (name.toLowerCase() === "history") return "reserved";
  return null;
}

/**
 * Makes any string a valid sheet name: forbidden characters become '_',
 * leading and trailing apostrophes are removed, the result is cut to 31
 * code points (never splitting a surrogate pair), and an empty or reserved
 * result ('History' in any case) becomes 'Sheet'. Uniqueness is the caller's job.
 */
export function sanitizeSheetName(name: string): string {
  let s = String(name ?? "").replace(FORBIDDEN_ALL, "_").replace(/^'+|'+$/g, "");
  if (codePoints(s) > MAX_LENGTH) s = Array.from(s).slice(0, MAX_LENGTH).join("").replace(/'+$/, "");
  return s.length === 0 || s.toLowerCase() === "history" ? "Sheet" : s;
}
