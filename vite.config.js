import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const repositoryRoot = import.meta.dirname;
const filterPackageSource = path.resolve(repositoryRoot, "packages/ditherer-filters/src");
// Match both the workspace source graph and the installed package graph used
// by the packed-consumer release gate. Keeping the latter here ensures a real
// consumer receives the same bounded filter chunks instead of collapsing the
// already-built package back into one oversized application entry.
const filterPackagePattern =
  "(?:packages[\\\\/]ditherer-filters[\\\\/]src|node_modules[\\\\/]@gyng[\\\\/]ditherer-filters[\\\\/]dist)";
const filterCorePattern = new RegExp(
  `${filterPackagePattern}[\\\\/](?:constants|gl|palettes|utils|wasm)[\\\\/]`,
);
const filterImplementationPattern = new RegExp(
  `${filterPackagePattern}[\\\\/]filters[\\\\/]([^\\\\/]+)\\.(?:ts|js)$`,
);
const filterImplementationChunkName = (moduleId) => {
  const match = moduleId.match(filterImplementationPattern);
  if (!match || match[1] === "index" || match[1] === "types") return null;

  const initial = match[1][0].toLowerCase();
  if (initial <= "f") return "filters-a-f";
  if (initial <= "m") return "filters-g-m";
  if (initial <= "s") return "filters-n-s";
  return "filters-t-z";
};
const filterChunkGroups = () => [
  {
    name: "filter-core",
    test: (moduleId) =>
      filterCorePattern.test(moduleId) ||
      new RegExp(`${filterPackagePattern}[\\\\/]filters[\\\\/]types\\.(?:ts|js)$`).test(moduleId),
    priority: 20,
  },
  {
    name: filterImplementationChunkName,
    test: (moduleId) => filterImplementationChunkName(moduleId) !== null,
    priority: 10,
  },
];
const applicationChunkGroups = () => [
  {
    name: "react-vendor",
    test: /node_modules[\\/](?:react|react-dom)[\\/]/,
    priority: 30,
  },
  {
    name: "ui-vendor",
    test: /node_modules[\\/](?:@radix-ui|cmdk|react-colorful)[\\/]/,
    priority: 20,
  },
  {
    name: "export-vendor",
    test: /node_modules[\\/](?:modern-gif|fflate|mp4box|web-demuxer|webm-muxer)[\\/]/,
    priority: 20,
  },
  ...filterChunkGroups(),
];
const legacyEngineTestAliases = [
  { find: "constants", replacement: path.join(filterPackageSource, "constants") },
  { find: "filters", replacement: path.join(filterPackageSource, "filters") },
  { find: "gl", replacement: path.join(filterPackageSource, "gl") },
  { find: "palettes", replacement: path.join(filterPackageSource, "palettes") },
  { find: /^utils$/, replacement: path.join(filterPackageSource, "utils/index.ts") },
  { find: "workers", replacement: path.join(filterPackageSource, "workers") },
  { find: "wasm", replacement: path.join(filterPackageSource, "wasm") },
];

export default defineConfig({
  plugins: [react({ include: /\.(jsx|tsx)$/ })],
  worker: {
    format: "es",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: filterChunkGroups(),
        },
      },
    },
  },
  resolve: {
    alias: [
      {
        find: "@gyng/ditherer-filters/worker",
        replacement: path.resolve(repositoryRoot, "packages/ditherer-filters/src/worker.ts"),
      },
      {
        find: "@gyng/ditherer-filters/client",
        replacement: path.resolve(repositoryRoot, "packages/ditherer-filters/src/client.ts"),
      },
      {
        find: "@gyng/ditherer-filters/wasm-bindings",
        replacement: path.resolve(repositoryRoot, "packages/ditherer-filters/src/wasm-bindings.ts"),
      },
      {
        find: "@gyng/ditherer-filters/catalog",
        replacement: path.resolve(repositoryRoot, "packages/ditherer-filters/src/catalog.ts"),
      },
      {
        find: "@gyng/ditherer-filters/lazy",
        replacement: path.resolve(repositoryRoot, "packages/ditherer-filters/src/lazy.ts"),
      },
      {
        find: /^@gyng\/ditherer-filters\/filters\/(.+)$/,
        replacement: path.resolve(repositoryRoot, "packages/ditherer-filters/src/filters/$1.ts"),
      },
      {
        find: /^@gyng\/ditherer-filters$/,
        replacement: path.resolve(repositoryRoot, "packages/ditherer-filters/src/index.ts"),
      },
      { find: "@src", replacement: path.resolve(repositoryRoot, "src") },
      { find: "components", replacement: path.resolve(repositoryRoot, "src/components") },
      { find: "context", replacement: path.resolve(repositoryRoot, "src/context") },
      { find: "reducers", replacement: path.resolve(repositoryRoot, "src/reducers") },
      { find: "styles", replacement: path.resolve(repositoryRoot, "src/styles") },
      { find: "utils", replacement: path.resolve(repositoryRoot, "src/utils") },
    ],
  },
  build: {
    outDir: "build",
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: applicationChunkGroups(),
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
    alias: legacyEngineTestAliases,
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
        "src/gl-smoke/**",
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
