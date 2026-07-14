import { expect, test, type Locator } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

const expectVisibleControlsLabelled = async (scope: Locator) => {
  const unlabeled = await scope.locator("input:not([type=hidden]), select, textarea").evaluateAll((elements) =>
    elements
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .filter((element) => {
        const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        return control.labels?.length === 0
          && !control.getAttribute("aria-label")
          && !control.getAttribute("aria-labelledby");
      })
      .map((element) => `${element.tagName.toLowerCase()}#${element.id || "(no-id)"}`),
  );
  expect(unlabeled).toEqual([]);
};

const connectionPathCount = (dialog: Locator) => dialog.locator("svg path").count();

test("chain, filter, and screensaver audio inputs expose usable Auto Viz mappings", async ({ page }) => {
  await startBrowserCoverage(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/?testMedia=image%3Apepper.png");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("combobox", { name: "Load a preset" }).selectOption({ label: "Amber Terminal" });

  await page.getByTitle("Open chain audio visualizer mapping").click();
  const chainAudio = page.getByRole("dialog", { name: "Chain audio visualizer settings" });
  await expect(chainAudio).toBeVisible();
  await expect(chainAudio.getByRole("checkbox", { name: "Enable audio visualizer input" })).not.toBeChecked();
  await expect(chainAudio.getByRole("combobox", { name: "Source" })).toHaveValue("microphone");
  await chainAudio.getByRole("combobox", { name: "Auto Viz mode" }).selectOption("punchy");
  await chainAudio.getByRole("slider", { name: /Density/ }).fill("0.4");
  await chainAudio.getByRole("checkbox", { name: "Refresh on chain change" }).check();
  await chainAudio.getByRole("button", { name: "Reroll" }).click();
  await expect.poll(() => connectionPathCount(chainAudio)).toBeGreaterThan(0);

  const override = chainAudio.getByRole("checkbox", { name: "Override" });
  await override.check();
  await chainAudio.getByRole("slider", { name: "BPM override" }).fill("132");
  await expect(chainAudio.getByText("132 BPM", { exact: true })).toBeVisible();
  await chainAudio.getByRole("button", { name: "Tap", exact: true }).click();
  await expectVisibleControlsLabelled(chainAudio);
  await chainAudio.getByRole("button", { name: "Close", exact: true }).click();
  await expect(chainAudio).toBeHidden();

  await page.getByTitle("Open chain audio visualizer mapping").click();
  await expect.poll(() => connectionPathCount(chainAudio)).toBeGreaterThan(0);
  await chainAudio.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(chainAudio).toBeHidden();

  const firstEntry = page.getByRole("listbox", { name: "Filter chain" }).getByRole("option").first();
  await firstEntry.getByRole("button", { name: /More actions for/ }).click();
  await firstEntry.getByRole("button", { name: /Map audio visualizer to/ }).click();
  const filterAudio = page.getByRole("dialog", { name: /Audio visualizer settings for/ });
  await expect(filterAudio).toContainText("Audio input is shared with the chain channel");
  await filterAudio.getByRole("combobox", { name: "Auto Viz mode" }).selectOption("flow");
  await filterAudio.getByRole("button", { name: "Reroll" }).click();
  await expect.poll(() => connectionPathCount(filterAudio)).toBeGreaterThan(0);
  await expectVisibleControlsLabelled(filterAudio);
  await filterAudio.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Screensaver", exact: true }).click();
  const screensaver = page.getByRole("dialog", { name: "Screensaver settings" });
  await screensaver.getByRole("combobox", { name: "Auto Viz mode" }).selectOption("chaotic");
  await screensaver.getByRole("slider", { name: /Density/ }).fill("0.25");
  await screensaver.getByRole("checkbox", { name: "Refresh on chain change" }).check();
  await screensaver.getByRole("button", { name: "Reroll" }).click();
  await expect.poll(() => connectionPathCount(screensaver)).toBeGreaterThan(0);
  await expectVisibleControlsLabelled(screensaver);
  await screensaver.getByRole("button", { name: "Cancel", exact: true }).click();

  expect(pageErrors).toEqual([]);
  await writeBrowserCoverage(page, "audio-inputs");
});
