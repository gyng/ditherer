const root = await import("@gyng/ditherer-filters");
const catalog = await import("@gyng/ditherer-filters/catalog");
const lazy = await import("@gyng/ditherer-filters/lazy");
const grayscale = await import("@gyng/ditherer-filters/filters/grayscale");
const client = await import("@gyng/ditherer-filters/client");
const worker = await import("@gyng/ditherer-filters/worker");
const wasmBindings = await import("@gyng/ditherer-filters/wasm-bindings");

if (root.filterList.length < 300) throw new Error("Root catalog export is incomplete");
if (catalog.filterCatalog.length !== root.filterList.length) throw new Error("Metadata catalog is incomplete");
if (lazy.lazyFilterNames.length !== Object.keys(root.filterIndex).length) throw new Error("Lazy registry is incomplete");
if ((await lazy.loadFilter("Grayscale")).name !== "Grayscale") throw new Error("Lazy loading failed");
if (grayscale.default.name !== "Grayscale") throw new Error("Per-filter export failed");
if (typeof root.createFilterSession !== "function") throw new Error("Root runtime export is missing");
if (typeof client.workerRPC !== "function") throw new Error("Client export is missing");
if (typeof client.disposeFilterWorker !== "function") throw new Error("Worker cleanup export is missing");
if (typeof worker.runWorkerFilterRequest !== "function") throw new Error("Worker export is missing");
if (typeof wasmBindings.default !== "function") throw new Error("WASM binding export is missing");
