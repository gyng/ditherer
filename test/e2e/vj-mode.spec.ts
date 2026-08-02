import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

test("VJ screensaver cycles live content and restores the prior workspace", async ({ page }) => {
  await startBrowserCoverage(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?testMedia=image%3Apepper.png");
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();

  const inputScale = page.getByRole("slider", { name: "Input Scale", includeHidden: true });
  await inputScale.fill("0.75");
  const scaling = page.locator('select[aria-label="Output display scaling"]');
  await scaling.selectOption({ label: "Pixelated" });

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  const chain = page.getByRole("listbox", { name: "Filter chain" });
  const initialChain = await chain.getByRole("option").allTextContents();

  await page.getByRole("button", { name: "Screensaver", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Screensaver settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Seconds per swap").fill("0.25");
  await dialog.getByRole("checkbox", { name: "Auto swap random video" }).check();
  await dialog.getByLabel("Seconds per video swap").fill("0.35");
  await dialog.getByLabel("Video width (px)").fill("160");
  await dialog.getByLabel("Video scaling").selectOption({ label: "Auto" });
  await dialog.getByRole("checkbox", { name: "Show debug overlay on output" }).check();
  await dialog.getByRole("button", { name: "Start", exact: true }).click();

  await expect(dialog).toBeHidden();
  const outputWindow = page.getByText(/^Output - /).locator("..");
  await expect
    .poll(() => outputWindow.evaluate((element) => element === document.fullscreenElement))
    .toBe(true);
  await expect(page.getByText("Screensaver debug", { exact: true })).toBeVisible();
  expect(await scaling.inputValue()).toBe("AUTO");

  await expect
    .poll(async () => chain.getByRole("option").allTextContents(), { timeout: 10_000 })
    .not.toEqual(initialChain);
  await expect(page.getByText(/^Input - (?!pepper\.png$).+/)).toBeVisible({ timeout: 15_000 });

  const inputCanvas = page
    .getByText(/^Input - /)
    .locator("..")
    .locator("canvas");
  await expect
    .poll(() => inputCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).width))
    .toBeLessThanOrEqual(160);

  // Headless Chrome does not route Escape through its fullscreen browser UI,
  // so drive the same fullscreenchange lifecycle directly.
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(page.getByText("Screensaver debug", { exact: true })).toBeHidden();
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(inputScale).toHaveValue("0.75");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(scaling).toHaveValue("PIXELATED");
  expect(pageErrors).toEqual([]);
  await writeBrowserCoverage(page, "vj-mode");
});
