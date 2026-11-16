import { fromDataset, toBlob, type Dataset, type DatasetOptions, type ExcelWarning } from "javascript-excel";
import { toCsvBlob } from "javascript-excel/csv";
import { download } from "javascript-excel/dom";
import { renderSheet } from "./render";
import { checkbox, describeError, el, status, warningList } from "./util";

const SAMPLE = {
  columns: [
    { title: "Name", key: "name" },
    { title: "Joined", key: "joined", type: "date", numFmt: "yyyy-mm-dd" },
    {
      title: "Sales",
      children: [
        { title: "Q1", path: "sales.q1", numFmt: "#,##0.00", total: "sum" },
        { title: "Q2", path: "sales.q2", numFmt: "#,##0.00", total: "sum" },
      ],
    },
  ],
  data: [
    { name: "Ada", joined: "2024-01-15", sales: { q1: 1200.5, q2: 980 } },
    { name: "Grace", joined: "2023-06-01", sales: { q1: 860, q2: 1430.25 } },
    { name: "Linus", joined: "2022-11-30", sales: { q1: 0, q2: 75.5 } },
  ],
};

export function writeTab(panel: HTMLElement): void {
  const area = el("textarea", { id: "dataset", rows: 18, spellcheck: false, value: JSON.stringify(SAMPLE, null, 2) });
  area.setAttribute("aria-describedby", "dataset-help");
  const help = el("p", { id: "dataset-help", className: "hint" }, "A dataset as JSON: ", el("code", {}, "{ columns, data }"), ". Columns support key, path, title, type, numFmt, width, total and children (header groups).");
  const freeze = checkbox("opt-freeze", "Freeze header rows", true);
  const filter = checkbox("opt-filter", "Autofilter", true);
  const auto = checkbox("opt-auto", "Auto column width", true);
  const totals = checkbox("opt-totals", "Totals label", true);
  const band = checkbox("opt-band", "Banded rows", false);
  const fill = el("select", { id: "opt-fill" });
  for (const [value, label] of [["", "No header fill"], ["DDEBF7", "Light blue"], ["E2EFDA", "Light green"], ["FCE4D6", "Light orange"]] as const) fill.append(el("option", { value }, label));
  fill.value = "DDEBF7";
  const fillWrap = el("div", { className: "field" }, el("label", { htmlFor: "opt-fill" }, "Header fill"), fill);
  const xlsx = el("button", { type: "button" }, "Download .xlsx");
  const csv = el("button", { type: "button" }, "Download .csv");
  const live = el("p", { className: "status" });
  live.setAttribute("role", "status");
  const preview = el("div", { className: "preview" });

  const build = (): ReturnType<typeof fromDataset> | undefined => {
    let dataset: Dataset<unknown>;
    try {
      dataset = JSON.parse(area.value) as Dataset<unknown>;
    } catch (e) {
      status(live, `The dataset is not valid JSON: ${describeError(e)}`, "error");
      return undefined;
    }
    const warnings: ExcelWarning[] = [];
    const options: DatasetOptions<unknown> = {
      name: "Dataset",
      freezeHeader: freeze.input.checked,
      autoFilter: filter.input.checked,
      autoWidth: auto.input.checked,
      headerStyle: { font: { bold: true }, ...(fill.value ? { fill: fill.value } : {}) },
      onWarning: (w) => warnings.push(w),
    };
    if (totals.input.checked) options.totals = { label: "Total", style: { font: { bold: true } } };
    if (band.input.checked) {
      const stripe = { fill: "F2F2F2" };
      options.rowStyle = (_row, i) => (i % 2 ? stripe : undefined);
    }
    try {
      const sheet = fromDataset(dataset, options);
      preview.replaceChildren(renderSheet(sheet, { caption: "Preview of the generated sheet" }), el("h3", {}, "Warnings"), warningList(warnings));
      status(live, `Built a sheet with ${sheet.rows.length} rows.`);
      return sheet;
    } catch (e) {
      status(live, describeError(e), "error");
      preview.replaceChildren();
      return undefined;
    }
  };

  xlsx.addEventListener("click", async () => {
    const sheet = build();
    if (!sheet) return;
    try {
      download(await toBlob({ sheets: [sheet], properties: { title: "javascript-excel playground" } }), "dataset.xlsx");
      status(live, "Saved dataset.xlsx.");
    } catch (e) {
      status(live, describeError(e), "error");
    }
  });
  csv.addEventListener("click", () => {
    const sheet = build();
    if (!sheet) return;
    try {
      download(toCsvBlob(sheet), "dataset.csv");
      status(live, "Saved dataset.csv (UTF-8 with BOM, formula-injection guard on).");
    } catch (e) {
      status(live, describeError(e), "error");
    }
  });
  for (const input of [area, freeze.input, filter.input, auto.input, totals.input, band.input, fill]) input.addEventListener("change", () => build());

  panel.append(
    el("h2", {}, "Write: dataset to .xlsx or .csv"),
    el("div", { className: "field" }, el("label", { htmlFor: "dataset" }, "Dataset (JSON)"), area, help),
    el("fieldset", {}, el("legend", {}, "Options"), freeze.wrap, filter.wrap, auto.wrap, totals.wrap, band.wrap, fillWrap),
    el("div", { className: "actions" }, xlsx, csv),
    live,
    preview,
  );
  build();
}
