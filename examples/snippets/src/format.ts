import { formatCell, formatValue } from "javascript-excel/format";
import { read } from "javascript-excel/read";

formatValue(1234.5, "#,##0.00"); // { text: "1,234.50", align: "right" }
formatValue(-12.5, "0.0;[Red]-0.0").color; // "FFFF0000"
formatValue(45306, "dddd, mmmm d, yyyy", { locale: "de-DE" }).text; // "Montag, Januar 15, 2024"

declare const file: Blob;
const { workbook } = await read(file, { dates: "serial" }); // serials: formatting does not depend on the time zone
const shown = formatCell(workbook.sheets[0]?.rows[0]?.[0], { locale: navigator.language, date1904: workbook.date1904 });
