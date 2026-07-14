import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    if (!localStorage.getItem("ditherer-workspace-layout")) {
      localStorage.setItem("ditherer-workspace-layout", "docked");
    }
  });
});

test("floating windows, comparison, fullscreen modes, and theme persistence work together", async ({ page }) => {
  await startBrowserCoverage(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?testMedia=image%3Apepper.png");

  const inputTitle = page.getByText("Input - pepper.png", { exact: true });
  const outputTitle = page.getByText("Output - pepper.png", { exact: true });
  const inputWindow = inputTitle.locator("../..");
  const outputCanvas = outputTitle.locator("..").locator("canvas").first();
  await page.getByRole("button", { name: "Float", exact: true }).click();
  await expect(page.getByRole("button", { name: "Float", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Lock", exact: true })).toHaveAttribute("aria-pressed", "false");

  const beforeDrag = await inputWindow.boundingBox();
  expect(beforeDrag).not.toBeNull();
  await inputTitle.hover();
  await page.mouse.down();
  await page.mouse.move(beforeDrag!.x + 150, beforeDrag!.y + 110, { steps: 5 });
  await page.mouse.up();
  const afterDrag = await inputWindow.boundingBox();
  expect(afterDrag).not.toBeNull();
  expect(Math.abs(afterDrag!.x - beforeDrag!.x) + Math.abs(afterDrag!.y - beforeDrag!.y)).toBeGreaterThan(40);

  await page.getByRole("button", { name: "Lock", exact: true }).click();
  const lockedPosition = await inputWindow.boundingBox();
  await inputTitle.hover();
  await page.mouse.down();
  await page.mouse.move(lockedPosition!.x + 220, lockedPosition!.y + 180, { steps: 4 });
  await page.mouse.up();
  const afterLockedDrag = await inputWindow.boundingBox();
  expect(afterLockedDrag?.x).toBeCloseTo(lockedPosition!.x, 0);
  expect(afterLockedDrag?.y).toBeCloseTo(lockedPosition!.y, 0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Float", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Dock", exact: true }).click();
  await page.getByRole("button", { name: "Output only", exact: true }).click();
  await expect(inputTitle).toBeHidden();
  await expect(outputTitle).toBeVisible();
  await page.getByRole("button", { name: "Output only", exact: true }).click();

  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const compare = page.getByRole("slider", { name: "Before / after" });
  await compare.fill("73");
  await expect(compare).toHaveValue("73");
  const hold = page.getByRole("button", { name: "Hold before" });
  await hold.dispatchEvent("pointerdown");
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await hold.dispatchEvent("pointerup");

  const fullscreen = page.getByRole("button", { name: "Fullscreen", exact: true });
  await fullscreen.click();
  await page.getByRole("button", { name: "Cover", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(outputCanvas).toHaveCSS("object-fit", "cover");
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await fullscreen.click();
  await page.getByRole("button", { name: "Contain", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(outputCanvas).toHaveCSS("object-fit", "contain");
  await page.evaluate(() => document.exitFullscreen());

  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("checkbox", { name: "Rainy Day theme" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "rainy-day");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "rainy-day");

  await page.keyboard.press("/");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  expect(pageErrors).toEqual([]);
  await writeBrowserCoverage(page, "workspace-layout");
});
