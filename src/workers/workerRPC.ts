import type { WorkerFilterRequest, WorkerFilterResult, WorkerResponseMessage } from "./types";

// Per-request timeout. If the worker doesn't post back within this window we
// assume a filter has hung (infinite loop, pathological algorithm, readback
// deadlock) and terminate the worker. A fresh one spins up on the next call.
// The UI keeps the previous frame instead of locking up the tab.
const WORKER_TIMEOUT_MS = 5000;

type Pending = {
  resolve: (value: WorkerFilterResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

const rejectAll = (reason: Error): void => {
  for (const [, p] of pending) {
    if (p.timer != null) clearTimeout(p.timer);
    p.reject(reason);
  }
  pending.clear();
};

const resetWorker = (reason: Error): void => {
  if (worker) {
    try { worker.terminate(); } catch { /* ignore */ }
    worker = null;
  }
  rejectAll(reason);
};

const getWorker = (): Worker => {
  if (!worker) {
    worker = new Worker(new URL("./filterWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponseMessage>) => {
      const { id } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (p.timer != null) clearTimeout(p.timer);
      if ("error" in e.data) {
        p.reject(new Error(e.data.error));
      } else {
        p.resolve(e.data.result);
      }
    };
    worker.onerror = (e) => {
      console.error("Filter worker error:", e);
      resetWorker(new Error("Worker crashed"));
    };
  }
  return worker;
};

export const workerRPC = (
  payload: WorkerFilterRequest,
  transfer: Transferable[] = [],
): Promise<WorkerFilterResult> => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const entry: Pending = { resolve, reject, timer: null };
    pending.set(id, entry);
    // Start the timer before postMessage so a fast-track OOM in the worker
    // that never reaches `onerror` still gets caught.
    entry.timer = setTimeout(() => {
      if (!pending.has(id)) return;
      console.warn(`[worker] rpc id=${id} timed out after ${WORKER_TIMEOUT_MS}ms — terminating`);
      resetWorker(new Error(`Worker timeout after ${WORKER_TIMEOUT_MS}ms`));
    }, WORKER_TIMEOUT_MS);
    try {
      getWorker().postMessage({ id, ...payload }, transfer);
    } catch (err) {
      if (entry.timer != null) clearTimeout(entry.timer);
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
};

export const USE_WORKER = typeof OffscreenCanvas !== "undefined";

// Pre-warm the worker so the first filter call doesn't pay startup cost
if (USE_WORKER) {
  try { getWorker(); } catch { /* ignore */ }
}
