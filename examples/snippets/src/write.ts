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
