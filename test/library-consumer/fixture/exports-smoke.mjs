const root = await import("@gyng/ditherer-filters");
const client = await import("@gyng/ditherer-filters/client");
const worker = await import("@gyng/ditherer-filters/worker");
const wasmBindings = await import("@gyng/ditherer-filters/wasm-bindings");

if (root.filterList.length < 300) throw new Error("Root catalog export is incomplete");
if (typeof root.createFilterSession !== "function") throw new Error("Root runtime export is missing");
if (typeof client.workerRPC !== "function") throw new Error("Client export is missing");
if (typeof worker.runWorkerFilterRequest !== "function") throw new Error("Worker export is missing");
if (typeof wasmBindings.default !== "function") throw new Error("WASM binding export is missing");
