import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import baseConfig from "../../vite.config.js";
import { PACKED_APP_CHUNK_BUDGET_BYTES } from "../../scripts/packed-app-artifacts.mjs";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const installedPackageRoot = path.join(
  repositoryRoot,
  "examples/filter-library/node_modules/@gyng/ditherer-filters",
);
const packageManifestPath = path.join(installedPackageRoot, "package.json");

if (!existsSync(packageManifestPath)) {
  throw new Error(
    "Packed filter package is not installed; run test/library-consumer/prepare-packed-library.mjs first",
  );
}

const packageManifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
if (packageManifest.name !== "@gyng/ditherer-filters") {
  throw new Error(`Unexpected packed dependency: ${packageManifest.name ?? "unknown"}`);
}

const packageEntry = (relativePath) => {
  const entry = path.join(installedPackageRoot, relativePath);
  if (!existsSync(entry)) throw new Error(`Packed dependency is missing ${relativePath}`);
  return entry;
};

const packedPackageAliases = [
  { find: "@gyng/ditherer-filters/worker", replacement: packageEntry("dist/worker.js") },
  { find: "@gyng/ditherer-filters/client", replacement: packageEntry("dist/client.js") },
  {
    find: "@gyng/ditherer-filters/wasm-bindings",
    replacement: packageEntry("dist/wasm-bindings.js"),
  },
  { find: "@gyng/ditherer-filters/catalog", replacement: packageEntry("dist/catalog.js") },
  { find: "@gyng/ditherer-filters/lazy", replacement: packageEntry("dist/lazy.js") },
  {
    find: /^@gyng\/ditherer-filters\/filters\/(.+)$/,
    replacement: path.join(installedPackageRoot, "dist/filters/$1.js"),
  },
  { find: /^@gyng\/ditherer-filters$/, replacement: packageEntry("dist/index.js") },
];
const applicationAliases = (baseConfig.resolve?.alias ?? []).filter(
  ({ find }) => typeof find !== "string" || !find.startsWith("@gyng/ditherer-filters"),
);

export default defineConfig({
  ...baseConfig,
  resolve: {
    ...baseConfig.resolve,
    alias: [...packedPackageAliases, ...applicationAliases],
  },
  build: {
    ...baseConfig.build,
    outDir: "/tmp/ditherer-packed-app-build",
    emptyOutDir: true,
    manifest: true,
    // This synthetic consumer bundles the already-built package graph, whose
    // filter registry can no longer be split along source-module boundaries.
    // A matching post-build assertion keeps this exception hard-bounded.
    chunkSizeWarningLimit: PACKED_APP_CHUNK_BUDGET_BYTES / 1000,
  },
});
