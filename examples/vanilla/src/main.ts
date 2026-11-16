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
