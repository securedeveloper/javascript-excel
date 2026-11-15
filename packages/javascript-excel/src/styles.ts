/**
 * Style merging (docs/api.md §3.5.7, §4.4). Public.
 */

import type { Border, Style } from "./model";

/** Copies `b`'s defined fields over a copy of `a`. */
function mergeFields<T extends object>(a: T | undefined, b: T): T {
  const out = { ...a } as T;
  for (const key of Object.keys(b) as Array<keyof T>) {
    const v = b[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

const SIDES = ["left", "right", "top", "bottom", "diagonal"] as const;

function mergeBorder(a: Border | undefined, b: Border): Border {
  const out: Border = { ...a };
  for (const side of SIDES) {
    const next = b[side];
    if (next) out[side] = mergeFields(a?.[side], next);
  }
  if (b.diagonalUp !== undefined) out.diagonalUp = b.diagonalUp;
  if (b.diagonalDown !== undefined) out.diagonalDown = b.diagonalDown;
  return out;
}

/**
 * Deep-merges styles, later ones winning field by field. `font`, `alignment`,
 * `protection` and each `border` side merge by field; `fill` and `numFmt`
 * replace as a whole. `undefined` layers and `undefined` fields are skipped.
 * The inputs are not modified.
 */
export function mergeStyles(...styles: Array<Style | undefined>): Style {
  const out: Style = {};
  for (const s of styles) {
    if (!s) continue;
    if (s.font) out.font = mergeFields(out.font, s.font);
    if (s.alignment) out.alignment = mergeFields(out.alignment, s.alignment);
    if (s.protection) out.protection = mergeFields(out.protection, s.protection);
    if (s.border) out.border = mergeBorder(out.border, s.border);
    if (s.fill !== undefined) out.fill = s.fill;
    if (s.numFmt !== undefined) out.numFmt = s.numFmt;
  }
  return out;
}
