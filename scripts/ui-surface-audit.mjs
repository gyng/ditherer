import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const browser = await chromium.launch();
const directory = path.resolve("docs/ui/screenshots");
const prefix = process.env.UI_SURFACE_PREFIX ?? "07";
const baseURL = process.env.UI_BASE_URL ?? "http://127.0.0.1:4173";
const observations = [];
try {
  for (const [viewport, width, height] of [
    ["desktop", 1440, 1000],
    ["phone", 390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(`${baseURL}/?testMedia=image%3Apepper.png`);
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    const captures = [
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
      ["confirm", async () => page.getByRole("button", { name: "Clear filter chain" }).click()],
    ];
    for (const [surface, open] of captures) {
      await open();
      await page.screenshot({
        animations: "disabled",
        path: path.join(directory, `${prefix}-${viewport}-${surface}.png`),
      });
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      const violations = result.violations.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
      }));
      observations.push({ viewport, surface, violations });
      console.log(viewport, surface, JSON.stringify(violations));
      await page.keyboard.press("Escape");
    }
    await context.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(
  path.resolve(`docs/ui/${prefix}-surfaces.json`),
  JSON.stringify(observations, null, 2) + "\n",
);
