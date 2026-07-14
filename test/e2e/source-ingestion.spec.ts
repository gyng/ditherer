import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

test("file picker, drop, paste, video controls, and copy-output ingestion work together", async ({ page }) => {
  await startBrowserCoverage(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?testMedia=image%3Apepper.png");
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();

  const fileInput = page.getByLabel("Choose an image or video file");
  await fileInput.setInputFiles("public/test-assets/image/lenna.png");
  await expect(page.getByText("Input - lenna.png", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("testMedia")).toBe(false);

  const inputWindow = page.getByText("Input - lenna.png", { exact: true }).locator("..").locator("..");
  await inputWindow.evaluate(async (element) => {
    const bytes = await fetch("/test-assets/image/airplane.png").then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped-airplane.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByText("Input - dropped-airplane.png", { exact: true })).toBeVisible();

  await page.evaluate(async () => {
    const bytes = await fetch("/test-assets/image/goldhill.png").then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "pasted-goldhill.png", { type: "image/png" }));
    window.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await expect(page.getByText("Input - pasted-goldhill.png", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "<< Copy output to input" }).click();
  await expect(page.getByText("Input - filtered-output.png", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Source", exact: true }).click();
  const inputScale = page.getByRole("slider", { name: "Input Scale" });
  await inputScale.fill("0.5");
  await page.getByRole("checkbox", { name: /Fix input width/ }).check();
  await fileInput.setInputFiles("public/test-assets/video/akiyo.mp4");
  await expect(page.getByText("Input - akiyo.mp4", { exact: true })).toBeVisible();
  await expect(inputScale).toHaveValue("0.5");

  await page.getByRole("button", { name: /^(▶ Play|⏸ Pause)$/ }).click();
  const position = page.getByRole("slider", { name: "Video position" });
  await position.fill("1");
  await expect(position).toHaveValue("1");
  await page.getByRole("slider", { name: /Rate 1\.00x/ }).fill("1.5");
  await page.getByRole("checkbox", { name: "Mute" }).check();
  await page.getByTitle("Step forward by roughly one frame").click();
  await page.getByRole("button", { name: /^(▶ Play|⏸ Pause)$/ }).click();
  expect(pageErrors).toEqual([]);
  await writeBrowserCoverage(page, "source-ingestion");
});
