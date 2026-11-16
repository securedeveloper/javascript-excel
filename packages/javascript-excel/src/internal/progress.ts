/**
 * onProgress throttling shared by the writer and the reader (docs/api.md §5.1). Internal.
 *
 * Unthrottled, the reader reported every inflated chunk: 2,011 events in
 * 649 ms for 1M cells (one every 0.3 ms), and the writer one every 7 ms
 * (JSE-8 measurements, Node 24). A UI cannot use more than a few updates per
 * frame, and through a worker every event is a postMessage, so events are
 * limited to one per PROGRESS_INTERVAL_MS. The first event, every change of
 * phase or sheet, and the final ratio 1 are always delivered.
 */

import type { Progress } from "../write";

/** Minimum time between two progress events, in milliseconds. */
export const PROGRESS_INTERVAL_MS = 50;

const clock: () => number = (() => {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === "function" ? () => perf.now() : () => Date.now();
})();

/** Wraps a progress callback: monotonic ratio, throttled. Returns undefined when there is no callback. */
export function throttleProgress(cb: ((p: Progress) => void) | undefined, intervalMs: number = PROGRESS_INTERVAL_MS): ((p: Progress) => void) | undefined {
  if (!cb) return undefined;
  let last = -Infinity;
  let lastPhase: string | undefined;
  let lastSheet: string | undefined;
  let ratio = 0;
  return (p: Progress): void => {
    ratio = Math.min(1, Math.max(ratio, p.ratio));
    const now = clock();
    const changed = p.phase !== lastPhase || p.sheet !== lastSheet;
    if (!changed && ratio < 1 && now - last < intervalMs) return;
    last = now;
    lastPhase = p.phase;
    lastSheet = p.sheet;
    const out: Progress = { phase: p.phase, ratio };
    if (p.sheet !== undefined) out.sheet = p.sheet;
    cb(out);
  };
}
