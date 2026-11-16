import { toBlob } from "javascript-excel";
import { download, fromTable } from "javascript-excel/dom";

const table = document.querySelector("table")!;
const sheet = fromTable(table, { styles: "computed", freezeHeader: true, autoWidth: true });
download(await toBlob({ sheets: [sheet] }), "report.xlsx");
