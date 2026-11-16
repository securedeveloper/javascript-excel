/**
 * javascript-excel/worker: run big jobs in a Web Worker (docs/api.md §5.5).
 *
 * The app writes the worker file itself (two lines):
 *
 *   // excel.worker.ts
 *   import { exposeWorker } from 'javascript-excel/worker';
 *   exposeWorker();
 *
 * and talks to it from the main thread:
 *
 *   const worker = new Worker(new URL('./excel.worker.ts', import.meta.url), { type: 'module' });
 *   const excel = createWorkerClient(worker);
 *   const bytes = await excel.write(workbook, { onProgress, signal });
 *
 * `onProgress`, `onWarning` and `signal` work across the boundary. Results
 * (`Uint8Array`) are transferred, not copied; inputs are copied unless
 * `transfer: true`. Calls on one client run one after another. Code that
 * imports only `createWorkerClient` does not ship the engine: the writer,
 * reader and CSV code are referenced from `exposeWorker` alone.
 */

import type { BinaryInput } from "./binary";
import type { CsvParseOptions, CsvParseResult, CsvReadOptions, CsvWriteOptions } from "./csv";
import { readCsv, toCsv } from "./csv";
import { CsvError, EnvironmentError, ExcelError, FormatError, isExcelError, LimitError, ValidationError, type ExcelErrorCode } from "./errors";
import type { CellInput, Sheet, Workbook } from "./model";
import { read, type ReadOptions, type ReadResult } from "./read";
import type { AbortSignalLike } from "./signal";
import type { ExcelWarning } from "./warnings";
import { toUint8Array, type Progress, type WriteOptions } from "./write";

export type { AbortSignalLike } from "./signal";
export type { Progress } from "./write";

