import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

test("onboarding starts from the loaded sample and opens the look library", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.addInitScript(() => {
    localStorage.removeItem("ditherer-onboarding-complete");
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const onboarding = page.getByRole("complementary", { name: "Getting started" });
  await expect(onboarding).toContainText("Ready to remix");
  await expect(onboarding).toContainText("sample video and starter dither are already running");
  await expect(onboarding.getByRole("button", { name: "Browse looks" })).toBeVisible();
  await expect(onboarding.getByRole("button", { name: "Use my media" })).toBeVisible();
  await expect(onboarding.getByRole("button", { name: "Try an example" })).toHaveCount(0);

  await onboarding.getByRole("button", { name: "Browse looks" }).click();
  await expect(onboarding).toBeHidden();
  await expect(page.getByTestId("filter-library-dialog")).toBeVisible();
  await writeBrowserCoverage(page, "ux-onboarding");
});

test("ranks and bounds filter typeahead results with keyboard selection and recents", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Compose", exact: true }).click();

  await page.getByTitle("Click to search and replace filter").click();
  await expect(page.getByTestId("filter-typeahead")).toBeVisible();
  await page.getByRole("combobox", { name: "Search filters" }).fill("invert");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("filter-typeahead")).toBeHidden();
  await expect(page.locator('[data-stage-active="true"]')).toContainText("Floyd-Steinberg");

  const trigger = page.getByRole("combobox", { name: "Add filter...", exact: true });
  await trigger.click();
  const typeahead = page.getByTestId("filter-typeahead");
  const search = page.getByRole("combobox", { name: "Search filters" });
  const items = typeahead.getByTestId("filter-typeahead-item");

  await expect(search).toBeFocused();
  await expect(typeahead).toContainText(/\d+ total/);
  expect(await items.count()).toBeLessThanOrEqual(12);

  await search.fill("raymarching");
  await expect(typeahead).toContainText("Best matches");
  await expect(items.first()).toContainText("Heightfield Raymarch");
  await expect(items.first()).toContainText("Advanced");
  expect(await items.count()).toBeLessThanOrEqual(48);

  await search.fill("no-filter-can-match-this");
  await expect(typeahead).toContainText("No matches");
  await expect(typeahead).toContainText("No matching filters");
  await expect(items).toHaveCount(0);

  await search.fill("black hole");
  await expect(items.first()).toContainText("Black Hole Lens");
  await search.press("Enter");
  await expect(page.locator("#chain-composer")).toContainText("Black Hole Lens");

  await trigger.click();
  await expect(typeahead).toContainText("Recent + explore");
  await expect(items.first()).toContainText("Black Hole Lens");
  await expect(typeahead.locator("kbd")).toHaveText(["↑↓", "Enter", "Esc"]);
  await writeBrowserCoverage(page, "ux-filter-typeahead");
});

test("docks canvases, compares output, and restores modal focus", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const inputWindow = page.getByText(/^Input - /).locator("..");
  const outputWindow = page.getByText(/^Output - /).locator("..");
  await expect(inputWindow).toBeVisible();
  await expect(outputWindow).toBeVisible();
  await expect(page.locator("#source-task")).toBeVisible();
  await expect(page.locator("#compose-task")).toBeHidden();
  await expect(page.getByRole("region", { name: "Choose source media" })).toContainText("Step 1 of 5");

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(inputWindow).toBeInViewport();
  await expect(outputWindow).toBeInViewport();

  const chainComposer = page.locator("#chain-composer");
  await expect(chainComposer.getByText("Filter chain", { exact: true })).toBeVisible();
  await expect(page.locator("#source-task")).toBeHidden();
  await expect(page.locator("#active-filter-options")).toBeHidden();
  await expect(page.locator("#preview-output-settings")).toBeHidden();
  await expect(page.getByRole("region", { name: "Build the filter chain" })).toContainText("Step 2 of 5");
  await expect(chainComposer.getByText("1 stage", { exact: true })).toBeVisible();
  const activeStage = chainComposer.locator('[data-stage-active="true"]');
  await expect(activeStage).toHaveCount(1);
  await expect(activeStage).toHaveAttribute("data-stage-enabled", "true");
  await expect(activeStage).toContainText("Floyd-Steinberg");
  await expect(chainComposer.getByText("Active stage", { exact: true })).toHaveCount(0);

  await activeStage.getByRole("button", { name: /More actions for/ }).click();
  await expect(activeStage.getByRole("button", { name: /Reset .* to defaults/ })).toBeVisible();

  const unlabeledControls = await page.locator("input:not([type=hidden]), select, textarea").evaluateAll((elements) =>
    elements
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .filter((element) => {
        const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        return control.labels?.length === 0
          && !control.getAttribute("aria-label")
          && !control.getAttribute("aria-labelledby");
      })
      .map((element) => `${element.tagName.toLowerCase()}#${element.id || "(no-id)"}`)
  );
  expect(unlabeledControls).toEqual([]);

  const inputBox = await inputWindow.boundingBox();
  const outputBox = await outputWindow.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(outputBox).not.toBeNull();
  expect(inputBox!.x + inputBox!.width <= outputBox!.x || outputBox!.x + outputBox!.width <= inputBox!.x).toBe(true);

  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(chainComposer).toBeHidden();
  await expect(page.locator("#active-filter-options")).toBeVisible();
  await expect(page.getByRole("region", { name: "Tune the active stage" })).toContainText("Step 3 of 5");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(inputWindow).toBeInViewport();
  await expect(outputWindow).toBeInViewport();

  const grayscale = page.getByRole("checkbox", { name: /Pre-convert to grayscale/ });
  await grayscale.check();
  await expect(grayscale).toBeChecked();
  await page.waitForTimeout(300);
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(grayscale).not.toBeChecked();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator("#compose-task")).toBeHidden();
  await expect(page.locator("#preview-output-settings")).toBeVisible();
  await expect(page.getByRole("region", { name: "Review the output" })).toContainText("Step 4 of 5");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(inputWindow).toBeInViewport();
  await expect(outputWindow).toBeInViewport();

  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Before / after" })).toBeVisible();
  const holdBefore = page.getByRole("button", { name: "Hold before" });
  await holdBefore.dispatchEvent("pointerdown");
  await expect(holdBefore).toHaveAttribute("aria-pressed", "true");
  await holdBefore.dispatchEvent("pointerup");
  await expect(holdBefore).toHaveAttribute("aria-pressed", "false");

  const exportButton = page.getByRole("group", { name: "Save and export" })
    .getByRole("button", { name: "Export…" });
  await exportButton.click();
  const saveDialog = page.getByRole("dialog", { name: "Save As" });
  await expect(saveDialog).toBeVisible();
  await expect(saveDialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(saveDialog).toBeHidden();
  await expect(exportButton).toBeFocused();
  await expect(page.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-current", "page");

  await page.keyboard.press("Control+k");
  const commandPalette = page.getByRole("dialog", { name: "Command palette" });
  const commandSearch = page.getByRole("combobox", { name: "Search commands" });
  await expect(commandPalette).toBeVisible();
  await expect(commandSearch).toBeFocused();
  await commandSearch.fill("Toggle before");
  await commandSearch.press("Enter");
  await expect(commandPalette).toBeHidden();

  const webMCPBadge = page.getByTestId("webmcp-badge");
  await expect(webMCPBadge).toBeVisible();
  await expect(webMCPBadge).toHaveAttribute("data-phase", "unsupported");
  await webMCPBadge.focus();
  await expect(page.getByRole("tooltip")).toContainText("enable chrome://flags/#enable-webmcp-testing");
  await writeBrowserCoverage(page, "ux-workbench-desktop");
});

