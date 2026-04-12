import { expect, test } from "@playwright/test";

test("browser loads the WASM path without fallback noise", async ({ page }) => {
  const consoleMessages: Array<{ type: string; text: string }> = [];
  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });

  await page.goto("/wasm-smoke.html");
  await expect(page.locator('[data-testid="status"]')).toHaveText("ok");

  const result = await page.evaluate(() => window.__wasmSmokeResult);
  expect(result?.status).toBe("ok");
  expect(result?.utilsReady).toBe(true);
  expect(result?.maxLabDiff).toBeLessThanOrEqual(0.001);

  const noisyMessages = consoleMessages.filter(({ text }) =>
    /instantiateStreaming|WASM module failed|WASM module not loaded|unsupported MIME type/i.test(text),
  );
  expect(noisyMessages).toEqual([]);
});
