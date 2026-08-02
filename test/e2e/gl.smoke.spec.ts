import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";
import type { GlSmokeResult } from "../../src/gl-smoke/types";

test.setTimeout(120_000);

test("every reachable GL shader compiles and renders in a real browser", async ({ page }) => {
  await startBrowserCoverage(page);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/gl-smoke.html");
  await expect(page.locator('[data-testid="status"]')).toHaveText(/ok|failed/, { timeout: 60_000 });

  const result = await page.evaluate(
    () => (window as unknown as { __glSmokeResult?: GlSmokeResult }).__glSmokeResult,
  );
  expect(result).toBeTruthy();
  if (result?.status !== "ok") {
    // Surface the first few failures so the CI log tells you what's broken.
    const preview = (result?.failures ?? []).slice(0, 20);
    throw new Error(
      `GL smoke failed — passed=${result?.passed} failed=${result?.failed} skipped=${result?.skipped}\n` +
        preview
          .map(
            (f: { name: string; mode: string; reason: string }) =>
              `  • ${f.name} [${f.mode}]: ${f.reason}`,
          )
          .join("\n"),
    );
  }
  expect(result.failed).toBe(0);
  expect(result.passed).toBeGreaterThan(0);
  // Surface the total coverage so regressions that narrow the enum-branch
  // sweep (e.g. a filter dropping its ENUM option) show up as a visible
  // drop in the CI log instead of silently passing.
  console.log(
    `gl-smoke: passed=${result.passed} skipped=${result.skipped} ` +
      `glFilters=${result.glFilters} requiredGL=${result.requiredGLFilters} ` +
      `compiles=${result.shaderCompiles} links=${result.programLinks} draws=${result.drawCalls} ` +
      `time=${result.timings.totalMs.toFixed(0)}ms ` +
      `(registry=${result.timings.registryMs.toFixed(0)}ms contracts=${result.timings.contractsMs.toFixed(0)}ms)`,
  );
  console.log(
    "gl-smoke suites: " +
      Object.entries(result.timings.suitesMs)
        .map(([name, elapsed]) => `${name}=${elapsed.toFixed(0)}ms`)
        .join(" "),
  );
  // Coverage floor: lowering this requires an intentional review of which GPU
  // path was removed or stopped activating. New filters are discovered without
  // changing the test.
  expect(result.glFilters).toBeGreaterThanOrEqual(250);
  expect(result.requiredGLFilters).toBeGreaterThanOrEqual(133);
  expect(result.glFilters).toBeGreaterThan(result.requiredGLFilters);
  expect(result.shaderCompiles).toBeGreaterThan(0);
  expect(result.programLinks).toBeGreaterThan(0);
  expect(result.shaderFailures).toBe(0);
  expect(result.drawCalls).toBeGreaterThan(result.glFilters);
  expect(result.timings.totalMs).toBeGreaterThan(0);
  expect(result.timings.registryMs).toBeGreaterThan(0);
  expect(result.timings.contractsMs).toBeGreaterThan(0);
  expect(Object.keys(result.timings.suitesMs).length).toBeGreaterThan(0);
  expect(consoleErrors).toEqual([]);
  await writeBrowserCoverage(page, "gl-smoke");
});