test("uses one focused mobile task and keeps library actions reachable", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator("#source-task")).toBeVisible();
  await expect(page.locator("#compose-task")).toBeHidden();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const previewTitleBox = await page.getByText(/^Output - /).boundingBox();
  expect(previewTitleBox).not.toBeNull();
  expect(previewTitleBox!.height).toBeLessThan(40);

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await expect(page.locator("#source-task")).toBeHidden();
  await expect(page.locator("#compose-task")).toBeVisible();
  await expect(page.locator("#chain-composer")).toBeVisible();
  await expect(page.locator("#active-filter-options")).toBeHidden();
  await expect(page.locator("#chain-composer").getByText("Runs top to bottom")).toBeVisible();

  await page.getByRole("combobox", { name: "Add filter...", exact: true }).click();
  await page.getByRole("combobox", { name: "Search filters" }).fill("glitch");
  const typeahead = page.getByTestId("filter-typeahead");
  const typeaheadBox = await typeahead.boundingBox();
  expect(typeaheadBox).not.toBeNull();
  expect(typeaheadBox!.x).toBeGreaterThanOrEqual(0);
  expect(typeaheadBox!.y).toBeGreaterThanOrEqual(0);
  expect(typeaheadBox!.x + typeaheadBox!.width).toBeLessThanOrEqual(390);
  expect(typeaheadBox!.y + typeaheadBox!.height).toBeLessThanOrEqual(844);
  const typeaheadItemBox = await typeahead.getByTestId("filter-typeahead-item").first().boundingBox();
  expect(typeaheadItemBox).not.toBeNull();
  expect(typeaheadItemBox!.height).toBeGreaterThanOrEqual(60);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(page.locator("#chain-composer")).toBeHidden();
  await expect(page.locator("#active-filter-options")).toBeVisible();
  const inspector = page.getByLabel("Active filter parameters");
  await expect(inspector).toContainText("Stage 1 of 1 · Parameters");
  await expect(inspector).toContainText("Floyd-Steinberg");
  const exactRangeValue = page.locator("#active-filter-options input[type=number]").first();
  await expect(exactRangeValue).toBeVisible();
  const exactRangeValueBox = await exactRangeValue.boundingBox();
  expect(exactRangeValueBox).not.toBeNull();
  expect(exactRangeValueBox!.height).toBeGreaterThanOrEqual(40);

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByTitle("Open full filter/preset browser").click();
  const dialog = page.getByTestId("filter-library-dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(388);
  expect(box!.height).toBeGreaterThanOrEqual(840);

  await page.getByTestId("filter-library-list").locator("button").first().click();
  await expect(page.getByTestId("filter-library-details")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to Chain" })).toBeVisible();
  const addBox = await page.getByRole("button", { name: "Add to Chain" }).boundingBox();
  expect(addBox).not.toBeNull();
  expect(addBox!.y + addBox!.height).toBeLessThanOrEqual(844);
  await writeBrowserCoverage(page, "ux-workbench-mobile");
});
