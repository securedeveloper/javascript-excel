// The two-line worker file of docs/api.md §5.5, for node:worker_threads (the
// tests' stand-in for a Web Worker): exposeWorker on the parent port.
import { parentPort, workerData } from "node:worker_threads";
const { exposeWorker } = await import(workerData.dist);
exposeWorker({
  postMessage: (m, t) => parentPort.postMessage(m, t),
  addEventListener: (type, l) => parentPort.on(type, (data) => l({ data })),
});
