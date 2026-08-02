import { describe, expect, it } from "vitest";
import {
  hasExecutedNestedFunction,
  isBrowserCoverageSourcePath,
  shouldCollectBrowserCoverageEntry,
} from "./e2e/browserCoverage";

describe("browser coverage source selection", () => {
  it("collects application sources for every browser workflow", () => {
    expect(isBrowserCoverageSourcePath("src/components/App/index.tsx", "app-workflow")).toBe(true);
    expect(isBrowserCoverageSourcePath("src/components/App/index.tsx", "gl-smoke")).toBe(true);
  });

  it("collects the eager filter package once in the exhaustive GL registry run", () => {
    expect(
      isBrowserCoverageSourcePath("packages/ditherer-filters/src/filters/grayscale.ts", "gl-smoke"),
    ).toBe(true);
    expect(
      isBrowserCoverageSourcePath(
        "packages/ditherer-filters/src/workers/filterWorker.ts",
        "gl-smoke",
      ),
    ).toBe(true);
    expect(
      isBrowserCoverageSourcePath(
        "packages/ditherer-filters/src/filters/grayscale.ts",
        "app-workflow",
      ),
    ).toBe(false);
  });

  it("collects package modules that execute beyond eager module initialization", () => {
    const topLevelOnly = [{ ranges: [{ count: 1 }] }, { ranges: [{ count: 0 }] }];
    const activeFilter = [{ ranges: [{ count: 1 }] }, { ranges: [{ count: 2 }] }];

    expect(hasExecutedNestedFunction(topLevelOnly)).toBe(false);
    expect(hasExecutedNestedFunction(activeFilter)).toBe(true);
    expect(
      shouldCollectBrowserCoverageEntry(
        "packages/ditherer-filters/src/filters/grayscale.ts",
        "app-workflow",
        activeFilter,
      ),
    ).toBe(true);
    expect(
      shouldCollectBrowserCoverageEntry(
        "packages/ditherer-filters/src/filters/grayscale.ts",
        "app-workflow",
        topLevelOnly,
      ),
    ).toBe(false);
  });

  it("collects shared package runtime modules in ordinary app workflows", () => {
    expect(
      isBrowserCoverageSourcePath("packages/ditherer-filters/src/runtime.ts", "app-workflow"),
    ).toBe(true);
    expect(
      isBrowserCoverageSourcePath(
        "packages/ditherer-filters/src/workers/workerRPC.ts",
        "app-workflow",
      ),
    ).toBe(true);
    expect(
      isBrowserCoverageSourcePath("packages/ditherer-filters/src/utils/index.ts", "app-workflow"),
    ).toBe(true);
  });

  it("does not collect tests, package build output, or unrelated packages", () => {
    expect(isBrowserCoverageSourcePath("test/e2e/gl.smoke.spec.ts", "gl-smoke")).toBe(false);
    expect(isBrowserCoverageSourcePath("packages/ditherer-filters/dist/index.js", "gl-smoke")).toBe(
      false,
    );
    expect(isBrowserCoverageSourcePath("packages/unrelated/src/index.ts", "gl-smoke")).toBe(false);
  });
});
