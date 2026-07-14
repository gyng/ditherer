import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(60_000);

test("advanced timing, audio, history, and command workflows remain coherent", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.addInitScript(() => localStorage.setItem("ditherer-onboarding-complete", "1"));
  await page.goto("/?testMedia=image%3Apepper.png");
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Screensaver", exact: true }).click();
  const screensaver = page.getByRole("dialog", { name: "Screensaver settings" });
  await expect(screensaver).toBeVisible();
  await screensaver.getByRole("radio", { name: "Sync to detected BPM" }).first().check();
  await screensaver.getByLabel("Beats per swap").fill("8");
  await screensaver.getByRole("radio", { name: "Fixed interval" }).first().check();
  await screensaver.getByLabel("Seconds per swap").fill("3.5");
  await screensaver.getByLabel("= BPM").fill("120");

  await screensaver.getByRole("checkbox", { name: "Auto swap random video" }).check();
  await screensaver.getByRole("radio", { name: "Sync to detected BPM" }).last().check();
  await screensaver.getByLabel("Beats per video swap").fill("12");
  await screensaver.getByLabel("Video width (px)").fill("320");
  await screensaver.getByLabel("Video scaling").selectOption({ index: 1 });
  await page.keyboard.press("Escape");
  await expect(screensaver).toBeHidden();

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByTitle("Open chain audio visualizer mapping").click();
  const audio = page.getByRole("dialog", { name: "Chain audio visualizer settings" });
  await expect(audio).toBeVisible();
  await audio.getByRole("radio", { name: "Sync to detected BPM" }).check();
  await audio.getByLabel("Beats per swap").fill("6");
  const normalize = audio.getByRole("checkbox", { name: /Normalize/ });
  if (await normalize.count()) await normalize.first().click();
  await audio.getByRole("button", { name: "Clear" }).click();
  await expect(audio).toBeHidden();

  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  const grayscale = page.getByRole("checkbox", { name: /Pre-convert to grayscale/ });
  await grayscale.check();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(grayscale).not.toBeChecked();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(grayscale).toBeChecked();

  await page.getByTitle("Open command palette (Ctrl/Command K or /)").click();
  const commands = page.getByRole("dialog", { name: "Command palette" });
  await commands.getByRole("combobox", { name: "Search commands" }).fill("before");
  await commands.getByRole("combobox", { name: "Search commands" }).press("Enter");
  await expect(commands).toBeHidden();
  await expect(page.getByRole("slider", { name: "Before / after" })).toBeVisible();

  await writeBrowserCoverage(page, "app-advanced");
});