/** The side of a message channel the library uses: a `Worker`, the worker's `self`, or a `MessagePort`. */
export interface MessageEndpoint {
  postMessage(message: unknown, transfer?: unknown[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
}

/** A `Worker` (or anything with the same members). */
export interface WorkerLike extends MessageEndpoint {
  terminate(): void;
  addEventListener(type: "message" | "error", listener: (event: { data: unknown }) => void): void;
}

/** Options every client call accepts, on top of the call's own options. */
export interface TransferOption {
  /** Transfer an input `ArrayBuffer` or `Uint8Array` to the worker instead of copying it; it is detached in the caller. Default false. */
  transfer?: boolean | undefined;
}

/** The main-thread side of a worker running `exposeWorker()`. */
export interface WorkerClient {
  write(wb: Workbook, options?: WriteOptions & TransferOption): Promise<Uint8Array>;
  read(input: BinaryInput, options?: ReadOptions & TransferOption): Promise<ReadResult>;
  toCsv(source: Sheet | CellInput[][], options?: CsvWriteOptions): Promise<string>;
  parseCsv(input: string | BinaryInput, options?: (CsvParseOptions & Pick<CsvReadOptions, "encoding" | "signal">) & TransferOption): Promise<CsvParseResult>;
  /** Terminates the worker. Calls still in flight reject with an `AbortError`. */
  terminate(): void;
}

type Op = "write" | "read" | "toCsv" | "parseCsv";

/** Marks the library's messages, so an app can use the same worker for its own messages too. */
const TAG = "javascript-excel/worker@1";

interface Request {
  tag: typeof TAG;
  id: number;
  op?: Op;
  input?: unknown;
  options?: Record<string, unknown>;
  progress?: boolean;
  warnings?: boolean;
  cancel?: boolean;
}

interface SerializedError {
  name: string;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  excel: boolean;
}

interface Response {
  tag: typeof TAG;
  id: number;
  progress?: Progress;
  warning?: ExcelWarning;
  done?: boolean;
  result?: unknown;
  error?: SerializedError;
}

function isTagged(v: unknown): v is { tag: string; id: number } {
  return typeof v === "object" && v !== null && (v as { tag?: unknown }).tag === TAG && typeof (v as { id?: unknown }).id === "number";
}

function abortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

// ------------------------------------------------------------------ worker side

/**
 * Serves requests from `createWorkerClient` on `scope` (default: the worker's
 * global scope, `self`). Call it once at the top of the worker file.
 */
export function exposeWorker(scope?: MessageEndpoint): void {
  const ep = scope ?? (globalThis as unknown as Partial<MessageEndpoint>);
  if (typeof ep.postMessage !== "function" || typeof ep.addEventListener !== "function") {
    throw new EnvironmentError("ENVIRONMENT_UNSUPPORTED", "exposeWorker() must run inside a worker (no postMessage/addEventListener here).", {
      details: { api: "postMessage" },
    });
  }
  const endpoint = ep as MessageEndpoint;
  const controllers = new Map<number, { aborted: boolean; reason: unknown }>();
  let queue: Promise<void> = Promise.resolve();

  endpoint.addEventListener("message", (event) => {
    const msg = event.data;
    if (!isTagged(msg)) return;
    const req = msg as Request;
    if (req.cancel) {
      const c = controllers.get(req.id);
      if (c) {
        c.aborted = true;
        c.reason = abortError("The operation was aborted.");
      }
      return;
    }
    const state = { aborted: false, reason: undefined as unknown };
    controllers.set(req.id, state);
    queue = queue.then(() => run(endpoint, req, state)).finally(() => controllers.delete(req.id));
  });
}

async function run(ep: MessageEndpoint, req: Request, signal: { aborted: boolean; reason: unknown }): Promise<void> {
  const post = (r: Omit<Response, "tag" | "id">, transfer?: unknown[]): void => ep.postMessage({ tag: TAG, id: req.id, ...r }, transfer);
  try {
    if (signal.aborted) throw signal.reason;
    const options: Record<string, unknown> = { ...(req.options ?? {}), signal: signal as AbortSignalLike };
    if (req.progress) options["onProgress"] = (p: Progress) => post({ progress: p });
    if (req.warnings) options["onWarning"] = (w: ExcelWarning) => post({ warning: w });
    switch (req.op) {
      case "write": {
        const bytes = await toUint8Array(req.input as Workbook, options as WriteOptions);
        post({ done: true, result: bytes }, [bytes.buffer]);
        return;
      }
      case "read": {
        const result = await read(req.input as BinaryInput, options as ReadOptions);
        post({ done: true, result });
        return;
      }
      case "toCsv": {
        delete options["signal"];
        post({ done: true, result: toCsv(req.input as Sheet | CellInput[][], options as CsvWriteOptions) });
        return;
      }
      case "parseCsv": {
        const result = await readCsv(req.input as string | BinaryInput, options as CsvReadOptions);
        post({ done: true, result });
        return;
      }
      default:
        throw new TypeError(`Unknown worker operation ${JSON.stringify(req.op)}`);
    }
  } catch (err) {
    post({ done: true, error: serializeError(err) });
  }
}

function serializeError(err: unknown): SerializedError {
  if (isExcelError(err)) {
    const out: SerializedError = { name: err.name, message: err.message, code: err.code, excel: true };
    if (err.details !== undefined) out.details = err.details;
    return out;
  }
  if (err instanceof Error) return { name: err.name, message: err.message, excel: false };
  return { name: "Error", message: String(err), excel: false };
}

// ------------------------------------------------------------------ main-thread side

const EXCEL_CLASSES: Record<string, new (code: ExcelErrorCode, message: string, options?: { details?: Record<string, unknown> }) => ExcelError> = {
  ValidationError,
  FormatError,
  LimitError,
  CsvError,
  EnvironmentError,
  ExcelError,
};

function deserializeError(e: SerializedError): Error {
  if (e.excel) {
    const Ctor = Object.prototype.hasOwnProperty.call(EXCEL_CLASSES, e.name) ? EXCEL_CLASSES[e.name]! : ExcelError;
    return new Ctor(e.code as ExcelErrorCode, e.message, e.details === undefined ? undefined : { details: e.details });
  }
  const Std: Record<string, ErrorConstructor> = { TypeError, RangeError, SyntaxError, ReferenceError };
  const Ctor = Object.prototype.hasOwnProperty.call(Std, e.name) ? Std[e.name]! : Error;
  const err = new Ctor(e.message);
  if (err.name !== e.name) err.name = e.name;
  return err;
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
  onProgress?: ((p: Progress) => void) | undefined;
  onWarning?: ((w: ExcelWarning) => void) | undefined;
  cleanup(): void;
}

interface SignalWithEvents extends AbortSignalLike {
  addEventListener?(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener?(type: "abort", listener: () => void): void;
}

/** Wraps a worker that runs `exposeWorker()`. */
export function createWorkerClient(worker: WorkerLike): WorkerClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  worker.addEventListener("message", (event) => {
    const msg = event.data;
    if (!isTagged(msg)) return;
    const res = msg as Response;
    const p = pending.get(res.id);
    if (!p) return;
    if (res.progress) p.onProgress?.(res.progress);
    if (res.warning) p.onWarning?.(res.warning);
    if (!res.done) return;
    pending.delete(res.id);
    p.cleanup();
    if (res.error) p.reject(deserializeError(res.error));
    else p.resolve(res.result);
  });
  worker.addEventListener("error", (event) => {
    const reason = new EnvironmentError("ENVIRONMENT_UNSUPPORTED", "The worker failed (see the worker's console for details).", {
      details: { api: "Worker", event: String((event as { message?: unknown }).message ?? "") },
    });
    for (const [id, p] of pending) {
      pending.delete(id);
      p.cleanup();
      p.reject(reason);
    }
  });

  function call(op: Op, input: unknown, options: Record<string, unknown> | undefined): Promise<unknown> {
    const o = { ...(options ?? {}) };
    const signal = o["signal"] as SignalWithEvents | undefined;
    const onProgress = o["onProgress"] as ((p: Progress) => void) | undefined;
    const onWarning = o["onWarning"] as ((w: ExcelWarning) => void) | undefined;
    const transfer = o["transfer"] === true;
    delete o["signal"];
    delete o["onProgress"];
    delete o["onWarning"];
    delete o["transfer"];
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "function") return Promise.reject(new TypeError(`options.${k} is a function, which cannot be sent to a worker`));
    }
    if (signal?.aborted) return Promise.reject(signal.reason ?? abortError("The operation was aborted."));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        if (!pending.has(id)) return;
        pending.delete(id);
        worker.postMessage({ tag: TAG, id, cancel: true } satisfies Request);
        reject(signal?.reason ?? abortError("The operation was aborted."));
      };
      signal?.addEventListener?.("abort", onAbort, { once: true });
      pending.set(id, {
        resolve,
        reject,
        onProgress,
        onWarning,
        cleanup: () => signal?.removeEventListener?.("abort", onAbort),
      });
      const req: Request = { tag: TAG, id, op, input, options: o, progress: onProgress !== undefined, warnings: onWarning !== undefined };
      const list: unknown[] = [];
      if (transfer) {
        if (input instanceof ArrayBuffer) list.push(input);
        else if (input instanceof Uint8Array) list.push(input.buffer);
      }
      try {
        worker.postMessage(req, list);
      } catch (err) {
        pending.delete(id);
        signal?.removeEventListener?.("abort", onAbort);
        reject(err);
      }
    });
  }

  return {
    write: (wb, options) => call("write", wb, options as Record<string, unknown> | undefined) as Promise<Uint8Array>,
    read: (input, options) => call("read", input, options as Record<string, unknown> | undefined) as Promise<ReadResult>,
    toCsv: (source, options) => call("toCsv", source, options as Record<string, unknown> | undefined) as Promise<string>,
    parseCsv: (input, options) => call("parseCsv", input, options as Record<string, unknown> | undefined) as Promise<CsvParseResult>,
    terminate: () => {
      worker.terminate();
      for (const [id, p] of pending) {
        pending.delete(id);
        p.cleanup();
        p.reject(abortError("The worker was terminated."));
      }
    },
  };
}
