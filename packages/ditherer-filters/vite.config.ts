import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Worker URLs emitted by the client entry must resolve from the installed
  // package, not from an application's server root.
  base: "./",
  build: {
    target: "es2020",
    outDir: path.join(packageRoot, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: {
        index: path.join(packageRoot, "src/index.ts"),
        client: path.join(packageRoot, "src/client.ts"),
        worker: path.join(packageRoot, "src/worker.ts"),
        "wasm-bindings": path.join(packageRoot, "src/wasm-bindings.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
