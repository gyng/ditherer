import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { convert } from "ast-v8-to-istanbul";
import istanbulCoverage from "istanbul-lib-coverage";
import type { Page } from "@playwright/test";
import { parseAstAsync } from "vite";

const outputDirectory = path.resolve(process.cwd(), ".browser-coverage");
const sharedFilterPackageSources = new Set([
  "packages/ditherer-filters/src/client.ts",
  "packages/ditherer-filters/src/filters/index.ts",
  "packages/ditherer-filters/src/palettes/index.ts",
  "packages/ditherer-filters/src/runtime.ts",
  "packages/ditherer-filters/src/utils/index.ts",
  "packages/ditherer-filters/src/workers/workerRPC.ts",
]);

export const browserCoverageEnabled = (): boolean => process.env.COLLECT_BROWSER_COVERAGE === "1";

export const isBrowserCoverageSourcePath = (relativePath: string, coverageName: string): boolean =>
  relativePath.startsWith("src/") ||
  sharedFilterPackageSources.has(relativePath) ||
  (coverageName === "gl-smoke" && relativePath.startsWith("packages/ditherer-filters/src/"));

type CoverageFunction = {
  ranges: ReadonlyArray<{ count: number }>;
};

export const hasExecutedNestedFunction = (functions: ReadonlyArray<CoverageFunction>): boolean =>
  functions.slice(1).some((fn) => fn.ranges.some((range) => range.count > 0));

export const shouldCollectBrowserCoverageEntry = (
  relativePath: string,
  coverageName: string,
  functions: ReadonlyArray<CoverageFunction>,
): boolean =>
  isBrowserCoverageSourcePath(relativePath, coverageName) ||
  (relativePath.startsWith("packages/ditherer-filters/src/") &&
    hasExecutedNestedFunction(functions));

export const startBrowserCoverage = async (page: Page): Promise<void> => {
  if (!browserCoverageEnabled()) return;
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
};

export const writeBrowserCoverage = async (page: Page, name: string): Promise<void> => {
  if (!browserCoverageEnabled()) return;

  const entries = await page.coverage.stopJSCoverage();
  const map = istanbulCoverage.createCoverageMap({});

  for (const entry of entries) {
    if (!entry.source || !entry.url) continue;
    const url = new URL(entry.url);
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!shouldCollectBrowserCoverageEntry(relativePath, name, entry.functions)) continue;

    const sourcePath = path.resolve(process.cwd(), relativePath);
    map.merge(
      await convert({
        ast: parseAstAsync(entry.source),
        code: entry.source,
        coverage: {
          url: pathToFileURL(sourcePath).href,
          functions: entry.functions,
        },
      }),
    );
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, `${name}.json`), JSON.stringify(map.toJSON()), "utf8");
};
