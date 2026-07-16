import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: "/tmp/ditherer-selective-consumer-build",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: path.join(root, "src/selective.ts"),
    },
  },
});
