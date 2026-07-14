import { expect, test, type Page } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await startBrowserCoverage(page);
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

const replaceActiveFilter = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByTitle("Click to search and replace filter").click();
  const search = page.getByRole("combobox", { name: "Search filters" });
  await search.fill(name);
  const result = page.getByTestId("filter-typeahead-item").filter({ hasText: name }).first();
  await expect(result).toBeVisible();
  await result.click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(page.getByLabel("Active filter parameters")).toContainText(name);
};

test("generated filter inputs validate, reveal dependencies, reset, and persist edits", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?testMedia=image%3Apepper.png");
  await page.getByRole("button", { name: "Adjust", exact: true }).click();

  const inspector = page.getByLabel("Active filter parameters");
  const scanOrder = inspector.getByRole("combobox", { name: "Scan Order" });
  await expect(scanOrder).toBeVisible();
  await expect(inspector.getByRole("combobox", { name: "Row Alternation" })).toBeVisible();
  await scanOrder.selectOption({ label: "Hilbert Curve" });
  await expect(inspector.getByRole("checkbox", { name: "Serpentine" })).toBeHidden();
  await expect(inspector.getByRole("combobox", { name: "Error Strategy" })).toBeVisible();
  await scanOrder.selectOption({ label: "Horizontal" });

  const temporalBleed = inspector.getByRole("spinbutton", { name: "Temporal Bleed value" });
  await temporalBleed.fill("2");
  await expect(temporalBleed).toHaveAttribute("aria-invalid", "true");
  await temporalBleed.press("Enter");
  await expect(temporalBleed).toHaveValue("1");
  const resetTemporalBleed = inspector.getByRole("button", { name: "Reset Temporal Bleed to default" });
  await expect(resetTemporalBleed).toBeEnabled();
  await resetTemporalBleed.click();
  await expect(temporalBleed).toHaveValue("0");
  await inspector.getByLabel("Help for Temporal Bleed").click();
  await expect(inspector.getByRole("note").filter({ hasText: "Carry quantization error across frames" })).toBeVisible();

  const palette = inspector.getByRole("combobox", { name: "palette", exact: true });
  await palette.selectOption("User/Adaptive");
  await expect(inspector.getByRole("combobox", { name: "Palette theme" })).toBeVisible();
  await inspector.getByRole("combobox", { name: "Palette theme" }).selectOption("GAMEBOY");
  const paletteColors = inspector.getByRole("button", { name: /Remove palette color/ });
  const initialPaletteSize = await paletteColors.count();
  await expect(paletteColors.first()).toBeVisible();
  await inspector.getByRole("button", { name: "Add GAMEBOY to favorite palettes" }).click();
  await expect(inspector.getByRole("button", { name: "Remove GAMEBOY from favorite palettes" })).toHaveAttribute("aria-pressed", "true");
  await inspector.getByRole("button", { name: /Add color/ }).click();
  await inspector.getByRole("button", { name: /Add to palette/ }).click();
  await expect(paletteColors).toHaveCount(initialPaletteSize + 1);
  await paletteColors.last().press(" ");
  await expect(paletteColors).toHaveCount(initialPaletteSize);

  const extractDisclosure = inspector.getByRole("button", { name: /Extract from input/ });
  await extractDisclosure.click();
  await expect(extractDisclosure).toHaveAttribute("aria-expanded", "true");
  await inspector.getByRole("button", { name: /Extract$/ }).click();
  const extractDialog = page.getByRole("dialog", { name: "Number of colors to extract" });
  await extractDialog.getByRole("textbox").fill("4");
  await extractDialog.getByRole("button", { name: "OK" }).click();
  await expect(paletteColors).toHaveCount(4);

  await inspector.getByRole("button", { name: /Import palette/ }).click();
  const importPalette = page.getByRole("dialog", { name: "Paste theme JSON" });
  await importPalette.getByRole("textbox").fill("[[0,0,0,255],[255,255,255,255]]");
  await importPalette.getByRole("button", { name: "OK" }).click();
  await expect(paletteColors).toHaveCount(2);
  const paletteDownload = page.waitForEvent("download");
  await inspector.getByRole("button", { name: /Export$/ }).click();
  await expect((await paletteDownload).suggestedFilename()).toBe("palette.json");
  await inspector.getByRole("button", { name: /Save locally/ }).click();
  const savePalette = page.getByRole("dialog", { name: "Save current palette as" });
  await savePalette.getByRole("textbox").fill("Dogfood Palette");
  await savePalette.getByRole("button", { name: "OK" }).click();
  await expect(inspector.getByRole("combobox", { name: "Palette theme" })).toHaveValue("🎨 Dogfood Palette");
  await inspector.getByRole("button", { name: /Delete$/ }).click();

  await replaceActiveFilter(page, "ASCII");
  const background = inspector.getByRole("textbox", { name: "Background" });
  await background.fill("navy");
  await expect(background).toHaveValue("navy");
  await inspector.getByRole("button", { name: "Reset Background to default" }).click();
  await expect(background).toHaveValue("black");

  await replaceActiveFilter(page, "Program");
  const program = inspector.getByRole("textbox", { name: "Program" });
  await program.fill("r = 255 - r; g = 255 - g; b = 255 - b;");
  await expect(program).toHaveValue("r = 255 - r; g = 255 - g; b = 255 - b;");
  await inspector.getByRole("button", { name: "Reset Program to default" }).click();
  await expect(program).toContainText("Eval'd JS");

  await replaceActiveFilter(page, "Curves");
  const curveJson = inspector.getByRole("textbox", { name: "Points control points JSON" });
  const defaultCurve = await curveJson.inputValue();
  await inspector.getByRole("button", { name: "Invert" }).click();
  await expect(curveJson).not.toHaveValue(defaultCurve);
  await inspector.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(curveJson).toHaveValue(defaultCurve);

  await replaceActiveFilter(page, "Ordered");
  const thresholdMap = inspector.getByRole("combobox", { name: "Threshold Map" });
  const preview = inspector.locator("canvas[aria-label*='levels']");
  const before = await preview.getAttribute("aria-label");
  await thresholdMap.selectOption({ label: "Blue Noise 16×16" });
  await expect(preview).not.toHaveAttribute("aria-label", before ?? "");
  await expect(inspector.getByRole("button", { name: "Play / Stop" })).toBeVisible();

  expect(pageErrors).toEqual([]);
  await writeBrowserCoverage(page, "control-inputs");
});
