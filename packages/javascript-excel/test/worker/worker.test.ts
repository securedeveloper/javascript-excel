/// <reference types="node" />
// The worker protocol over a real MessageChannel (structured clone and
// transfer included), and over a real thread (node:worker_threads).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { isExcelError } from "../../src/errors";
import type { Workbook } from "../../src/model";
import { read } from "../../src/read";
import { createWorkerClient, exposeWorker, type WorkerLike } from "../../src/worker";
import { toUint8Array } from "../../src/write";

const ports: Array<{ close(): void }> = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

/** A client and a worker connected by a MessageChannel in this thread. */
function pair(): { client: ReturnType<typeof createWorkerClient>; sent: unknown[]; terminated: () => boolean } {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  const sent: unknown[] = [];
  let terminated = false;
  const worker: WorkerLike = {
    postMessage: (m, t) => {
      sent.push(m);
      port1.postMessage(m, (t ?? []) as never);
    },
    addEventListener: (type, l) => (port1 as unknown as { addEventListener(t: string, l: unknown): void }).addEventListener(type, l),
    terminate: () => {
      terminated = true;
      port1.close();
    },
  };
  exposeWorker(port2 as unknown as Parameters<typeof exposeWorker>[0]);
  port1.start();
  port2.start();
  return { client: createWorkerClient(worker), sent, terminated: () => terminated };
}

const wb = (rows = 2000): Workbook => ({
  properties: { created: new Date(0), modified: new Date(0) },
  sheets: [{ name: "S", rows: Array.from({ length: rows }, (_, r) => [r, `row ${r}`, new Date(Date.UTC(2024, 0, 1 + (r % 28))), { value: r % 2 === 0, style: { font: { bold: true } } }]) }],
});

describe("worker client over a MessageChannel", () => {
  it("write: same bytes as on the main thread; the result is transferred", async () => {
    const { client } = pair();
    const bytes = await client.write(wb(), { dateZone: "utc" });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toEqual(await toUint8Array(wb(), { dateZone: "utc" }));
  });

  it("read: same result as on the main thread, warnings via onWarning", async () => {
    const { client } = pair();
    const bytes = await toUint8Array(wb(50), { dateZone: "utc" });
    const warnings: string[] = [];
    const r = await client.read(bytes, { dateZone: "utc", onWarning: (w) => warnings.push(w.code) });
    expect(r).toEqual(await read(bytes, { dateZone: "utc" }));
    expect(warnings).toEqual([]);
  });

  it("toCsv and parseCsv (string and bytes)", async () => {
    const { client } = pair();
    const csv = await client.toCsv([["a", 1], ["=x", true]]);
    expect(csv).toBe("a,1\r\n'=x,TRUE\r\n");
    expect((await client.parseCsv(csv)).rows).toEqual([["a", "1"], ["'=x", "TRUE"]]);
    expect((await client.parseCsv(new TextEncoder().encode("x;y\n1;2\n"), { inferTypes: true })).rows).toEqual([["x", "y"], [1, 2]]);
  });

  it("progress crosses the boundary, monotonic and ending at 1", async () => {
    const { client } = pair();
    const ratios: number[] = [];
    await client.write(wb(20_000), { onProgress: (p) => ratios.push(p.ratio) });
    expect(ratios.length).toBeGreaterThan(1);
    expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);
    expect(ratios.at(-1)).toBe(1);
  });

  it("errors keep their class and code (isExcelError works)", async () => {
    const { client } = pair();
    const err = await client.write({ sheets: [] }).catch((e: unknown) => e);
    expect(isExcelError(err)).toBe(true);
    expect(err).toMatchObject({ name: "ValidationError", code: "NO_SHEETS" });
    const err2 = await client.read(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
    expect(err2).toMatchObject({ name: "FormatError", code: "UNSUPPORTED_FORMAT", details: { format: "unknown" } });
    const err3 = await client.parseCsv("a", { delimiter: ",," }).catch((e: unknown) => e);
    expect(err3).toBeInstanceOf(TypeError);
  });

  it("functions in options are rejected before anything is sent", async () => {
    const { client, sent } = pair();
    await expect(client.toCsv([["x"]], { dates: (d) => d.toISOString() })).rejects.toThrow(/cannot be sent to a worker/);
    expect(sent).toEqual([]);
  });

  it("abort: rejects with signal.reason and cancels the job in the worker", async () => {
    const { client, sent } = pair();
    const ac = new AbortController();
    const reason = new Error("stop");
    const p = client.write(wb(50_000), { signal: ac.signal });
    setTimeout(() => ac.abort(reason), 5);
    await expect(p).rejects.toBe(reason);
    expect(sent.some((m) => (m as { cancel?: boolean }).cancel === true)).toBe(true);
    // The worker keeps serving later calls.
    expect((await client.toCsv([["ok"]]))).toBe("ok\r\n");
    const ac2 = new AbortController();
    ac2.abort();
    await expect(client.read(new Uint8Array(4), { signal: ac2.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("calls run one after another and each gets its own result", async () => {
    const { client } = pair();
    const results = await Promise.all([client.toCsv([["1"]]), client.write(wb(10)), client.toCsv([["2"]]), client.parseCsv("x\n")]);
    expect(results[0]).toBe("1\r\n");
    expect(results[1]).toBeInstanceOf(Uint8Array);
    expect(results[2]).toBe("2\r\n");
    expect((results[3] as { rows: unknown }).rows).toEqual([["x"]]);
  });

  it("transfer: true detaches the caller's buffer; the default copies it", async () => {
    const { client } = pair();
    const a = await toUint8Array(wb(10));
    const b = a.slice();
    await client.read(a);
    expect(a.byteLength).toBeGreaterThan(0);
    await client.read(b, { transfer: true });
    expect(b.byteLength).toBe(0);
  });

  it("terminate rejects calls in flight with an AbortError", async () => {
    const { client, terminated } = pair();
    const p = client.write(wb(100_000));
    client.terminate();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(terminated()).toBe(true);
  });

  it("ignores messages that are not the library's", async () => {
    const { client } = pair();
    expect(await client.toCsv([["a"]])).toBe("a\r\n");
  });

  it("exposeWorker outside a worker throws ENVIRONMENT_UNSUPPORTED", () => {
    expect(() => exposeWorker()).toThrow(expect.objectContaining({ code: "ENVIRONMENT_UNSUPPORTED" }));
  });
});

// Needs the built package (dist/); `npm run smoke` runs the same check on the packed tarball after the build.
const built = existsSync(fileURLToPath(new URL("../../dist/worker.js", import.meta.url)));

describe.skipIf(!built)("worker client on a real thread", () => {
  it("node:worker_threads running exposeWorker on its parentPort", { timeout: 60_000 }, async () => {
    const script = fileURLToPath(new URL("./node-worker.mjs", import.meta.url));
    const dist = new URL("../../dist/worker.js", import.meta.url).href;
    const t = new NodeWorker(script, { workerData: { dist } });
    const worker: WorkerLike = {
      postMessage: (m, tr) => t.postMessage(m, (tr ?? []) as never),
      addEventListener: (type, l) => t.on(type, (data: unknown) => l(type === "message" ? { data } : (data as { data: unknown }))),
      terminate: () => void t.terminate(),
    };
    const client = createWorkerClient(worker);
    try {
      const bytes = await client.write(wb(1000), { dateZone: "utc" });
      const r = await client.read(bytes, { dateZone: "utc" });
      expect(r.workbook.sheets[0]!.rows).toHaveLength(1000);
    } finally {
      client.terminate();
    }
  });
});
