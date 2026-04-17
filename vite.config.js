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
      gl: path.resolve(__dirname, "src/gl"),
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
        // GL renderers only run with a real WebGL2 context. They're covered
        // by the Playwright gl-smoke suite, which can't feed its v8 traces
        // back into this report, so including them would permanently peg the
        // floor ~20 points below reality.
        "src/**/*GL.ts",
        "src/gl/**",
        "src/glSmoke.ts",
        "src/wasmSmoke.ts",
        // Integration-only surfaces — no discrete unit-testable functions,
        // exercised end-to-end by Playwright against the running app.
        //   • App/index.tsx is a 3500-line component shell
        //   • webmcp.ts wires the app into the Model Context Protocol runtime
        "src/components/App/index.tsx",
        "src/webmcp.ts",
        // Pure-view React components — every line is JSX + event-callback
        // wiring. Meaningful tests need React Testing Library + user-event
        // and still only cover "does it render". Left to Playwright.
        "src/components/App/Exporter.tsx",
        "src/components/ChainList/BackendTags.tsx",
        "src/components/ChainList/Thumbnail.tsx",
        "src/components/SaveAs/ui/**/*.tsx",
        "src/components/controls/**/*.tsx",
      ],
      // Thresholds track the floor of currently-tested code. Big remaining
      // gaps:
      //   • SaveAs export pipelines — WebCodecs/MediaRecorder, hostile to JSDOM
      //   • Every filter wrapper with a GL renderer — the dispatch frame runs
      //     in jsdom but the shader body only runs under gl-smoke.spec.ts,
      //     whose v8 trace isn't merged into this report. Each such file
      //     therefore caps around 20-25%. Raising this floor meaningfully
      //     will require routing Playwright coverage through istanbul-merge.
      // Bump these back up when either a Playwright coverage merge lands
      // or when a given area gets unit-testable coverage.
      thresholds: {
        lines: 55,
        functions: 44,
        statements: 55,
        branches: 36,
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
