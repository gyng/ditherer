import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await startBrowserCoverage(page);
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

test("library filters, capabilities, favorites, live options, and presets stay connected", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?testMedia=image%3Apepper.png");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "Open filter and preset library" }).click();

  const dialog = page.getByTestId("filter-library-dialog");
  const filterList = page.getByTestId("filter-library-list");
  await expect(dialog.getByRole("textbox", { name: "Search filters" })).toBeFocused();

  await dialog.getByRole("button", { name: "Temporal", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Temporal", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(filterList).toContainText("TEMP");
  await dialog.getByRole("button", { name: "All", exact: true }).first().dispatchEvent("click");

  const search = dialog.getByRole("textbox", { name: "Search filters" });
  await search.fill("Invert");
  await dialog.getByRole("button", { name: "Add Invert to favorites" }).click();
  await dialog.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(filterList.getByRole("button", { name: /Invert/ }).first()).toBeVisible();

  await filterList.getByRole("button", { name: /Invert/ }).first().click();
  const details = page.getByTestId("filter-library-details");
  await expect(details).toContainText("Invert");
  const previewHasPixels = await details.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    return Boolean(data?.some((value, index) => index % 4 !== 3 && value !== 0));
  });
  expect(previewHasPixels).toBe(true);
  await details.getByRole("checkbox", { name: "invertR" }).uncheck();
  await details.getByRole("button", { name: "Add to Chain" }).click();
  await expect(page.getByRole("listbox", { name: "Filter chain" }).getByRole("option")).toHaveCount(2);
  await details.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await expect(page.getByLabel("Active filter parameters").getByRole("checkbox", { name: "invert R" })).not.toBeChecked();

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "Open filter and preset library" }).click();
  await dialog.getByRole("button", { name: /Presets \(/ }).click();
  const presetSearch = dialog.getByRole("textbox", { name: "Search presets" });
  await presetSearch.fill("Gameboy Screen");
  const presetList = page.getByTestId("preset-library-list");
  await presetList.getByRole("button", { name: /Gameboy Screen/ }).click();
  const presetDetails = page.getByTestId("preset-library-details");
  await expect(presetDetails).toContainText("Preset Options");
  await presetDetails.getByRole("button", { name: "Ordered (Gameboy)" }).click();
  await expect(details).toContainText("Ordered (Gameboy)");

  await dialog.getByRole("button", { name: /Presets \(/ }).click();
  await dialog.getByRole("textbox", { name: "Search presets" }).fill("Gameboy Screen");
  await presetList.getByRole("button", { name: /Gameboy Screen/ }).click();
  await presetDetails.getByRole("button", { name: "Load Preset" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("listbox", { name: "Filter chain" })).toContainText("Ordered (Gameboy)");

  await page.reload();
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "Open filter and preset library" }).click();
  await dialog.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(filterList.getByRole("button", { name: /Invert/ }).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
  await writeBrowserCoverage(page, "library-discovery");
});
