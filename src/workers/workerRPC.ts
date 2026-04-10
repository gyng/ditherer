let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: any) => void }>();

const getWorker = () => {
  if (!worker) {
    worker = new Worker(new URL("./filterWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { id, result, error } = e.data;
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        if (error) {
          p.reject(new Error(error));
        } else {
          p.resolve(result);
        }
      }
    };
    worker.onerror = (e) => {
      console.error("Filter worker error:", e);
      for (const [, p] of pending) {
        p.reject(new Error("Worker crashed"));
      }
      pending.clear();
      worker = null;
    };
  }
  return worker;
};

export const workerRPC = (payload: any, transfer: Transferable[] = []): Promise<any> => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, ...payload }, transfer);
  });
};

export const USE_WORKER = typeof OffscreenCanvas !== "undefined";

// Pre-warm the worker so the first filter call doesn't pay startup cost
if (USE_WORKER) {
  try { getWorker(); } catch { /* ignore */ }
}
