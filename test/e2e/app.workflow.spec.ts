import { expect, test, type Locator, type Page } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(60_000);

const setControlToAlternateValue = async (control: Locator) => {
  const type = await control.getAttribute("type");
  if (type === "checkbox" || type === "radio") {
    await control.click();
    return;
  }
  if (type === "range") {
    const min = Number(await control.getAttribute("min") ?? 0);
    const max = Number(await control.getAttribute("max") ?? 1);
    const step = Number(await control.getAttribute("step") ?? 1);
    const steps = Math.max(1, Math.round(((max - min) * 0.37) / step));
    await control.fill(String(min + steps * step));
    return;
  }
  if ((await control.evaluate((node) => node.tagName)) === "SELECT") {
    const values = await control.locator("option:not([disabled])").evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
    );
    if (values.length > 1) await control.selectOption(values.at(-1));
  }
};

const changeVisibleControls = async (page: Page, scope = page.locator("body")) => {
  const controls = scope.locator("input:not([type=file]), select");
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible() || await control.isDisabled()) continue;
    await setControlToAlternateValue(control);
  }
};

const clickChainEntryAction = async (entry: Locator, actionName: RegExp) => {
  const action = entry.getByRole("button", { name: actionName });
  if (!await action.isVisible()) {
    await entry.getByRole("button", { name: /More actions for/ }).click();
  }
  await expect(action).toBeVisible();
  await action.click();
};

test("core application workflows remain operable together", async ({ page }) => {
  await startBrowserCoverage(page);
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.goto("/?testMedia=image%3Apepper.png");

  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "Apply Chain" }).click();
  await expect(page.getByText(/output is current|Auto apply on · output updates as you edit/)).toBeVisible();

  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await page.getByLabel("Pre-convert to grayscale").check();
  await page.getByLabel("Gamma-correct input").check();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("slider", { name: "Input Scale" }).fill("0.75");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("slider", { name: "Output Scale" }).fill("1.25");
  await page.getByRole("combobox", { name: "Scaling algorithm" }).selectOption({ index: 1 });

  await page.getByRole("button", { name: "Compose", exact: true }).click();
  const chain = page.getByRole("listbox", { name: "Filter chain" });
  await chain.press(" ");
  await chain.press(" ");
  await page.getByTitle("Random curated preset").click();
  await expect(chain.getByRole("option")).not.toHaveCount(0);
  await page.getByTitle("Add a random filter").click();

  const firstEntry = chain.getByRole("option").first();
  await firstEntry.click();
  const firstName = (await firstEntry.textContent() ?? "").trim();
  await firstEntry.getByRole("checkbox").click();
  await firstEntry.getByRole("checkbox").click();
  await clickChainEntryAction(firstEntry, /Randomize options for/);
  await clickChainEntryAction(firstEntry, /Reset .* to defaults/);
  await clickChainEntryAction(firstEntry, /Randomize options for/);
  await clickChainEntryAction(firstEntry, /Duplicate/);
  expect(firstName).not.toBe("");

  await page.getByTitle("Open full filter/preset browser").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const library = page.getByRole("dialog");
  await page.getByPlaceholder(/Search filters/).fill("Invert");
  await library.getByText("Invert", { exact: true }).first().click();
  await page.getByRole("button", { name: "Add to Chain" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  for (const name of ["Dock", "Float", "Lock", "Lock", "Reset", "Fit", "Output only", "Compare"]) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();

  await page.getByRole("button", { name: "Export…", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Save As" })).toBeVisible();
  await page.getByRole("tab", { name: "Video" }).click();
  await page.getByRole("tab", { name: "Image" }).click();
  await changeVisibleControls(page, page.getByRole("dialog", { name: "Save As" }));
  await page.getByTitle("Close").click();

  await page.getByText("Settings", { exact: true }).click();
  for (const name of ["Apply automatically", "WASM acceleration", "WebGL acceleration", "Rainy Day theme"]) {
    const checkbox = page.getByRole("checkbox", { name });
    await checkbox.click();
    await checkbox.click();
  }

  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.locator("#test-video-select").selectOption({ label: "akiyo.mp4" });
  await expect(page.getByText("Input - akiyo.mp4", { exact: true })).toHaveText("Input - akiyo.mp4");
  await page.getByRole("button", { name: /^(▶ Play|⏸ Pause)$/ }).click();
  await page.getByLabel("Mute").click();
  await page.getByTitle("Step forward by roughly one frame").click();
  await page.locator("#test-image-select").selectOption({ label: "pepper.png" });
  await expect(page.getByText("Input - pepper.png", { exact: true })).toHaveText("Input - pepper.png");

  await writeBrowserCoverage(page, "app-workflow");
});
