// Measures, for each .xlsx given, what the reader's limits see: input size,
// entry count, per-entry inflated size and compression ratio, XML depth,
// cells and shared strings. Run after `npm run build`:
//   node test/fixtures/read/measure_limits.mjs <file.xlsx>...
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { read } from "../../../dist/read.js";

const rows = [];
for (const file of process.argv.slice(2)) {
  const bytes = readFileSync(file);
  // Entry table from the central directory (sizes as declared; the reader checks them while inflating).
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  let maxRatio = 0;
  let maxRatioEntry = "";
  let maxEntry = 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const comp = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extra = view.getUint16(p + 30, true);
    const comment = view.getUint16(p + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    total += size;
    if (size > maxEntry) maxEntry = size;
    if (size > 1024 * 1024 && size / Math.max(1, comp) > maxRatio) {
      maxRatio = size / Math.max(1, comp);
      maxRatioEntry = name;
    }
    p += 46 + nameLen + extra + comment;
  }
  // XML depth: the reader with maxXmlDepth lowered until it fails.
  let depth = 1;
  for (; depth < 64; depth++) {
    try {
      await read(bytes, { limits: { maxXmlDepth: depth, maxRatio: 1e9 }, styles: false });
      break;
    } catch (e) {
      if (e?.details?.limit !== "maxXmlDepth") throw e;
    }
  }
  const t0 = performance.now();
  const r = await read(bytes, { limits: { maxRatio: 1e9 } });
  const ms = performance.now() - t0;
  const cells = r.workbook.sheets.reduce((n, s) => n + s.rows.reduce((m, row) => m + (row ? row.filter((c) => c !== undefined).length : 0), 0), 0);
  rows.push({
    file: basename(file),
    inputMB: +(bytes.length / 2 ** 20).toFixed(2),
    entries: count,
    largestEntryMB: +(maxEntry / 2 ** 20).toFixed(1),
    totalInflatedMB: +(total / 2 ** 20).toFixed(1),
    maxRatioOver1MiB: +maxRatio.toFixed(0),
    ratioEntry: maxRatioEntry,
    xmlDepth: depth,
    cells,
    readMs: Math.round(ms),
  });
}
console.table(rows);
console.log(JSON.stringify(rows));
