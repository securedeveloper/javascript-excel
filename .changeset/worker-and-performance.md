---
"javascript-excel": minor
---

Add `javascript-excel/worker`: `exposeWorker()` for the app's two-line worker file and `createWorkerClient(worker)` with `write`, `read`, `toCsv` and `parseCsv`; progress, warnings and AbortSignal work across the boundary, results are transferred, errors keep their class and code. Performance: the shared strings table is written in chunks (no long main-thread block for large tables), CRC-32 uses slicing-by-8, and `onProgress` is throttled to one event per 50 ms.
