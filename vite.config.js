import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import path from "path";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ["@babel/plugin-transform-flow-strip-types"],
      },
    }),
    wasm(),
    topLevelAwait(),
  ],
  resolve: {
    alias: {
      "@src": path.resolve(__dirname, "src"),
      actions: path.resolve(__dirname, "src/actions"),
      components: path.resolve(__dirname, "src/components"),
      constants: path.resolve(__dirname, "src/constants"),
      containers: path.resolve(__dirname, "src/containers"),
      filters: path.resolve(__dirname, "src/filters"),
      palettes: path.resolve(__dirname, "src/palettes"),
      reducers: path.resolve(__dirname, "src/reducers"),
      styles: path.resolve(__dirname, "src/styles"),
      types: path.resolve(__dirname, "src/types"),
      utils: path.resolve(__dirname, "src/utils"),
      wasm: path.resolve(__dirname, "src/wasm"),
    },
  },
  build: {
    outDir: "build",
  },
  base: "./",
});
