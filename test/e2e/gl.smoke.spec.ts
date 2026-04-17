import { expect, test } from "@playwright/test";

type GlSmokeResult = {
  status: "ok" | "failed";
  passed: number;
  failed: number;
  skipped: number;
  failures: { name: string; mode: string; reason: string }[];
};

test("every GL-only filter produces opaque output on a real browser", async ({ page }) => {
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
    const preview = (result?.failures ?? []).slice(0, 5);
    throw new Error(
      `GL smoke failed — passed=${result?.passed} failed=${result?.failed} skipped=${result?.skipped}\n`
      + preview.map((f: { name: string; mode: string; reason: string }) =>
        `  • ${f.name} [${f.mode}]: ${f.reason}`,
      ).join("\n"),
    );
  }
  expect(result.failed).toBe(0);
  expect(result.passed).toBeGreaterThan(0);
  // Surface the total coverage so regressions that narrow the enum-branch
  // sweep (e.g. a filter dropping its ENUM option) show up as a visible
  // drop in the CI log instead of silently passing.
  console.log(`gl-smoke: passed=${result.passed} skipped=${result.skipped}`);
  expect(consoleErrors).toEqual([]);
});
