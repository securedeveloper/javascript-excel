# javascript-excel

Read and write `.xlsx` and `.csv` files in browsers, Web Workers and Node.js. TypeScript, no runtime dependencies, tree-shakable entry points.

> **Prerelease.** `2.0.0-alpha.x` is a from-scratch rewrite. Everything listed below ships today, and the API may still change before 2.0.0. The last 1.x release is `javascript-excel@1.0.3`.

```sh
npm install javascript-excel@next
```

**Try it in the browser:** the [playground](https://javascript-excel-playground.vercel.app/) writes, reads and previews workbooks with the published package, and shows the code for what you build.

| entry | for |
|---|---|
| `javascript-excel` | the workbook model, the `.xlsx` writer, dataset builders, dates, addresses, errors |
| `javascript-excel/read` | the `.xlsx` reader |
| `javascript-excel/csv` | CSV parse and serialize |
| `javascript-excel/dom` | HTML `<table>` to sheet, `download()` |
| `javascript-excel/worker` | run big jobs in a Web Worker |
| `javascript-excel/format` | show values as Excel does: number formats, dates, colours |
| `javascript-excel/render` | the render model for a sheet viewer: geometry, styles, merges, navigation, copy |
| `javascript-excel/import` | a user's `.xlsx` or `.csv` to `{ columns, data }`: header detection, types, locales, column mapping |

Each entry pulls in only what it needs: a writer-only app never ships the reader, the CSV code or the DOM code.

## Write an `.xlsx`

<!-- example: examples/snippets/src/write.ts -->
```ts
import { toBlob, toUint8Array, type Workbook } from "javascript-excel";

const workbook: Workbook = {
  sheets: [
    {
      name: "Report",
      rows: [
        [{ value: "Item", style: { font: { bold: true }, fill: "DDEBF7" } }, "Qty", "Price"],
        ["Pens", 10, { value: 1.5, style: { numFmt: "#,##0.00" } }],
        ["Total", { formula: "SUM(B2:B2)", value: 10 }, new Date()],
      ],
      view: { freeze: { rows: 1 } },
      colProps: [{ width: "auto" }],
    },
  ],
};

const bytes: Uint8Array = await toUint8Array(workbook); // Node: writeFileSync("report.xlsx", bytes)
const blob = await toBlob(workbook); // browser: download it, upload it, ...
```

A workbook is plain data: sheets with `rows[r][c]`, where a cell is a value (`string`, `number`, `boolean`, `Date`, `{ error }`, `{ richText }`) or a `{ value, formula, style, hyperlink }` object.

## From a dataset (`{ columns, data }`)

<!-- example: examples/snippets/src/dataset.ts -->
```ts
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
```

## Read an `.xlsx`

<!-- example: examples/snippets/src/read.ts -->
```ts
import { read } from "javascript-excel/read";

declare const file: Blob; // a File from <input type="file">, a Uint8Array or an ArrayBuffer

const { workbook, warnings } = await read(file);
for (const sheet of workbook.sheets) {
  console.log(sheet.name, sheet.dimension, sheet.rows[0]?.map((cell) => cell?.value));
}
```

## CSV

<!-- example: examples/snippets/src/csv.ts -->
```ts
import { parseCsv, readCsv, toCsv, toCsvBlob } from "javascript-excel/csv";

const text = toCsv([["name", "amount"], ["Ada", 1250.5], ["=1+1", -5]]); // "=1+1" is written as "'=1+1"
const blob = toCsvBlob([["name"], ["Ada"]]); // UTF-8 with a BOM, so Excel opens it correctly

const { rows, delimiter } = parseCsv("name;amount\nAda;1250,50\n"); // detects ";"
declare const upload: Blob;
const typed = await readCsv(upload, { inferTypes: true }); // numbers, TRUE/FALSE and ISO dates typed
```

## HTML tables and downloads

<!-- example: examples/snippets/src/dom.ts -->
```ts
import { toBlob } from "javascript-excel";
import { download, fromTable } from "javascript-excel/dom";

const table = document.querySelector("table")!;
const sheet = fromTable(table, { styles: "computed", freezeHeader: true, autoWidth: true });
download(await toBlob({ sheets: [sheet] }), "report.xlsx");
```

## Number formats

<!-- example: examples/snippets/src/format.ts -->
```ts
import { formatCell, formatValue } from "javascript-excel/format";
import { read } from "javascript-excel/read";

formatValue(1234.5, "#,##0.00"); // { text: "1,234.50", align: "right" }
formatValue(-12.5, "0.0;[Red]-0.0").color; // "FFFF0000"
formatValue(45306, "dddd, mmmm d, yyyy", { locale: "de-DE" }).text; // "Montag, Januar 15, 2024"

declare const file: Blob;
const { workbook } = await read(file, { dates: "serial" }); // serials: formatting does not depend on the time zone
const shown = formatCell(workbook.sheets[0]?.rows[0]?.[0], { locale: navigator.language, date1904: workbook.date1904 });
```

## Importing a user's file

`importDataset` finds the sheet and header row, flattens header groups, infers column types (with an explicit number and date locale), maps columns to your fields, and reports problems per row. Formulas are never evaluated, and the read limits stay on.

<!-- example: examples/snippets/src/import.ts -->
```ts
import { importDataset } from "javascript-excel/import";

declare const file: File; // from <input type="file"> or a drop
const { columns, data, issues, meta } = await importDataset(file, {
  locale: { decimal: ",", group: "." }, // 1.234,56
  schema: { fields: { email: { aliases: ["E-mail"], required: true }, joined: { type: "date" } } },
  maxRows: 100_000,
});
console.log(meta.header, columns.map((c) => `${c.key}: ${c.type}`), data.length, issues);
```

## In a Web Worker

<!-- example: examples/snippets/src/worker.ts -->
```ts
// excel.worker.ts (the app writes these two lines):
//   import { exposeWorker } from "javascript-excel/worker";
//   exposeWorker();
import type { Workbook } from "javascript-excel";
import { createWorkerClient } from "javascript-excel/worker";

declare const workbook: Workbook;
const excel = createWorkerClient(new Worker(new URL("./excel.worker.ts", import.meta.url), { type: "module" }));
const controller = new AbortController();
const bytes = await excel.write(workbook, { signal: controller.signal, onProgress: (p) => console.log(p.phase, p.ratio) });
```

## What ships

- **Writer:** strings, numbers, booleans, dates (1900 and 1904 systems), errors, rich text, formulas with cached values and array formulas, and styled empty cells.
  - **Styles:** the full style model (fonts, pattern and gradient fills, all border styles with a colour per side, alignment, protection, built-in and custom number formats), deduplicated.
  - **Sheet features:** column widths (characters, pixels or `"auto"`), row heights, hidden rows and columns, outline levels, merges, autofilter, freeze panes, right-to-left sheets, zoom, tab colours, hyperlinks (external URLs limited to `http`, `https` and `mailto` by default), defined names and print setup.
  - **Workbook:** document properties.
  - **Validation:** input that can't be written faithfully throws a typed `ValidationError`.
- **Reader:** `.xlsx`, `.xlsm`, `.xltx` and `.xltm`, including ISO 29500 Strict files.
  - Reads values, shared, inline and rich strings, and formula text with cached values (shared formulas expanded).
  - Styles come back as shared frozen objects. Merges, column widths and row heights, views and panes, print setup, hyperlinks, defined names and document properties are read too.
  - **Untrusted files:** bounded by limits on size, zip entries, compression ratio, XML depth, cells and shared strings. A `DOCTYPE` is rejected, nothing is ever fetched or executed, and file content never becomes an object key.
  - **Rejected formats:** `.xls`, `.xlsb`, `.ods` and encrypted files throw `UNSUPPORTED_FORMAT`.
- **CSV:** RFC 4180 parsing with delimiter detection, BOM and CRLF/LF/CR handling, lenient or strict modes, and optional type inference. `readCsv` decodes bytes in any `TextDecoder` encoding. Serializing gives you quoting, a BOM for Excel, ISO dates and a formula-injection guard, which is on by default.
- **Datasets:** `fromDataset` and `fromDatasets` support `key`, `path` and function accessors, grouped headers, number formats, widths and a totals row. `toDataset` reads a sheet back into `{ columns, data }`.
- **DOM:** `fromTable` handles `colspan`/`rowspan` merges, `data-*` type hints and computed styles. `download()` needs no dependency, and the module is safe to import during SSR.
- **Worker:** progress, warnings and `AbortSignal` work across the boundary, and results are transferred, not copied.
- **Import:** `importDataset` turns a user's `.xlsx` or `.csv` into `{ columns, data }`. It detects title and header rows, including multi-row headers. It infers column types all-or-nothing, parses numbers and dates in an explicit locale (`1.234,56`, `15/01/2024`) and maps columns to your fields by name or alias. Problems are reported per row with their cell. Preview reads (`preview`) and `maxRows` stop reading early, and it also runs in the worker.
- **Not in 2.0:** `.xls`/`.xlsb`/`.ods`, charts, images, comments, pivot tables, conditional formatting and formula evaluation. These are planned for later releases, not ruled out.

## Runtime support

- Node.js 22 and later.
- Browsers with `CompressionStream('deflate-raw')`: Chrome and Edge 103+, Firefox 113+, Safari 16.4+.
- TypeScript 5.0–7, with `moduleResolution` `node16`, `nodenext` or `bundler`. Types ship with the package.

Performance is measured in CI at 10k, 100k and 1M cells (for example, writing 1M numbers takes 1.3 s and reading them back 1.25 s on a GitHub Actions runner). The full table is in the [repository README](https://github.com/securedeveloper/javascript-excel#performance).

## Documentation

- Guides with runnable examples: [Node](https://github.com/securedeveloper/javascript-excel/blob/main/docs/guides/node.md), [vanilla browser](https://github.com/securedeveloper/javascript-excel/blob/main/docs/guides/vanilla.md), [React](https://github.com/securedeveloper/javascript-excel/blob/main/docs/guides/react.md), [Vue 3](https://github.com/securedeveloper/javascript-excel/blob/main/docs/guides/vue.md).
- For React components on top of this library, see [react-data-export](https://github.com/securedeveloper/react-data-export).
- The design and full API: [docs/api.md](https://github.com/securedeveloper/javascript-excel/blob/main/docs/api.md).

Source and issues: https://github.com/securedeveloper/javascript-excel

## License

MIT
