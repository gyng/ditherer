import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react({ include: /\.(jsx|tsx)$/ })],
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
      workers: path.resolve(__dirname, "src/workers"),
      wasm: path.resolve(__dirname, "src/wasm"),
    },
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
    setupFiles: ["vitest-canvas-mock"],
    disableConsoleIntercept: true,
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/index.tsx",
        "src/bench.ts",
        "src/vite-env.d.ts",
        "src/global.d.ts",
        "src/types/**/*.d.ts",
        "src/wasm/**",
        "src/**/__mocks__/**",
      ],
      thresholds: {
        lines: 65,
        functions: 40,
        statements: 65,
        branches: 40,
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
