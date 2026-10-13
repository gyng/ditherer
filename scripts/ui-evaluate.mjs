import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const screenshotDirectory = path.resolve("docs/ui/screenshots");
fs.mkdirSync(screenshotDirectory, { recursive: true });
const prefix = process.env.UI_SCREENSHOT_PREFIX ?? "02";
const baseUrl = process.env.UI_BASE_URL ?? "http://127.0.0.1:4173";
const findings = [];
const browser = await chromium.launch();
for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["laptop", 1024, 768],
  ["phone", 390, 844],
  ["zoom", 720, 500],
]) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: name === "zoom" ? 2 : 1,
  });
  await page.addInitScript(() => localStorage.setItem("ditherer-onboarding-complete", "1"));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${baseUrl}/?testMedia=image%3Apepper.png`);
  await page.getByText("Input - pepper.png", { exact: true }).waitFor({ state: "attached" });
  await page.getByText("OUTPUT PENDING", { exact: true }).waitFor({ state: "hidden" });
  for (const step of ["Source", "Compose", "Preview", "Export"]) {
    await page.getByRole("button", { name: step, exact: true }).click();
    await page.screenshot({
      animations: "disabled",
      path: path.join(screenshotDirectory, `${prefix}-${name}-${step.toLowerCase()}.png`),
    });
    const measurement = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    findings.push({ viewport: name, step, ...measurement, errors: [...errors] });
    console.log(name, step, measurement, errors);
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: /Browse looks/ }).click();
  await page.getByTestId("filter-library-dialog").waitFor();
  await page.screenshot({
    animations: "disabled",
    path: path.join(screenshotDirectory, `${prefix}-${name}-library.png`),
  });
  await page.keyboard.press("Escape");
  await page.close();
}
await browser.close();

fs.writeFileSync(
  path.join(screenshotDirectory, `${prefix}-measurements.json`),
  JSON.stringify(findings, null, 2) + "\n",
);
