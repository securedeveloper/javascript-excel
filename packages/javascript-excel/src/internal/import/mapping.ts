/**
 * Column mapping for javascript-excel/import (docs/api.md §5.6, "Column
 * mapping"): exact matching after normalisation, no fuzzy guesses.
 */

import type { ColumnType, DatasetLike, ImportIssue } from "./types";

export interface FieldSpec {
  /** Titles that match this field, besides the field name itself. */
  aliases?: string[] | undefined;
  required?: boolean | undefined;
  /** Forces the column's type (a value that doesn't convert becomes null with a TYPE issue). */
  type?: ColumnType | undefined;
}

export interface ImportSchema {
  fields: Record<string, FieldSpec>;
  /** Columns no field takes: dropped (default) or kept under their own keys. */
  unmapped?: "drop" | "keep" | undefined;
}

/** Field name -> column key, or null when the field has no column. */
export type ColumnMapping = Record<string, string | null>;

export interface MappingResult {
  mapping: ColumnMapping;
  /** Required fields without a column. */
  missing: string[];
  /** Column keys no field took. */
  unmapped: string[];
}

export interface ImportedColumn {
  key: string;
  title: string;
  letter: string;
  type: ColumnType;
  field?: string | undefined;
}

export interface MappedDataset {
  columns: ImportedColumn[];
  data: Array<Record<string, unknown>>;
  rowNumbers: number[];
  issues: ImportIssue[];
}

/** NFKD, combining marks removed, lower case, whitespace _ - . removed. */
export function normaliseTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s_.-]+/gu, "");
}

function fieldsOf(schema: ImportSchema): Array<[string, FieldSpec]> {
  if (!schema || typeof schema !== "object" || !schema.fields || typeof schema.fields !== "object") throw new TypeError("schema.fields must be an object");
  return Object.keys(schema.fields).map((name) => {
    const spec = schema.fields[name];
    if (!spec || typeof spec !== "object") throw new TypeError(`schema.fields.${name} must be an object`);
    if (spec.aliases !== undefined && (!Array.isArray(spec.aliases) || spec.aliases.some((a) => typeof a !== "string"))) {
      throw new TypeError(`schema.fields.${name}.aliases must be an array of strings`);
    }
    return [name, spec];
  });
}

export function mapColumns(columns: ReadonlyArray<{ key: string; title: string }>, schema: ImportSchema, mapping?: ColumnMapping): MappingResult {
  const fields = fieldsOf(schema);
  const keys = new Set(columns.map((c) => c.key));
  const taken = new Set<string>();
  const result: ColumnMapping = Object.create(null) as ColumnMapping;
  // Explicit entries first, so automatic matching can't take their columns.
  if (mapping !== undefined) {
    if (!mapping || typeof mapping !== "object") throw new TypeError("mapping must be an object");
    for (const [name] of fields) {
      if (!Object.hasOwn(mapping, name)) continue;
      const col = mapping[name];
      if (col === null) {
        result[name] = null;
        continue;
      }
      if (typeof col !== "string" || !keys.has(col)) throw new TypeError(`mapping.${name}: no column with key ${JSON.stringify(col)}`);
      if (taken.has(col)) throw new TypeError(`mapping: column ${JSON.stringify(col)} is mapped to more than one field`);
      result[name] = col;
      taken.add(col);
    }
    for (const name of Object.keys(mapping)) if (!fields.some(([f]) => f === name)) throw new TypeError(`mapping: ${JSON.stringify(name)} is not a schema field`);
  }
  const norm = columns.map((c) => ({ key: c.key, n: [normaliseTitle(c.title), normaliseTitle(c.key)] }));
  for (const [name, spec] of fields) {
    if (Object.hasOwn(result, name)) continue;
    const wanted = new Set([name, ...(spec.aliases ?? [])].map(normaliseTitle).filter((x) => x !== ""));
    const hit = norm.find((c) => !taken.has(c.key) && c.n.some((x) => wanted.has(x)));
    result[name] = hit ? hit.key : null;
    if (hit) taken.add(hit.key);
  }
  return {
    mapping: result,
    missing: fields.filter(([name, spec]) => spec.required && result[name] === null).map(([name]) => name),
    unmapped: columns.map((c) => c.key).filter((k) => !taken.has(k)),
  };
}

