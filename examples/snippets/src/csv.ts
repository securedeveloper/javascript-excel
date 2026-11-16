import { parseCsv, readCsv, toCsv, toCsvBlob } from "javascript-excel/csv";

const text = toCsv([["name", "amount"], ["Ada", 1250.5], ["=1+1", -5]]); // "=1+1" is written as "'=1+1"
const blob = toCsvBlob([["name"], ["Ada"]]); // UTF-8 with a BOM, so Excel opens it correctly

const { rows, delimiter } = parseCsv("name;amount\nAda;1250,50\n"); // detects ";"
declare const upload: Blob;
const typed = await readCsv(upload, { inferTypes: true }); // numbers, TRUE/FALSE and ISO dates typed
