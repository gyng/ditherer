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
  const saveDialogBackground = await saveDialog.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(saveDialogBackground).not.toBe("rgba(0, 0, 0, 0)");
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
  const taskNavBox = await page.getByRole("navigation", { name: "Workbench tasks and layout" }).boundingBox();
  const previewTitleBox = await page.getByText(/^Output - /).boundingBox();
  expect(taskNavBox).not.toBeNull();
  expect(previewTitleBox).not.toBeNull();
  expect(previewTitleBox!.y).toBeGreaterThanOrEqual(taskNavBox!.y + taskNavBox!.height);
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
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);

  await page.getByTestId("filter-library-list").locator("button").first().click();
  await expect(page.getByTestId("filter-library-details")).toBeVisible();
  const backToFilters = page.getByRole("button", { name: "← Back to filters" });
  await expect(backToFilters).toBeFocused();
  await expect(page.getByRole("button", { name: "Add to Chain" })).toBeVisible();
  const addBox = await page.getByRole("button", { name: "Add to Chain" }).boundingBox();
  expect(addBox).not.toBeNull();
  expect(addBox!.y + addBox!.height).toBeLessThanOrEqual(844);
  await backToFilters.click();
  await expect(page.getByTestId("filter-library-list").locator("button").first()).toBeFocused();
  await writeBrowserCoverage(page, "ux-workbench-mobile");
});

test("keeps the compact workbench focused and its touch targets reachable", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/?testMedia=image%3Apepper.png");

  await expect(page.locator("#source-task")).toBeVisible();
  await expect(page.locator("main [role='presentation']").first()).toBeHidden();
  const taskNav = page.getByRole("navigation", { name: "Workbench tasks and layout" });
  const taskNavBox = await taskNav.boundingBox();
  expect(taskNavBox).not.toBeNull();
  expect(taskNavBox!.height).toBeLessThanOrEqual(60);

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open filter and preset library" })).toContainText("Library");
  await expect(page.getByRole("button", { name: "Load a random curated preset" })).toContainText("Random look");
  const activeStage = page.locator('[data-stage-active="true"]');
  const toggleTarget = await activeStage.getByRole("checkbox", { name: /Disable/ }).locator("..").boundingBox();
  const stageNumber = await activeStage.locator('[aria-label="Stage 1"]').boundingBox();
  const chainBox = await activeStage.locator("..").boundingBox();
  const moreBox = await activeStage.getByRole("button", { name: /More actions for/ }).boundingBox();
  expect(toggleTarget).not.toBeNull();
  expect(stageNumber).not.toBeNull();
  expect(chainBox).not.toBeNull();
  expect(moreBox).not.toBeNull();
  expect(toggleTarget!.x + toggleTarget!.width).toBeLessThanOrEqual(stageNumber!.x);
  expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(chainBox!.x + chainBox!.width);

  await page.getByTitle("Open chain audio visualizer mapping").click();
  const audioDialog = page.getByRole("dialog", { name: "Chain audio visualizer settings" });
  await expect(audioDialog).toBeVisible();
  const audioBox = await audioDialog.boundingBox();
  expect(audioBox).not.toBeNull();
  expect(audioBox!.x).toBeGreaterThanOrEqual(0);
  expect(audioBox!.y).toBeGreaterThanOrEqual(0);
  expect(audioBox!.x + audioBox!.width).toBeLessThanOrEqual(900);
  expect(audioBox!.y + audioBox!.height).toBeLessThanOrEqual(900);
  await audioDialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText(/^Output - /)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(900);
  await writeBrowserCoverage(page, "ux-compact-workbench");
});

test("keeps desktop chrome within the viewport and canvas actions on one row", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?testMedia=image%3Apepper.png");

  const viewportFit = await page.evaluate(() => ({
    viewport: document.documentElement.clientHeight,
    document: document.documentElement.scrollHeight,
  }));
  expect(viewportFit.document).toBeLessThanOrEqual(viewportFit.viewport);
  await expect(page.getByRole("button", { name: /Input Tweaks/ })).toHaveCount(0);

  const outputWindow = page.getByText(/^Output - /).locator("..");
  const saveAsBox = await outputWindow.getByRole("button", { name: "Save As..." }).boundingBox();
  const screensaverBox = await outputWindow.getByRole("button", { name: "Screensaver" }).boundingBox();
  expect(saveAsBox).not.toBeNull();
  expect(screensaverBox).not.toBeNull();
  expect(Math.abs(saveAsBox!.y - screensaverBox!.y)).toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  for (const locator of [
    page.getByRole("button", { name: /More actions for/ }),
    page.getByRole("button", { name: "Add a random filter" }),
  ]) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  }

  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  const swatchBox = await page.getByRole("button", { name: /^Remove palette color 1,/ }).boundingBox();
  const extractBox = await page.getByRole("button", { name: /Extract from input/ }).boundingBox();
  expect(swatchBox).not.toBeNull();
  expect(extractBox).not.toBeNull();
  expect(swatchBox!.width).toBeGreaterThanOrEqual(24);
  expect(swatchBox!.height).toBeGreaterThanOrEqual(24);
  expect(extractBox!.height).toBeGreaterThanOrEqual(24);
  await writeBrowserCoverage(page, "ux-desktop-fit");
});