/** A dataset to map: like DatasetLike, and columns may carry their type. */
export interface MappableDataset extends DatasetLike {
  columns: ReadonlyArray<{ key: string; title: string; letter?: string | undefined; type?: ColumnType | undefined }>;
}

export function applyMapping(dataset: MappableDataset, mapping: ColumnMapping, schema: ImportSchema): MappedDataset {
  const { sources: _s, ...result } = applyMappingDetailed(dataset, mapping, schema);
  return result;
}

/** @internal applyMapping plus each source column key's key in the rows (columns the mapping drops are absent). */
export function applyMappingDetailed(dataset: MappableDataset, mapping: ColumnMapping, schema: ImportSchema): MappedDataset & { sources: Map<string, string> } {
  const fields = fieldsOf(schema);
  const byKey = new Map(dataset.columns.map((c, i) => [c.key, { ...c, index: i }]));
  for (const [name] of fields) {
    const col = Object.hasOwn(mapping, name) ? mapping[name] : null;
    if (col !== null && col !== undefined && !byKey.has(col)) throw new TypeError(`mapping.${name}: no column with key ${JSON.stringify(col)}`);
  }
  const rowNumbers = dataset.data.map((_, i) => dataset.rowNumbers?.[i] ?? i + 2);
  const issues: ImportIssue[] = [];
  const columns: ImportedColumn[] = [];
  // from null: a field without a column. It still gets a column and a null in
  // every row, so rows always have the schema's shape (JSE-21).
  const plan: Array<{ out: string; from: string | null }> = [];
  // Every field name is reserved, mapped or not, so a kept column never poses as a field.
  const used = new Set<string>(fields.map(([name]) => name));
  for (const [name, spec] of fields) {
    const from = Object.hasOwn(mapping, name) ? mapping[name] : null;
    if (from === null || from === undefined) {
      if (spec.required) {
        issues.push({ row: 0, field: name, code: "MAPPING_MISSING", message: `No column for the required field "${name}".`, severity: "error" });
      }
      columns.push({ key: name, title: "", letter: "", type: "empty", field: name });
      plan.push({ out: name, from: null });
      continue;
    }
    const c = byKey.get(from)!;
    columns.push({ key: name, title: c.title, letter: c.letter ?? "", type: c.type ?? "mixed", field: name });
    plan.push({ out: name, from });
  }
  if (schema.unmapped === "keep") {
    const mapped = new Set(plan.map((p) => p.from).filter((f): f is string => f !== null));
    for (const c of dataset.columns) {
      if (mapped.has(c.key)) continue;
      let key = c.key;
      for (let n = 2; used.has(key); n++) key = `${c.key}_${n}`;
      used.add(key);
      columns.push({ key, title: c.title, letter: c.letter ?? "", type: c.type ?? "mixed" });
      plan.push({ out: key, from: c.key });
    }
  }
  // Only mapped required fields are checked per row; an unmapped one already has MAPPING_MISSING.
  const required = fields.filter(([name, spec]) => spec.required && plan.some((p) => p.out === name && p.from !== null)).map(([name]) => name);
  const data = dataset.data.map((row, i) => {
    const out = Object.create(null) as Record<string, unknown>;
    for (const { out: k, from } of plan) out[k] = from === null ? null : (row[from] ?? null);
    for (const name of required) {
      const v = out[name];
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) {
        const from = plan.find((p) => p.out === name)!.from!;
        const letter = byKey.get(from)?.letter;
        issues.push({
          row: rowNumbers[i]!,
          field: name,
          column: from,
          ...(letter ? { ref: `${letter}${rowNumbers[i]}` } : {}),
          code: "REQUIRED",
          message: `Row ${rowNumbers[i]}: "${name}" is required.`,
          severity: "error",
        });
      }
    }
    return out;
  });
  const sources = new Map<string, string>();
  for (const p of plan) if (p.from !== null) sources.set(p.from, p.out);
  return { columns, data, rowNumbers, issues, sources };
}
