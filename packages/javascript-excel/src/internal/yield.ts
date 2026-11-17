/**
 * Cooperative yielding for long async jobs on the main thread.
 *
 * Awaiting promises only runs microtasks, so a chain of async generators never
 * lets the browser render or handle input. `createYielder` returns a check that
 * the job calls between chunks of work: once the budget has passed since the
 * last yield it waits for a macrotask, so the browser can paint a frame and
 * deliver events. It uses `setImmediate` where it exists (Node, Bun), else a
 * `MessageChannel` message, else `setTimeout(0)`.
 *
 * Measured in Chromium 150 (bench/browser/write-yield.bench.test.ts, 100k and
 * 300k rows): a MessageChannel yield every 16 ms kept the longest frame gap at
 * 18–33 ms with no measurable change in total time. `setTimeout(0)` cost 10–20%
 * more (its 4 ms clamp), and `scheduler.yield()` is not used because its
 * continuations run ahead of rendering: tasks stayed short but frames were
 * still 133 ms apart.
 */

/** Time a write may run before it yields to the event loop: about one frame. */
export const YIELD_BUDGET_MS = 16;

type G = {
  setImmediate?: (fn: () => void) => unknown;
  MessageChannel?: new () => { port1: { onmessage: ((e: unknown) => void) | null; close(): void }; port2: { postMessage(m: unknown): void; close(): void } };
  setTimeout?: (fn: () => void, ms: number) => unknown;
  performance?: { now(): number };
};

function macrotask(): () => Promise<void> {
  const g = globalThis as unknown as G;
  const si = g.setImmediate;
  if (typeof si === "function") return () => new Promise((r) => void si(r));
  const MC = g.MessageChannel;
  if (typeof MC === "function") {
    return () =>
      new Promise((r) => {
        const ch = new MC();
        ch.port1.onmessage = () => {
          ch.port1.close();
          r();
        };
        ch.port2.postMessage(null);
      });
  }
  const st = g.setTimeout;
  if (typeof st === "function") return () => new Promise((r) => void st(r, 0));
  return () => Promise.resolve();
}

/** A check to await between chunks of work: yields a macrotask once `budgetMs` has passed. */
export function createYielder(budgetMs: number = YIELD_BUDGET_MS): () => Promise<void> | undefined {
  const perf = (globalThis as unknown as G).performance;
  const now = perf && typeof perf.now === "function" ? () => perf.now() : () => Date.now();
  const wait = macrotask();
  let last = now();
  return () => {
    if (now() - last < budgetMs) return undefined;
    return wait().then(() => {
      last = now();
    });
  };
}
