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
      context: path.resolve(__dirname, "src/context"),
      filters: path.resolve(__dirname, "src/filters"),
      palettes: path.resolve(__dirname, "src/palettes"),
      reducers: path.resolve(__dirname, "src/reducers"),
      styles: path.resolve(__dirname, "src/styles"),
      types: path.resolve(__dirname, "src/types"),
      utils: path.resolve(__dirname, "src/utils"),
      wasm: path.resolve(__dirname, "src/wasm"),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      // Flow annotations in .js files — use Babel to strip them during dep scanning
      loader: {
        ".js": "jsx",
      },
      plugins: [
        {
          name: "flow-strip",
          setup(build) {
            const fs = require("fs");
            const { transformSync } = require("@babel/core");
            build.onLoad({ filter: /src\/.*\.jsx?$/ }, (args) => {
              const source = fs.readFileSync(args.path, "utf8");
              if (!source.includes("@flow") && !source.includes("import type")) {
                return { contents: source, loader: args.path.endsWith(".jsx") ? "jsx" : "js" };
              }
              const result = transformSync(source, {
                filename: args.path,
                plugins: ["@babel/plugin-transform-flow-strip-types"],
                parserOpts: { plugins: ["flow", "jsx"] },
              });
              return { contents: result.code, loader: "jsx" };
            });
          },
        },
      ],
    },
  },
  build: {
    outDir: "build",
  },
  base: "./",
  test: {
    globals: false,
    environment: "node",
  },
});
