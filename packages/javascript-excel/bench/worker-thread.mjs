// The worker side of bench/worker.mjs: the two-line worker file, adapted to node:worker_threads.
import { parentPort, workerData } from "node:worker_threads";
const { exposeWorker } = await import(workerData.dist);
exposeWorker({ postMessage: (m, t) => parentPort.postMessage(m, t), addEventListener: (type, l) => parentPort.on(type, (data) => l({ data })) });
