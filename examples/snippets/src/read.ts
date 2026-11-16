import { read } from "javascript-excel/read";

declare const file: Blob; // a File from <input type="file">, a Uint8Array or an ArrayBuffer

const { workbook, warnings } = await read(file);
for (const sheet of workbook.sheets) {
  console.log(sheet.name, sheet.dimension, sheet.rows[0]?.map((cell) => cell?.value));
}
