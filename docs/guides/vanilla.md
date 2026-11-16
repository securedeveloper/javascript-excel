# Vanilla browser

A plain page, bundled with Vite, with three buttons: export an HTML table, write 100,000 rows in a Web Worker, and open an `.xlsx`.

```sh
cd examples/vanilla
npm run dev
```

The page:

<!-- example: examples/vanilla/index.html -->
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>javascript-excel: vanilla example</title>
  </head>
  <body>
    <table id="orders">
      <thead>
        <tr><th>Order</th><th>Customer</th><th>Total</th></tr>
      </thead>
      <tbody>
        <tr><td>1001</td><td>Ada</td><td data-type="number" data-numfmt="#,##0.00">1250.50</td></tr>
        <tr><td>1002</td><td>Grace</td><td data-type="number" data-numfmt="#,##0.00">980.00</td></tr>
      </tbody>
    </table>
    <button id="export">Export the table to .xlsx</button>
    <button id="big">Write 100,000 rows in a worker</button>
    <label>Open an .xlsx: <input id="open" type="file" accept=".xlsx,.xlsm" /></label>
    <pre id="output"></pre>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

The script:

<!-- example: examples/vanilla/src/main.ts -->
```ts
// javascript-excel in a plain page (no framework).
import { toBlob } from "javascript-excel";
import { download, fromTable } from "javascript-excel/dom";
import { read } from "javascript-excel/read";
import { createWorkerClient } from "javascript-excel/worker";

const output = document.querySelector<HTMLPreElement>("#output")!;

// 1. An HTML table to .xlsx, with the page's styles (bold header, colours).
document.querySelector("#export")!.addEventListener("click", async () => {
  const table = document.querySelector<HTMLTableElement>("#orders")!;
  const sheet = fromTable(table, { name: "Orders", styles: "computed", freezeHeader: true, autoWidth: true });
  download(await toBlob({ sheets: [sheet] }), "orders.xlsx");
});

// 2. A big write off the main thread, with progress and a way to cancel.
const excel = createWorkerClient(new Worker(new URL("./excel.worker.ts", import.meta.url), { type: "module" }));
document.querySelector("#big")!.addEventListener("click", async () => {
  const rows = Array.from({ length: 100_000 }, (_, i) => [i + 1, `item ${i + 1}`, Math.round(Math.random() * 10_000) / 100]);
  const controller = new AbortController();
  const bytes = await excel.write(
    { sheets: [{ name: "Items", rows: [["#", "Name", "Price"], ...rows] }] },
    { signal: controller.signal, onProgress: (p) => (output.textContent = `${p.phase} ${Math.round(p.ratio * 100)}%`) },
  );
  download(bytes, "items.xlsx");
});

// 3. Open a file and list what is in it.
document.querySelector<HTMLInputElement>("#open")!.addEventListener("change", async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const { workbook, warnings } = await read(file);
  output.textContent = workbook.sheets.map((s) => `${s.name}: ${s.dimension ?? "empty"}`).join("\n") + (warnings.length ? `\n${warnings.length} warnings` : "");
});
```

The worker file is two lines. The app owns it, and `new Worker(new URL("./excel.worker.ts", import.meta.url), { type: "module" })` is the pattern Vite, webpack 5 and Next.js all bundle:

<!-- example: examples/vanilla/src/excel.worker.ts -->
```ts
// The worker file: two lines (docs/api.md §5.5).
import { exposeWorker } from "javascript-excel/worker";
exposeWorker();
```

Notes:

- **`fromTable`** reads `<thead>`, `<tbody>` and `<tfoot>`, turns `colspan`/`rowspan` into merges, and uses `data-type`, `data-value` and `data-numfmt` hints. With `styles: "computed"` it maps bold, italic, underline, colour, background and alignment from the page's CSS.
- **`download`** saves bytes, a `Blob` or a string through a temporary link, with no dependency.
- **The worker** keeps the main thread free. Progress, warnings and `AbortSignal` work across it, and results are transferred, not copied. Sending the workbook to the worker costs the main thread a few milliseconds for plain values. Style objects shared between cells keep that cost low (docs/api.md §5.5).
- **Browsers:** anything with `CompressionStream('deflate-raw')`: Chrome and Edge 103+, Firefox 113+, Safari 16.4+.
