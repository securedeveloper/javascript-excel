# Node

javascript-excel runs on Node.js 22 and later with no dependencies. Everything is async and works on `Uint8Array`s, so you read and write files with `node:fs` yourself.

```sh
npm install javascript-excel@next
node write-and-read.ts   # Node 22.18+ runs TypeScript directly
```

What the example does:

1. **Build a sheet from objects** with `fromDataset`: a header row, number formats, an `"auto"` column width, a frozen header, an autofilter and a totals row (`SUBTOTAL` formulas with cached values).
2. **Write** it with `toUint8Array` and save it with `writeFileSync`, plus a CSV copy with `toCsv`.
3. **Read** the `.xlsx` back with `read` (any `Uint8Array` or `Buffer` works), and the CSV with `readCsv` and `inferTypes: true`.

`dateZone: "utc"` makes dates independent of the machine's time zone. The default is `"local"`, which is what Excel users usually expect when a `Date` is built from local fields.

<!-- example: examples/node/write-and-read.ts -->
```ts
// Write an .xlsx and a .csv to disk with javascript-excel, then read both back.
// Run: node write-and-read.ts   (Node 22.18+ runs TypeScript directly)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fromDataset, toUint8Array, type Workbook } from "javascript-excel";
import { readCsv, toCsv } from "javascript-excel/csv";
import { read } from "javascript-excel/read";

const orders = [
  { id: 1001, customer: "Ada", total: 1250.5, shipped: new Date(Date.UTC(2024, 0, 15)) },
  { id: 1002, customer: "Grace", total: 980, shipped: new Date(Date.UTC(2024, 0, 16)) },
  { id: 1003, customer: "Linus", total: 42.25, shipped: new Date(Date.UTC(2024, 0, 18)) },
];

// 1. A sheet from plain objects: header row, number formats, widths, a totals row.
const sheet = fromDataset(
  {
    columns: [
      { title: "Order", key: "id" },
      { title: "Customer", key: "customer", width: "auto" },
      { title: "Total", key: "total", numFmt: "#,##0.00", total: "sum" },
      { title: "Shipped", key: "shipped", numFmt: "yyyy-mm-dd" },
    ],
    data: orders,
  },
  { name: "Orders", freezeHeader: true, autoFilter: true, totals: { label: "Total" } },
);

const workbook: Workbook = { properties: { title: "Orders", creator: "example-node" }, sheets: [sheet] };

mkdirSync("out", { recursive: true });
const xlsx = await toUint8Array(workbook, { dateZone: "utc" });
writeFileSync("out/orders.xlsx", xlsx);
writeFileSync("out/orders.csv", toCsv(sheet, { dateZone: "utc" }));

// 2. Read the .xlsx back into the same model.
const { workbook: back, warnings } = await read(readFileSync("out/orders.xlsx"), { dateZone: "utc" });
const rows = back.sheets[0]!.rows;
console.log(`orders.xlsx: ${xlsx.length} bytes, sheet "${back.sheets[0]!.name}", ${rows.length} rows, ${warnings.length} warnings`);
console.log("header:", rows[0]!.map((cell) => cell?.value));
console.log("totals:", rows.at(-1)!.map((cell) => cell?.value));

// 3. Read the .csv back, with numbers and ISO dates typed.
const csv = await readCsv(readFileSync("out/orders.csv"), { inferTypes: true, dateZone: "utc" });
console.log(`orders.csv: delimiter ${JSON.stringify(csv.delimiter)}, ${csv.rows.length} rows; row 2:`, csv.rows[1]);

if (rows[1]![2]!.value !== 1250.5 || csv.rows[1]![2] !== 1250.5) throw new Error("round trip failed");
```
orders.xlsx: 4435 bytes, sheet "Orders", 5 rows, 0 warnings
header: [ 'Order', 'Customer', 'Total', 'Shipped' ]
totals: [ 'Total', <1 empty item>, 2272.75 ]
orders.csv: delimiter ",", 5 rows; row 2: [ 1001, 'Ada', 1250.5, 2024-01-15T00:00:00.000Z ]
```

Next steps:

- **Untrusted uploads:** `read` enforces limits on input size, zip entries, decompressed size, compression ratio, XML depth, cells and shared strings (`DEFAULT_READ_LIMITS`). Keep them on for files from users. Exceeding one throws a `LimitError`.
- **Errors:** check them with `isExcelError(err)` and `err.code`, not `instanceof`, because an app can end up with both the ESM and the CJS build.
- **Big files:** see the Performance section of the README for measured times and memory at 10k, 100k and 1M cells.
