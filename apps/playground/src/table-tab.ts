import { toBlob, type ExcelWarning } from "javascript-excel";
import { toCsvBlob } from "javascript-excel/csv";
import { download, fromTable } from "javascript-excel/dom";
import { renderSheet } from "./render";
import { checkbox, describeError, el, status, warningList } from "./util";

/** A static demo table: header group, a merged cell, a link, a hidden row and an ignored column. */
function demoTable(): HTMLTableElement {
  const t = document.createElement("table");
  t.className = "demo";
  t.id = "demo-table";
  const cap = t.createCaption();
  cap.textContent = "Team budget (the table that gets exported)";
  const h = t.createTHead();
  const h1 = h.insertRow();
  const add = (row: HTMLTableRowElement, tag: "th" | "td", text: string, attrs: Record<string, string> = {}): HTMLTableCellElement => {
    const c = document.createElement(tag);
    c.textContent = text;
    for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
    row.append(c);
    return c;
  };
  add(h1, "th", "Team", { rowspan: "2", scope: "col" });
  add(h1, "th", "Budget", { colspan: "2", scope: "colgroup" });
  add(h1, "th", "Notes (not exported)", { rowspan: "2", scope: "col", "data-export-ignore": "" });
  const h2 = h.insertRow();
  add(h2, "th", "2025", { scope: "col" });
  add(h2, "th", "2026", { scope: "col" });
  const b = t.createTBody();
  const rows: Array<[string, string, string, string]> = [
    ["Design", "12000", "14500", "Hiring one"],
    ["Engineering", "48000", "52000", ""],
    ["Support", "9000", "9000", "Flat"],
  ];
  for (const [team, a, c, note] of rows) {
    const r = b.insertRow();
    add(r, "th", team, { scope: "row" });
    add(r, "td", a, { "data-type": "number", "data-numfmt": "#,##0" });
    add(r, "td", c, { "data-type": "number", "data-numfmt": "#,##0" });
    add(r, "td", note, { "data-export-ignore": "" });
  }
  const hidden = b.insertRow();
  hidden.hidden = true;
  add(hidden, "th", "Hidden row (skipped)");
  add(hidden, "td", "0");
  add(hidden, "td", "0");
  add(hidden, "td", "");
  const linkRow = b.insertRow();
  const linkCell = add(linkRow, "td", "", { colspan: "3" });
  const a = document.createElement("a");
  a.href = "https://www.npmjs.com/package/javascript-excel";
  a.textContent = "javascript-excel on npm (exported as a hyperlink)";
  linkCell.append(a);
  add(linkRow, "td", "", { "data-export-ignore": "" });
  return t;
}

export function tableTab(panel: HTMLElement): void {
  const table = demoTable();
  const computed = checkbox("opt-computed", "Export computed styles (colours, bold, alignment)", true);
  const infer = checkbox("opt-table-infer", "Infer numbers from plain text", false);
  const freeze = checkbox("opt-table-freeze", "Freeze header rows", true);
  const auto = checkbox("opt-table-auto", "Auto column width", true);
  const xlsx = el("button", { type: "button" }, "Download .xlsx");
  const csv = el("button", { type: "button" }, "Download .csv");
  const live = el("p", { className: "status" });
  live.setAttribute("role", "status");
  const preview = el("div", { className: "preview" });

  const convert = (): ReturnType<typeof fromTable> | undefined => {
    const warnings: ExcelWarning[] = [];
    try {
      const sheet = fromTable(table, {
        name: "Budget",
        styles: computed.input.checked ? "computed" : "none",
        inferTypes: infer.input.checked,
        freezeHeader: freeze.input.checked,
        autoWidth: auto.input.checked,
        onWarning: (w) => warnings.push(w),
      });
      preview.replaceChildren(renderSheet(sheet, { caption: "Preview of the converted sheet" }), el("h3", {}, "Warnings"), warningList(warnings));
      return sheet;
    } catch (e) {
      status(live, describeError(e), "error");
      return undefined;
    }
  };

  xlsx.addEventListener("click", async () => {
    const sheet = convert();
    if (!sheet) return;
    try {
      download(await toBlob({ sheets: [sheet] }), "table.xlsx");
      status(live, "Saved table.xlsx.");
    } catch (e) {
      status(live, describeError(e), "error");
    }
  });
  csv.addEventListener("click", () => {
    const sheet = convert();
    if (!sheet) return;
    download(toCsvBlob(sheet), "table.csv");
    status(live, "Saved table.csv.");
  });
  for (const c of [computed, infer, freeze, auto]) c.input.addEventListener("change", () => convert());

  panel.append(
    el("h2", {}, "Table: HTML <table> to .xlsx"),
    el("p", { className: "hint" }, "fromTable reads the table below: rowspan/colspan become merges, data-type and data-numfmt set types and formats, data-export-ignore and hidden rows are skipped, links become hyperlinks."),
    el("div", { className: "sheet-scroll", tabIndex: 0 }, table),
    el("fieldset", {}, el("legend", {}, "Options"), computed.wrap, infer.wrap, freeze.wrap, auto.wrap),
    el("div", { className: "actions" }, xlsx, csv),
    live,
    preview,
  );
  convert();
}