test("uses touch-sized source, section, and preview controls on phones", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?testMedia=image%3Apepper.png");

  const expectTouchSize = async (locator: ReturnType<typeof page.getByRole>) => {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  };

  for (const locator of [
    page.getByRole("button", { name: "Choose image or video" }),
    page.getByRole("button", { name: "Load a random example image" }),
    page.getByRole("button", { name: /Input Tweaks/ }),
    page.getByRole("button", { name: "Next: Compose →" }),
    page.getByRole("button", { name: /Settings/ }),
    page.getByRole("link", { name: "GitHub" }),
  ]) {
    await expectTouchSize(locator);
  }

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await expectTouchSize(page.getByRole("combobox", { name: "Add filter...", exact: true }));

  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await expectTouchSize(page.getByRole("button", { name: "Play / Stop" }));
  await expectTouchSize(page.getByRole("button", { name: /^Remove palette color 1,/ }));

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const scaling = page.getByRole("combobox", { name: "Output display scaling" });
  const scalingBox = await scaling.boundingBox();
  expect(scalingBox).not.toBeNull();
  expect(scalingBox!.height).toBeGreaterThanOrEqual(44);

  const outputWindow = page.getByText(/^Output - /).locator("..");
  const outputBox = await outputWindow.boundingBox();
  const screensaverBox = await outputWindow.getByRole("button", { name: "Screensaver" }).boundingBox();
  expect(outputBox).not.toBeNull();
  expect(screensaverBox).not.toBeNull();
  expect(screensaverBox!.x + screensaverBox!.width).toBeLessThanOrEqual(outputBox!.x + outputBox!.width);

  await outputWindow.getByRole("button", { name: "Save As..." }).click();
  const saveDialog = page.getByRole("dialog", { name: "Save As" });
  await expect(saveDialog).toBeVisible();
  const saveBox = await saveDialog.boundingBox();
  expect(saveBox).not.toBeNull();
  expect(saveBox!.x).toBeGreaterThanOrEqual(0);
  expect(saveBox!.y).toBeGreaterThanOrEqual(0);
  expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(390);
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(844);
  await expect(saveDialog.getByRole("button", { name: /Record/ }).first()).toBeVisible();
  await expect(saveDialog.getByRole("button", { name: /Record/ }).first()).toBeEnabled();
  await writeBrowserCoverage(page, "ux-touch-targets");
});

test("keeps large expert dialogs fully reachable on desktop", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?testMedia=image%3Apepper.png");

  const expectWithinViewport = async (dialog: ReturnType<typeof page.getByRole>) => {
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  };

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "Open filter and preset library" }).click();
  const library = page.getByRole("dialog", { name: "Filter Library" });
  await expectWithinViewport(library);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Screensaver", exact: true }).click();
  await expectWithinViewport(page.getByRole("dialog", { name: "Screensaver settings" }));
  await writeBrowserCoverage(page, "ux-expert-dialog-fit");
});

test("keeps compact confirmation and timing dialogs touch-operable", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?testMedia=image%3Apepper.png");
  await page.getByRole("button", { name: "Compose", exact: true }).click();

  await page.getByRole("button", { name: "Clear filter chain" }).click();
  const clearDialog = page.getByRole("dialog", { name: "Clear filter chain" });
  await expect(clearDialog.getByRole("button", { name: "Close clear confirmation" })).toBeVisible();
  for (const name of ["OK", "Cancel"]) {
    const box = await clearDialog.getByRole("button", { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await clearDialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Set random cycle interval" }).click();
  const cycleDialog = page.getByRole("dialog", { name: "Random chain swap" });
  await expect(cycleDialog.getByRole("button", { name: "Close random cycle settings" })).toBeVisible();
  for (const input of await cycleDialog.getByRole("spinbutton").all()) {
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  for (const name of ["OK", "Cancel"]) {
    const box = await cycleDialog.getByRole("button", { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await writeBrowserCoverage(page, "ux-compact-modal-targets");
});
