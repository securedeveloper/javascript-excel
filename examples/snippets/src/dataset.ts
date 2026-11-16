import { fromDataset, toDataset, toUint8Array } from "javascript-excel";

const sheet = fromDataset(
  {
    columns: [
      { title: "Name", key: "name", width: "auto" },
      { title: "Sales", children: [{ title: "Q1", path: "sales.q1", numFmt: "#,##0.00", total: "sum" }] },
    ],
    data: [{ name: "Ada", sales: { q1: 1200.5 } }],
  },
  { freezeHeader: true, autoFilter: true, totals: { label: "Total" } },
);
const bytes = await toUint8Array({ sheets: [sheet] });

// ...and back from a sheet that was read: { columns, data } with one object per row.
const { columns, data } = toDataset(sheet);
