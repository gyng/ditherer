import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import path from "path";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: {
      "@src": path.resolve(__dirname, "src"),
      components: path.resolve(__dirname, "src/components"),
      constants: path.resolve(__dirname, "src/constants"),
      context: path.resolve(__dirname, "src/context"),
      filters: path.resolve(__dirname, "src/filters"),
      palettes: path.resolve(__dirname, "src/palettes"),
      reducers: path.resolve(__dirname, "src/reducers"),
      styles: path.resolve(__dirname, "src/styles"),
      utils: path.resolve(__dirname, "src/utils"),
      wasm: path.resolve(__dirname, "src/wasm"),
    },
  },
  build: {
    outDir: "build",
  },
  base: "./",
  test: {
    globals: false,
    environment: "jsdom",
    setupFiles: ["vitest-canvas-mock"],
    deps: {
      optimizer: {
        web: {
          include: ["vitest-canvas-mock"],
        },
      },
    },
  },
});
