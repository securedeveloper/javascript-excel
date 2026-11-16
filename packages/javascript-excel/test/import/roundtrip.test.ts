// Golden round trips: react-data-export-style datasets written with
// fromDataset + toUint8Array (or toCsv) come back from importDataset as the
// same rows, with header groups flattened and the totals row dropped.
import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/csv";
import { fromDataset, type ColumnDef, type Dataset, type DatasetOptions } from "../../src/dataset";
import { importDataset } from "../../src/import";
import { toUint8Array } from "../../src/write";

interface Case {
  name: string;
  dataset: Dataset<any>;
  options?: DatasetOptions<any>;
}

/** The rows importDataset should return: one key per leaf, its titles joined with ' / '. */
function expected(ds: Dataset<any>): { keys: string[]; rows: Array<Record<string, unknown>> } {
  const leaves: Array<{ key: string; get: (row: any, i: number) => unknown }> = [];
  const walk = (cols: Array<ColumnDef<any> | null | false | undefined>, prefix: string[]) => {
    cols.forEach((c, i) => {
      if (!c) return;
      if ("children" in c) return walk(c.children, [...prefix, String(c.title)]);
      const title = [...prefix, String(c.title ?? c.key ?? c.path ?? "")].join(" / ");
      const get = (row: any, rowIndex: number): unknown => {
        if (c.value) return c.value(row, { rowIndex });
        if (c.key !== undefined) return row[c.key];
        if (c.path !== undefined) return c.path.split(".").reduce((o: any, k) => o?.[k], row);
        return row[c.index ?? i];
      };
      leaves.push({ key: title, get });
    });
  };
  walk(ds.columns ?? [], []);
  const rows = ds.data.map((row, i) => {
    const out = Object.create(null) as Record<string, unknown>;
    for (const l of leaves) {
      const v = l.get(row, i);
      out[l.key] = v === undefined || v === "" ? null : v && typeof v === "object" && "value" in (v as object) ? (v as { value: unknown }).value : v;
    }
    return out;
  });
  return { keys: leaves.map((l) => l.key), rows };
}

const people = [
  { name: "Ada Lovelace", joined: new Date(2024, 0, 15), admin: true, sales: { q1: { jan: 1200.5, feb: 980 }, q2: { apr: 10, may: 0 } }, city: "London" },
  { name: "Grace Hopper", joined: new Date(2023, 5, 1), admin: false, sales: { q1: { jan: 0, feb: 1430.25 }, q2: { apr: 7.75, may: 3 } }, city: "Arlington" },
  { name: "Ünïcödé 名前", joined: new Date(2020, 1, 29), admin: false, sales: { q1: { jan: -5, feb: 1e6 }, q2: { apr: 0.1, may: 0.2 } }, city: null },
];

const cases: Case[] = [
  {
    name: "flat columns with types and formats",
    dataset: {
      columns: [
        { title: "Name", key: "name" },
        { title: "Joined", key: "joined", type: "date", numFmt: "yyyy-mm-dd" },
        { title: "Admin", key: "admin" },
        { title: "City", key: "city" },
      ],
      data: people,
    },
  },
  {
    name: "header groups three levels deep, totals, freeze and filter",
    dataset: {
      columns: [
        { title: "Name", key: "name" },
        {
          title: "Sales",
          children: [
            { title: "Q1", children: [{ title: "Jan", path: "sales.q1.jan", total: "sum", numFmt: "#,##0.00" }, { title: "Feb", path: "sales.q1.feb", total: "sum" }] },
            { title: "Q2", children: [{ title: "Apr", path: "sales.q2.apr", total: "average" }, { title: "May", path: "sales.q2.may", total: "max" }] },
          ],
        },
      ],
      data: people,
    },
    options: { totals: { label: "Total" }, freezeHeader: true, autoFilter: true, autoWidth: true },
  },
  {
    name: "computed and conditional columns",
    dataset: {
      columns: [
        { title: "Initials", value: (p: (typeof people)[number]) => p.name.split(" ").map((w) => w[0]).join("") },
        false,
        { title: "Joined", key: "joined", type: "datetime" },
        null,
        { title: "Big", value: (p: (typeof people)[number]) => ({ value: p.sales.q1.feb > 1000, style: { font: { bold: true } } }) },
      ],
      data: people,
    },
  },
  {
    name: "array rows by position and index",
    dataset: {
      columns: [{ title: "First" }, { title: "Third", index: 2 }, { title: "Second", index: 1 }],
      data: [["a", 1, new Date(2024, 4, 5, 10, 30)], ["b", 2.5, new Date(2024, 4, 6)], ["c", null, null]],
    },
  },
];

describe("xlsx round trips", () => {
  it.each(cases)("$name", async ({ dataset, options }) => {
    const sheet = fromDataset(dataset, { name: "Data", ...options });
    const bytes = await toUint8Array({ sheets: [sheet] });
    const r = await importDataset(bytes);
    const want = expected(dataset);
    expect(r.columns.map((c) => c.key)).toEqual(want.keys);
    expect(r.data).toEqual(want.rows);
    expect(r.issues).toEqual([]);
    expect(r.meta.header.confidence).toBe("high");
    expect(r.meta.totalsRowSkipped).toBe(Boolean(dataset.columns?.some((c) => c && "children" in c)));
  });

  it("types survive: numbers, booleans, dates, datetimes", async () => {
    const r = await importDataset(await toUint8Array({ sheets: [fromDataset(cases[2]!.dataset)] }));
    expect(Object.fromEntries(r.columns.map((c) => [c.key, c.type]))).toEqual({ Initials: "string", Joined: "date", Big: "boolean" });
  });
});

describe("CSV round trips", () => {
  it.each(cases.filter((c) => !c.dataset.columns?.some((x) => x && "children" in x)))("$name", async ({ dataset }) => {
    const csv = toCsv(fromDataset(dataset));
    const r = await importDataset(csv);
    const want = expected(dataset);
    expect(r.columns.map((c) => c.key)).toEqual(want.keys);
    expect(r.data).toEqual(want.rows);
  });

  it("formula-guarded strings come back with their quote (one-way guard)", async () => {
    const csv = toCsv([["Note"], ["=1+1"], ["safe"]]);
    const r = await importDataset(csv);
    expect(r.data.map((d) => d["Note"])).toEqual(["'=1+1", "safe"]);
  });
});
