import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const baseURL = process.env.UI_BASE_URL ?? "http://127.0.0.1:4173";
const directory = path.resolve("docs/ui/screenshots");
const prefix = process.env.UI_TASK_PREFIX ?? "05";
fs.mkdirSync(directory, { recursive: true });
const browser = await chromium.launch();
const observations = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseURL}/?testMedia=image%3Apepper.png`);
  await page.getByText("Input - pepper.png", { exact: true }).waitFor();
  await page.getByText("OUTPUT PENDING", { exact: true }).waitFor({ state: "hidden" });
  const next = page.getByRole("button", { name: "Next: Compose →" });
  await next.focus();
  await page.keyboard.press("Enter");
  const add = page.getByRole("combobox", { name: "Add filter...", exact: true });
  await add.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("combobox", { name: "Search filters" }).fill("Invert");
  await page.keyboard.press("Enter");
  const chain = page.getByRole("list", { name: "Filter chain" });
  await expect(chain.getByRole("listitem")).toHaveCount(2);
  await chain.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await page.keyboard.press("Delete");
  await expect(chain.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(chain.getByRole("listitem")).toHaveCount(2);
  await page.screenshot({
    animations: "disabled",
    path: path.join(directory, `${prefix}-keyboard-chain.png`),
  });
  await page.getByRole("button", { name: "Preview", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Compare", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("slider", { name: "Before / after" }).focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Export", exact: true }).focus();
  await page.keyboard.press("Enter");
  const save = page
    .getByRole("dialog", { name: "Save As" })
    .getByRole("button", { name: "Save", exact: true });
  let steps = 0;
  while (!(await save.evaluate((node) => node === document.activeElement)) && steps < 20) {
    await page.keyboard.press("Tab");
    steps++;
  }
  await expect(save).toBeFocused();
  const download = page.waitForEvent("download");
  await page.keyboard.press("Space");
  const result = await download;
  observations.push({
    task: "keyboard load/compose/reorder/toggle/delete/undo/compare/export",
    tabStepsToSave: steps,
    filename: result.suggestedFilename(),
    errors,
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const filename =
    "A very long descriptive source filename for checking the full title gradient and truncation at narrow window widths.png";
  await page.locator("#imageLoader").setInputFiles({
    name: filename,
    mimeType: "image/png",
    buffer: fs.readFileSync("public/test-assets/image/pepper.png"),
  });
  await page.getByText(`Input - ${filename}`, { exact: true }).waitFor();
  await page.screenshot({
    animations: "disabled",
    path: path.join(directory, `${prefix}-long-title.png`),
  });
  observations.push({ task: "long local filename", errors: [...errors] });
  await context.close();

  for (const [state, width, height] of [
    ["error", 1440, 1000],
    ["phone-error", 390, 844],
    ["processing", 1440, 1000],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.route("**/test-assets/image/pepper.png", async (route) => {
      if (state === "processing") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      } else {
        await route.fulfill({ status: 404, body: "missing" });
      }
    });
    await page.goto(`${baseURL}/?testMedia=image%3Apepper.png`, { waitUntil: "domcontentloaded" });
    if (state !== "processing") await page.getByRole("alert").waitFor();
    await page.screenshot({
      animations: "disabled",
      path: path.join(directory, `${prefix}-${state}.png`),
    });
    observations.push({
      task: state,
      width,
      height,
      overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    });
    await context.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(
  path.resolve(`docs/ui/${prefix}-tasks.json`),
  JSON.stringify(observations, null, 2) + "\n",
);
console.log(JSON.stringify(observations));
