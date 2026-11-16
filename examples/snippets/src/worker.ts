// excel.worker.ts (the app writes these two lines):
//   import { exposeWorker } from "javascript-excel/worker";
//   exposeWorker();
import type { Workbook } from "javascript-excel";
import { createWorkerClient } from "javascript-excel/worker";

declare const workbook: Workbook;
const excel = createWorkerClient(new Worker(new URL("./excel.worker.ts", import.meta.url), { type: "module" }));
const controller = new AbortController();
const bytes = await excel.write(workbook, { signal: controller.signal, onProgress: (p) => console.log(p.phase, p.ratio) });
