import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

test("chain keyboard editing, recovery, saved chains, JSON, and share URLs round-trip", async ({
  page,
}) => {
  await startBrowserCoverage(page);
  await page.goto("/?testMedia=image%3Apepper.png");
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Load a preset" })
    .selectOption({ label: "Amber Terminal" });
  const chain = page.getByRole("listbox", { name: "Filter chain" });
  await expect(chain.getByRole("option")).toHaveCount(3);
  const originalOrder = await chain.getByRole("option").allTextContents();

  await chain.getByLabel("Stage 1").click();
  await expect(chain.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await chain.focus();
  await expect(chain).toBeFocused();
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Alt");
  const reordered = await chain.getByRole("option").allTextContents();
  expect(reordered).not.toEqual(originalOrder);
  await chain.press(" ");
  await expect(chain.getByRole("option").nth(1).getByRole("checkbox")).not.toBeChecked();
  await chain.press("Delete");
  await expect(chain.getByRole("option")).toHaveCount(2);
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(chain.getByRole("option")).toHaveCount(3);

  await page.getByRole("button", { name: "Clear filter chain" }).click();
  const clearDialog = page.getByRole("dialog", { name: "Clear filter chain" });
  await expect(clearDialog).toBeVisible();
  await clearDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(chain.getByRole("option")).toHaveCount(3);
  await page.getByRole("button", { name: "Clear filter chain" }).click();
  await page
    .getByRole("dialog", { name: "Clear filter chain" })
    .getByRole("button", { name: "OK" })
    .click();
  await expect(chain.getByRole("option")).toHaveCount(1);
  await expect(chain.getByRole("option").first()).toContainText("None");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(chain.getByRole("option")).toHaveCount(3);

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("prompt");
    await dialog.accept("Dogfood Amber");
  });
  await page.getByRole("button", { name: "Save chain", exact: true }).click();
  const savedChains = page.getByRole("combobox", { name: "Load a saved chain" });
  await expect(savedChains).toBeVisible();

  await page
    .getByRole("combobox", { name: "Load a preset" })
    .selectOption({ label: "Gameboy Screen" });
  await savedChains.selectOption("Dogfood Amber");
  await expect(chain.getByRole("option")).toHaveCount(3);
  await expect(page.getByTitle('Delete "Dogfood Amber"')).toBeVisible();

  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: "⇧ JSON", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export JSON (copied to clipboard)" });
  const exportedJson = await exportDialog.getByRole("textbox").inputValue();
  expect(JSON.parse(exportedJson)).toBeTruthy();
  await exportDialog.getByRole("button", { name: "OK" }).click();

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  const grayscale = page.getByRole("checkbox", { name: /Pre-convert to grayscale/ });
  await grayscale.check();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const importDialog = page.getByRole("dialog", { name: "Paste JSON" });
  await importDialog.getByRole("textbox").fill(exportedJson);
  await importDialog.getByRole("button", { name: "OK" }).click();
  await expect(grayscale).not.toBeChecked();

  const shareTextPromise = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    });
  });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const shareText = await shareTextPromise;
  const shareUrl = shareText.split("\n").find((line) => line.startsWith("http"));
  expect(shareUrl).toBeTruthy();
  await page.goto(shareUrl!);
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await expect(chain.getByRole("option")).toHaveCount(3);

  await savedChains.selectOption("Dogfood Amber");
  await page.getByTitle('Delete "Dogfood Amber"').click();
  await expect(page.getByRole("combobox", { name: "Load a saved chain" })).toHaveCount(0);
  await writeBrowserCoverage(page, "project-state");
});
