import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(90_000);

test("media, command, fullscreen, and screensaver boundaries recover cleanly", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
  const alerts: string[] = [];
  page.on("dialog", async (dialog) => {
    alerts.push(dialog.message());
    await dialog.dismiss();
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/?testMedia=image%3Apepper.png");
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();

  const randomImage = page.getByTitle("Load a random test image");
  const inputTitle = page.getByText(/^Input - /);
  const initialImageTitle = await inputTitle.textContent();
  await randomImage.click();
  await expect.poll(() => inputTitle.textContent()).not.toBe(initialImageTitle);
  const firstRandomImageTitle = await inputTitle.textContent();
  await randomImage.click();
  await expect.poll(() => inputTitle.textContent()).not.toBe(firstRandomImageTitle);
  expect(new URL(page.url()).searchParams.get("testMedia")).toMatch(/^image:/);

  const randomVideo = page.getByTitle("Load a random test video");
  const beforeRandomVideo = await inputTitle.textContent();
  await randomVideo.click();
  await expect.poll(() => inputTitle.textContent()).not.toBe(beforeRandomVideo);
  const firstRandomVideoTitle = await inputTitle.textContent();
  await randomVideo.click();
  await expect.poll(() => inputTitle.textContent()).not.toBe(firstRandomVideoTitle);
  expect(new URL(page.url()).searchParams.get("testMedia")).toMatch(/^video:/);

  await page
    .getByTitle("Scale the input video to comfortably fit the browser area right of the sidebar")
    .click();
  const inputCanvas = page
    .getByText(/^Input - /)
    .locator("..")
    .locator("canvas");
  await inputCanvas.click();
  await expect(page.getByText(/^(▶ PLAY|❚❚ PAUSE)$/)).toBeVisible();
  await page.getByTitle("Step backward by roughly one frame").click();

  const sourceFile = page.getByLabel("Choose an image or video file");
  await sourceFile.focus();
  await page.keyboard.press("/");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  await sourceFile.blur();
  await page.keyboard.press("/");
  const commandPalette = page.getByRole("dialog", { name: "Command palette" });
  await expect(commandPalette).toBeVisible();
  const commandSearch = commandPalette.getByRole("combobox", { name: "Search commands" });
  await commandSearch.press("ArrowDown");
  await commandSearch.press("ArrowUp");
  await commandSearch.fill("no command can match this");
  await expect(commandPalette).toContainText("No matching commands");
  await page.keyboard.press("Escape");
  await expect(commandPalette).toBeHidden();

  const outputWindow = page.getByText(/^Output - /).locator("..");
  for (const mode of ["Contain", "Cover"]) {
    await outputWindow.getByRole("button", { name: "Fullscreen" }).click();
    await outputWindow.getByRole("button", { name: mode, exact: true }).click();
    await expect
      .poll(() => outputWindow.evaluate((element) => element === document.fullscreenElement))
      .toBe(true);
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  }

  await page.locator("#test-image-select").selectOption({ label: "pepper.png" });
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();
  await outputWindow.getByRole("button", { name: "Screensaver" }).click();
  const screensaver = page.getByRole("dialog", { name: "Screensaver settings" });
  await expect(screensaver).toBeVisible();
  const seconds = screensaver.getByLabel("Seconds per swap");
  await seconds.fill("0");
  await screensaver.getByRole("button", { name: "Start", exact: true }).click();
  expect(alerts.at(-1)).toContain("positive screensaver swap interval");
  await expect(screensaver).toBeVisible();
  await seconds.fill("0.2");
  await screensaver.getByRole("button", { name: "Start", exact: true }).click();
  await expect
    .poll(() => outputWindow.evaluate((element) => element === document.fullscreenElement))
    .toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();

  await outputWindow.getByRole("button", { name: "Screensaver" }).click();
  await screensaver.getByRole("checkbox", { name: "Auto swap random video" }).check();
  await screensaver.getByLabel("Seconds per video swap").fill("0");
  await screensaver.getByRole("button", { name: "Start", exact: true }).click();
  expect(alerts.at(-1)).toContain("positive random video swap interval");
  await screensaver.getByLabel("Seconds per video swap").fill("1");
  await screensaver.getByLabel("Video width (px)").fill("0");
  await screensaver.getByRole("button", { name: "Start", exact: true }).click();
  expect(alerts.at(-1)).toContain("positive max video width");
  await screensaver.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Save chain", exact: true }).click();
  await page.getByRole("button", { name: "Output only", exact: true }).click();
  await page.getByRole("button", { name: "Output only", exact: true }).click();

  expect(pageErrors).toEqual([]);
  await writeBrowserCoverage(page, "app-boundaries");
});
