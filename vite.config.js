import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react({ include: /\.(jsx|tsx)$/ })],
  resolve: {
    alias: [
      { find: "@gyng/ditherer-filters/worker", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/worker.ts") },
      { find: "@gyng/ditherer-filters/client", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/client.ts") },
      { find: "@gyng/ditherer-filters/wasm-bindings", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/wasm-bindings.ts") },
      { find: "@gyng/ditherer-filters", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/index.ts") },
      { find: "@src", replacement: path.resolve(__dirname, "src") },
      { find: "components", replacement: path.resolve(__dirname, "src/components") },
      { find: "constants", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/constants") },
      { find: "context", replacement: path.resolve(__dirname, "src/context") },
      { find: "filters", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/filters") },
      { find: "gl", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/gl") },
      { find: "palettes", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/palettes") },
      { find: "reducers", replacement: path.resolve(__dirname, "src/reducers") },
      { find: "styles", replacement: path.resolve(__dirname, "src/styles") },
      { find: /^utils$/, replacement: path.resolve(__dirname, "packages/ditherer-filters/src/utils/index.ts") },
      { find: "utils", replacement: path.resolve(__dirname, "src/utils") },
      { find: "workers", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/workers") },
      { find: "wasm", replacement: path.resolve(__dirname, "packages/ditherer-filters/src/wasm") },
    ],
  },
  build: {
    outDir: "build",
    // Filters are intentionally eager-loaded during the boot screen
    // (see src/index.tsx) and the worker bundles them all so it can
    // run any filter on demand. Both bundles are knowingly large.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (id.includes("/react/") || id.includes("/react-dom/")) {
            return "react-vendor";
          }

          if (id.includes("/@radix-ui/") || id.includes("/cmdk/") || id.includes("/react-colorful/")) {
            return "ui-vendor";
          }

          if (
            id.includes("/modern-gif/") ||
            id.includes("/fflate/") ||
            id.includes("/mp4box/") ||
            id.includes("/web-demuxer/") ||
            id.includes("/webm-muxer/")
          ) {
            return "export-vendor";
          }
        },
      },
    },
  },
  server: {
    watch: {
      usePolling: true,
    },
  },
  base: "./",
  test: {
    globals: false,
    environment: "jsdom",
    setupFiles: ["vitest-canvas-mock", "./test/setup.ts"],
    disableConsoleIntercept: true,
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx", "packages/ditherer-filters/src/**/*.ts"],
      exclude: [
        "src/bench.ts",
        "src/vite-env.d.ts",
        "src/global.d.ts",
        "src/types/**/*.d.ts",
        "packages/ditherer-filters/src/wasm/**",
        "src/**/__mocks__/**",
        // Browser harnesses are tests, not shipped application modules. Their
        // coverage is collected, but it must not raise the product numerator.
        "src/glSmoke.ts",
        "src/wasmSmoke.ts",
      ],
      // The unit floor catches a vanished Vitest layer. The release threshold
      // is enforced after merging this map with Chromium coverage, where GL,
      // workers, media, and component integration actually execute.
      thresholds: {
        lines: 35,
        functions: 30,
        statements: 35,
        branches: 25,
      },
    },
    deps: {
      optimizer: {
        web: {
          include: ["vitest-canvas-mock"],
        },
      },
    },
    benchmark: {
      reporters: ["default", "./test/perf/benchReporter.ts"],
    },
  },
});
