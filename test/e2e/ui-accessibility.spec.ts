import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.beforeEach(async ({ page }) => {
  await startBrowserCoverage(page);
});
test.afterEach(async ({ page }, testInfo) => {
  await writeBrowserCoverage(
    page,
    `accessibility-${testInfo.title.replace(/[^a-zA-Z0-9-]+/g, "-")}`,
  );
});

test("collapsed settings stay out of keyboard navigation and still export starts on Image", async ({
  page,
}) => {
  await page.goto("/?testMedia=image%3Apepper.png");
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();
  const settings = page.getByRole("button", { name: /Settings/ });
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("checkbox", { name: "Apply automatically" })).toHaveCount(0);
  await settings.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", { name: "Apply automatically", includeHidden: true }),
  ).not.toBeFocused();
  await settings.click();
  await expect(page.getByRole("checkbox", { name: "Apply automatically" })).toBeVisible();
  await settings.click();

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save As" });
  await expect(dialog.getByRole("tab", { name: "Image", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  const imageTab = dialog.getByRole("tab", { name: "Image", exact: true });
  await imageTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Video", exact: true })).toBeFocused();
  await expect(dialog.getByRole("tab", { name: "Video", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(imageTab).toBeFocused();
  await expect(imageTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("workflow and dialogs reflow at 200% equivalent desktop zoom", async ({ page }) => {
  // A 1440×1000 desktop at 200% has a 720×500 CSS viewport.
  await page.setViewportSize({ width: 720, height: 500 });
  await page.goto("/?testMedia=image%3Apepper.png");
  for (const step of ["Source", "Compose", "Preview", "Export"]) {
    await page.getByRole("button", { name: step, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      720,
    );
  }
  const dialog = page.getByRole("dialog", { name: "Save As" });
  await expect(dialog.getByRole("button", { name: "Close Save As" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close Save As" }).click();
  await expect(dialog).toBeHidden();
});

test("Space activates a stage action without toggling the filter", async ({ page }) => {
  await page.goto("/?testMedia=image%3Apepper.png");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  const stage = page.locator('[data-stage-active="true"]');
  const enabled = stage.getByRole("checkbox");
  await expect(enabled).toBeChecked();
  const more = stage.getByRole("button", { name: /More actions for/ });
  await more.focus();
  await page.keyboard.press("Space");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(enabled).toBeChecked();
});

for (const [viewport, width, height] of [
  ["desktop", 1440, 1000],
  ["phone", 390, 844],
] as const) {
  test(`${viewport} workflows meet automated WCAG checks`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await page.goto("/?testMedia=image%3Apepper.png");
    await page.getByText("Input - pepper.png", { exact: true }).waitFor({ state: "attached" });
    await page.getByText("OUTPUT PENDING", { exact: true }).waitFor({ state: "hidden" });
    for (const step of ["Source", "Compose", "Preview", "Export", "Library"]) {
      if (step === "Library") {
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Compose", exact: true }).click();
        await page.getByRole("button", { name: /Browse looks/ }).click();
      } else {
        await page.getByRole("button", { name: step, exact: true }).click();
      }
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        result.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        })),
        `${viewport} ${step}`,
      ).toEqual([]);
    }
  });
}

test("video telemetry remains readable without continuous live announcements", async ({ page }) => {
  await page.goto("/?testMedia=video%3Aakiyo.mp4");
  await expect(page.getByText("Input - akiyo.mp4", { exact: true })).toBeVisible();
  await expect(page.getByText(/\d+\.\d+ms · \d+\.\d+ fps/)).toBeVisible();
  const liveText = (await page.getByRole("status").allTextContents()).join(" ");
  expect(liveText).not.toMatch(/fps/);
  expect(liveText).toContain("AUTO");
});

test("audio and screensaver dialogs contain keyboard focus and restore their triggers", async ({
  page,
}) => {
  await page.goto("/?testMedia=image%3Apepper.png");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  const audioTrigger = page.getByTitle("Open chain audio visualizer mapping");
  await audioTrigger.click();
  const audio = page.getByRole("dialog", { name: "Chain audio visualizer settings" });
  await audio.locator("button").first().focus();
  await page.keyboard.press("Shift+Tab");
  expect(await audio.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(audio).toBeHidden();
  await expect(audioTrigger).toBeFocused();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const screensaverTrigger = page.getByRole("button", { name: "Screensaver", exact: true });
  await screensaverTrigger.click();
  const screensaver = page.getByRole("dialog", { name: "Screensaver settings" });
  await screensaver.locator("button").first().focus();
  await page.keyboard.press("Shift+Tab");
  expect(await screensaver.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(screensaver).toBeHidden();
  await expect(screensaverTrigger).toBeFocused();
});

for (const [viewport, width, height] of [
  ["desktop", 1440, 1000],
  ["phone", 390, 844],
] as const) {
  test(`${viewport} advanced surfaces meet automated WCAG checks`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await page.goto("/?testMedia=image%3Apepper.png");
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    const surfaces = [
      ["audio", async () => page.getByTitle("Open chain audio visualizer mapping").click()],
      [
        "screensaver",
        async () => {
          await page.getByRole("button", { name: "Preview", exact: true }).click();
          await page.getByRole("button", { name: "Screensaver", exact: true }).click();
        },
      ],
      ["commands", async () => page.keyboard.press("/")],
      [
        "typeahead",
        async () => {
          await page.getByRole("button", { name: "Compose", exact: true }).click();
          await page.getByRole("combobox", { name: "Add filter...", exact: true }).click();
        },
      ],
      [
        "confirmation",
        async () => page.getByRole("button", { name: "Clear filter chain" }).click(),
      ],
    ] as const;
    for (const [surface, open] of surfaces) {
      await open();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        result.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        })),
        `${viewport} ${surface}`,
      ).toEqual([]);
      await page.keyboard.press("Escape");
    }
  });
}

test("command palette stays above the rendered canvas and accepts pointer actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?testMedia=image%3Apepper.png");
  await page.getByRole("button", { name: "Commands…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return [0.1, 0.5, 0.9].every((x) =>
        [0.1, 0.5, 0.9].every((y) =>
          node.contains(
            document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y),
          ),
        ),
      );
    }),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Close command palette" }).click();
  await expect(dialog).toBeHidden();
});
