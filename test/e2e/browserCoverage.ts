import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { convert } from "ast-v8-to-istanbul";
import istanbulCoverage from "istanbul-lib-coverage";
import type { Page } from "@playwright/test";
import { parseAstAsync } from "vite";

const outputDirectory = path.resolve(process.cwd(), ".browser-coverage");

export const browserCoverageEnabled = (): boolean =>
  process.env.COLLECT_BROWSER_COVERAGE === "1";

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
    if (!relativePath.startsWith("src/")) continue;

    const sourcePath = path.resolve(process.cwd(), relativePath);
    map.merge(await convert({
      ast: parseAstAsync(entry.source),
      code: entry.source,
      coverage: {
        url: pathToFileURL(sourcePath).href,
        functions: entry.functions,
      },
    }));
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, `${name}.json`),
    JSON.stringify(map.toJSON()),
    "utf8",
  );
};
