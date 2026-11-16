import type { Cell, CellInput, ExcelWarning, Progress, Sheet, Workbook } from "javascript-excel";
import { read } from "javascript-excel/read";
import { readCsv } from "javascript-excel/csv";
import { createWorkerClient, type WorkerClient } from "javascript-excel/worker";
import { renderSheet } from "./render";
import { checkbox, describeError, el, status, warningList } from "./util";

/** Files at or above this size are read in the Web Worker, so the page stays responsive. */
export const WORKER_THRESHOLD: number = 1024 * 1024;

let client: WorkerClient | undefined;
function worker(): WorkerClient {
  client ??= createWorkerClient(new Worker(new URL("./excel.worker.ts", import.meta.url), { type: "module" }));
  return client;
}

const isCsv = (file: File): boolean => /\.(csv|tsv|txt)$/i.test(file.name) || file.type === "text/csv" || file.type === "text/tab-separated-values";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

interface Loaded {
  workbook: Workbook<CellInput>;
  warnings: ExcelWarning[];
  detail: string;
}

export function readTab(panel: HTMLElement): void {
  const input = el("input", { type: "file", id: "read-file", accept: ".xlsx,.xlsm,.xltx,.xltm,.csv,.tsv,.txt" });
  const drop = el("div", { className: "drop" }, el("label", { htmlFor: "read-file" }, "Choose a file"), input, el("p", { className: "hint" }, "or drop an .xlsx or .csv here. The file stays in your browser; nothing is uploaded."));
  const always = checkbox("opt-worker", "Always read in a Web Worker", false);
  const infer = checkbox("opt-infer", "CSV: infer numbers, booleans and ISO dates", true);
  const cancel = el("button", { type: "button", disabled: true }, "Cancel");
  const progress = el("progress", { max: 1, value: 0, hidden: true });
  progress.setAttribute("aria-label", "Read progress");
  const live = el("p", { className: "status" });
  live.setAttribute("role", "status");
  const out = el("div", { className: "preview" });
  let controller: AbortController | undefined;

  const show = ({ workbook, warnings, detail }: Loaded): void => {
    const tabs = el("div", { className: "sheet-picker" });
    const picker = el("select", { id: "sheet-select" });
    workbook.sheets.forEach((s, i) => picker.append(el("option", { value: String(i) }, `${s.name}${s.state && s.state !== "visible" ? ` (${s.state})` : ""}`)));
    const label = el("label", { htmlFor: "sheet-select" }, `Sheet (${workbook.sheets.length})`);
    tabs.append(label, picker);
    const view = el("div");
    const render = (): void => {
      const sheet = workbook.sheets[Number(picker.value)] as Sheet<CellInput> | undefined;
      if (!sheet) return void view.replaceChildren(el("p", { className: "hint" }, "The workbook has no sheets."));
      const facts = [
        `${sheet.rows.length} rows`,
        sheet.merges?.length ? `${sheet.merges.length} merges` : "",
        sheet.view?.freeze ? `frozen at ${sheet.view.freeze.rows ?? 0} rows, ${sheet.view.freeze.cols ?? 0} cols` : "",
        sheet.autoFilter ? `autofilter ${sheet.autoFilter}` : "",
      ].filter(Boolean);
      view.replaceChildren(el("p", { className: "hint" }, facts.join(" · ")), renderSheet(sheet, { theme: workbook.theme, caption: `Sheet ${sheet.name}` }));
    };
    picker.addEventListener("change", render);
    render();
    out.replaceChildren(el("p", { className: "hint" }, detail), tabs, view, el("h3", {}, `Warnings (${warnings.length})`), warningList(warnings));
  };

  const load = async (file: File): Promise<void> => {
    controller?.abort();
    const ac = new AbortController();
    controller = ac;
    const useWorker = always.input.checked || file.size >= WORKER_THRESHOLD;
    const where = useWorker ? "in a Web Worker" : "on the main thread";
    status(live, `Reading ${file.name} (${formatBytes(file.size)}) ${where}…`);
    out.replaceChildren();
    cancel.disabled = false;
    progress.hidden = false;
    progress.value = 0;
    const onProgress = (p: Progress): void => void (progress.value = p.ratio);
    const started = performance.now();
    try {
      let loaded: Loaded;
      if (isCsv(file)) {
        const opts = { inferTypes: infer.input.checked, signal: ac.signal };
        const r = useWorker ? await worker().parseCsv(file, opts) : await readCsv(file, opts);
        const delim = r.delimiter === "\t" ? "TAB" : r.delimiter;
        const sheet: Sheet<CellInput> = { name: file.name.replace(/\.[^.]+$/, "").slice(0, 31) || "CSV", rows: r.rows };
        loaded = { workbook: { sheets: [sheet] }, warnings: r.warnings, detail: `CSV, delimiter ${delim}${r.bom ? ", with BOM" : ""}.` };
      } else {
        const opts = { signal: ac.signal, onProgress };
        const r = useWorker ? await worker().read(file, opts) : await read(file, opts);
        loaded = { workbook: r.workbook as Workbook<Cell>, warnings: r.warnings, detail: r.workbook.properties?.title ? `Title: ${r.workbook.properties.title}` : "Workbook." };
      }
      const ms = Math.round(performance.now() - started);
      status(live, `Read ${file.name} ${where} in ${ms} ms.`);
      show(loaded);
    } catch (e) {
      if (controller === ac) status(live, describeError(e), "error");
    } finally {
      if (controller === ac) {
        cancel.disabled = true;
        progress.hidden = true;
        controller = undefined;
      }
    }
  };

  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) void load(f);
  });
  cancel.addEventListener("click", () => {
    controller?.abort();
    status(live, "Cancelled.");
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files[0];
    if (f) void load(f);
  });

  panel.append(
    el("h2", {}, "Read: .xlsx or .csv to the model"),
    drop,
    el("fieldset", {}, el("legend", {}, "Options"), always.wrap, infer.wrap, el("p", { className: "hint" }, `Files of ${formatBytes(WORKER_THRESHOLD)} or more are always read in a Web Worker.`)),
    el("div", { className: "actions" }, cancel, progress),
    live,
    out,
  );
}
