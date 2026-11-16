import { importDataset } from "javascript-excel/import";

declare const file: File; // from <input type="file"> or a drop
const { columns, data, issues, meta } = await importDataset(file, {
  locale: { decimal: ",", group: "." }, // 1.234,56
  schema: { fields: { email: { aliases: ["E-mail"], required: true }, joined: { type: "date" } } },
  maxRows: 100_000,
});
console.log(meta.header, columns.map((c) => `${c.key}: ${c.type}`), data.length, issues);
