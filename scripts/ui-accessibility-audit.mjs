import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const browser = await chromium.launch();
const reports = [];
try {
  for (const [viewport, width, height] of [
    ["desktop", 1440, 1000],
    ["phone", 390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(
      `${process.env.UI_BASE_URL ?? "http://127.0.0.1:4173"}/?testMedia=image%3Apepper.png`,
    );
    await page.getByText("Input - pepper.png", { exact: true }).waitFor({ state: "attached" });
    await page.getByText("OUTPUT PENDING", { exact: true }).waitFor({ state: "hidden" });
    for (const task of ["Source", "Compose", "Preview", "Export", "Library"]) {
      if (task === "Library") {
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Compose", exact: true }).click();
        await page.getByRole("button", { name: /Browse looks/ }).click();
      } else {
        await page.getByRole("button", { name: task, exact: true }).click();
      }
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      const violations = result.violations.map(({ id, impact, help, helpUrl, nodes }) => ({
        id,
        impact,
        help,
        helpUrl,
        nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
      }));
      reports.push({
        viewport,
        task,
        violations,
        incomplete: result.incomplete.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
      });
      console.log(viewport, task, JSON.stringify(violations));
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const directory = path.resolve("docs/ui");
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(
  path.join(directory, `${process.env.UI_AUDIT_PREFIX ?? "03"}-accessibility.json`),
  JSON.stringify(reports, null, 2) + "\n",
);
