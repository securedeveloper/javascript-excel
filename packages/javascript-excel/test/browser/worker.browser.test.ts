// javascript-excel/worker in a real Web Worker (Chromium), created with the
// bundler pattern of docs/api.md §5.5.
import { afterEach, describe, expect, it } from "vitest";
import { isExcelError } from "../../src/errors";
import { createWorkerClient, type WorkerClient } from "../../src/worker";

let client: WorkerClient | undefined;
afterEach(() => {
  client?.terminate();
  client = undefined;
});

function start(): WorkerClient {
  const worker = new Worker(new URL("./excel.worker.ts", import.meta.url), { type: "module" });
  client = createWorkerClient(worker);
  return client;
}

const rows = (n: number) => Array.from({ length: n }, (_, r) => [r, `row ${r}`, { value: r % 2 === 0, style: { font: { bold: true } } }]);

describe("Web Worker in Chromium", () => {
  it("write and read round-trip off the main thread", async () => {
    const excel = start();
    const ratios: number[] = [];
    const bytes = await excel.write({ sheets: [{ name: "S", rows: rows(5000) }] }, { onProgress: (p) => ratios.push(p.ratio) });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(ratios.at(-1)).toBe(1);
    const { workbook } = await excel.read(bytes, { transfer: true });
    expect(bytes.byteLength).toBe(0); // transferred
    expect(workbook.sheets[0]!.rows).toHaveLength(5000);
    expect(workbook.sheets[0]!.rows[4]![1]!.value).toBe("row 4");
  });

  it("CSV, a Blob input, and errors with their class", async () => {
    const excel = start();
    expect(await excel.toCsv([["a", "=b"]])).toBe("a,'=b\r\n");
    const parsed = await excel.parseCsv(new Blob(["x;y\n1;2\n"]), { inferTypes: true });
    expect(parsed.rows).toEqual([["x", "y"], [1, 2]]);
    const err = await excel.read(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
    expect(isExcelError(err)).toBe(true);
    expect(err).toMatchObject({ name: "FormatError", code: "UNSUPPORTED_FORMAT" });
  });

  it("abort rejects with the signal's reason and the worker keeps serving", async () => {
    const excel = start();
    const ac = new AbortController();
    const p = excel.write({ sheets: [{ name: "S", rows: rows(50_000) }] }, { signal: ac.signal });
    setTimeout(() => ac.abort(new Error("stop")), 10);
    await expect(p).rejects.toThrow("stop");
    expect(await excel.toCsv([["ok"]])).toBe("ok\r\n");
  });

  it("the main thread stays responsive during a 300k-cell write in the worker", async () => {
    const excel = start();
    let longest = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    await excel.write({ sheets: [{ name: "S", rows: rows(100_000) }] });
    clearInterval(timer);
    console.log(`longest main-thread gap during a 300k-cell worker write: ${longest.toFixed(0)} ms`);
    // Structured clone of the 300k-cell model happens on the main thread; everything else is off it.
    expect(longest).toBeLessThan(500); // measured 77 ms in Chromium on an Apple-silicon laptop
  });
});
