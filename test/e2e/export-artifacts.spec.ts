import { readFile } from "node:fs/promises";
import { expect, test, type Download } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

const downloadBytes = async (download: Download) => {
  const path = await download.path();
  if (!path) throw new Error("Browser did not expose the downloaded artifact path");
  return readFile(path);
};

test("image export downloads a correctly scaled PNG artifact", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.goto("/?testMedia=image%3Apepper.png");
  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save As" });
  await dialog.getByRole("tab", { name: "Image" }).click();
  await dialog.getByRole("radio", { name: "2x" }).check();
  const dimensions = await dialog.getByText(/\d+ x \d+ → \d+ x \d+/).textContent();
  const match = dimensions?.match(/→\s*(\d+)\s*x\s*(\d+)/);
  expect(match).toBeTruthy();

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const download = await downloadPromise;
  const bytes = await downloadBytes(download);

  expect(download.suggestedFilename()).toMatch(/^ditherer-.*\.png$/);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.readUInt32BE(16)).toBe(Number(match![1]));
  expect(bytes.readUInt32BE(20)).toBe(Number(match![2]));
  await writeBrowserCoverage(page, "export-artifacts-image");
});

test("JPEG and WebP image exports honor quality and custom sizing", async ({ page }) => {
  await page.goto("/?testMedia=image%3Apepper.png");
  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save As" });
  await dialog.getByRole("tab", { name: "Image" }).click();
  await dialog.getByRole("radio", { name: "Custom" }).check();
  await dialog.getByRole("spinbutton", { name: "Custom resolution multiplier" }).fill("3");

  const format = dialog.getByRole("combobox", { name: "Format" });
  for (const expected of [
    { value: "jpeg", extension: "jpeg", signature: "ffd8" },
    { value: "webp", extension: "webp", signature: "RIFF" },
  ]) {
    await format.selectOption(expected.value);
    await dialog.getByRole("slider", { name: "Quality" }).fill("0.63");
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const download = await downloadPromise;
    const bytes = await downloadBytes(download);
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^ditherer-.*\\.${expected.extension}$`),
    );
    if (expected.value === "jpeg") {
      expect(bytes.subarray(0, 2).toString("hex")).toBe(expected.signature);
    } else {
      expect(bytes.subarray(0, 4).toString("ascii")).toBe(expected.signature);
      expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    }
    expect(bytes.length).toBeGreaterThan(1_000);
  }
});

test("video contact-sheet export renders a selected range and downloads PNG", async ({ page }) => {
  await startBrowserCoverage(page);
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/?testMedia=video%3Aakiyo.mp4");
  await expect(page.getByText("Input - akiyo.mp4", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save As" });
  await dialog.getByRole("tab", { name: "Video" }).click();
  await dialog.getByRole("radio", { name: "contact sheet" }).check();
  await dialog.getByRole("slider", { name: "Samples" }).fill("4");
  await dialog.getByRole("slider", { name: "Columns" }).fill("2");
  await dialog.getByRole("radio", { name: "Timestamp range" }).check();
  await dialog.getByRole("slider", { name: "Export range start" }).fill("0");
  await dialog.getByRole("slider", { name: "Export range end" }).fill("0.5");
  await dialog.getByRole("button", { name: "Render Range", exact: true }).click();

  const ready = dialog.getByText("Contact sheet PNG ready to save or copy.");
  await expect
    .poll(
      async () => {
        if (await ready.isVisible()) return "ready";
        return browserErrors[0] || "pending";
      },
      { timeout: 60_000 },
    )
    .toBe("ready");
  const preview = dialog.getByRole("img", { name: "Contact sheet export preview" });
  await expect
    .poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const download = await downloadPromise;
  const bytes = await downloadBytes(download);
  expect(download.suggestedFilename()).toMatch(/^ditherer-.*\.png$/);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.length).toBeGreaterThan(1_000);
  await writeBrowserCoverage(page, "export-artifacts-contact");
});

test("offline GIF export renders a short selected range and downloads GIF", async ({ page }) => {
  await startBrowserCoverage(page);
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/?testMedia=video%3Aakiyo.mp4");
  await expect(page.getByText("Input - akiyo.mp4", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save As" });
  await dialog.getByRole("tab", { name: "Video" }).click();
  await dialog.getByRole("radio", { name: "gif" }).check();
  await dialog
    .getByRole("combobox", { name: "Capture Mode" })
    .selectOption({ label: "Offline Render (Browser, Slower)" });
  await dialog.getByRole("checkbox", { name: "Match source" }).uncheck();
  await dialog.getByRole("slider", { name: "Manual FPS" }).fill("4");
  await dialog.getByRole("radio", { name: "Timestamp range" }).check();
  await dialog.getByRole("slider", { name: "Export range start" }).fill("0");
  await dialog.getByRole("slider", { name: "Export range end" }).fill("0.5");
  await dialog.getByRole("button", { name: "Render Range", exact: true }).click();

  const preview = dialog.getByRole("img", { name: "GIF export preview" });
  await expect
    .poll(
      async () => {
        if (await preview.isVisible()) return "ready";
        return browserErrors[0] || "pending";
      },
      { timeout: 60_000 },
    )
    .toBe("ready");

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const download = await downloadPromise;
  const bytes = await downloadBytes(download);
  expect(download.suggestedFilename()).toMatch(/^ditherer-.*\.gif$/);
  expect(["GIF87a", "GIF89a"]).toContain(bytes.subarray(0, 6).toString("ascii"));
  expect(bytes.length).toBeGreaterThan(1_000);
  await writeBrowserCoverage(page, "export-artifacts-gif");
});

test("offline and realtime recording paths both produce downloadable video", async ({ page }) => {
  await startBrowserCoverage(page);
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/?testMedia=video%3Aakiyo.mp4");
  await expect(page.getByText("Input - akiyo.mp4", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save As" });
  await dialog.getByRole("tab", { name: "Video" }).click();
  await dialog.getByRole("radio", { name: "video", exact: true }).check();
  const captureMode = dialog.getByRole("combobox", { name: "Capture Mode" });
  await captureMode.selectOption({ label: "Offline Render (Browser, Slower)" });
  await dialog.getByRole("checkbox", { name: "Include source audio" }).uncheck();
  await dialog.getByRole("radio", { name: "Timestamp range" }).check();
  await dialog.getByRole("slider", { name: "Reliable range start" }).fill("0");
  await dialog.getByRole("slider", { name: "Reliable range end" }).fill("0.35");
  await dialog.getByRole("button", { name: "Start rendering", exact: true }).click();

  const save = dialog.getByRole("button", { name: "Save", exact: true });
  await expect
    .poll(
      async () => {
        if (await save.isEnabled()) return "ready";
        return browserErrors[0] || "pending";
      },
      { timeout: 90_000 },
    )
    .toBe("ready");

  let downloadPromise = page.waitForEvent("download");
  await save.click();
  let download = await downloadPromise;
  let bytes = await downloadBytes(download);
  expect(download.suggestedFilename()).toMatch(/^ditherer-.*\.webm$/);
  expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
  expect(bytes.length).toBeGreaterThan(1_000);

  await captureMode.selectOption({ label: "Realtime (Fastest)" });
  const record = dialog.getByRole("button", { name: "● Record", exact: true });
  await record.click();
  await expect(dialog.getByText(/● REC/)).toBeVisible();
  await page.waitForTimeout(700);
  await dialog.getByRole("button", { name: "■ Stop", exact: true }).click();
  await expect(save).toBeEnabled({ timeout: 30_000 });

  downloadPromise = page.waitForEvent("download");
  await save.click();
  download = await downloadPromise;
  bytes = await downloadBytes(download);
  expect(download.suggestedFilename()).toMatch(/^ditherer-.*\.(webm|mp4)$/);
  const isWebM = bytes.subarray(0, 4).toString("hex") === "1a45dfa3";
  const isMp4 = bytes.subarray(4, 8).toString("ascii") === "ftyp";
  expect(isWebM || isMp4).toBe(true);
  expect(bytes.length).toBeGreaterThan(1_000);
  expect(browserErrors).toEqual([]);
  await writeBrowserCoverage(page, "export-artifacts-video");
});

test("sequence export can be cancelled, retried, and downloaded as ZIP", async ({ page }) => {
  await startBrowserCoverage(page);
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto("/?testMedia=video%3Aakiyo.mp4");
  await expect(page.getByText("Input - akiyo.mp4", { exact: true })).toBeVisible();
  const sourcePosition = page.getByRole("slider", { name: "Video position" });
  await expect
    .poll(async () => Number(await sourcePosition.getAttribute("max")))
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Save As" });
  await dialog.getByRole("tab", { name: "Video" }).click();
  await dialog.getByRole("radio", { name: "sequence" }).check();
  await dialog
    .getByRole("combobox", { name: "Capture Mode" })
    .selectOption({ label: "Offline Render (Browser, Slower)" });
  await dialog.getByRole("checkbox", { name: "Match source" }).uncheck();
  await dialog.getByRole("slider", { name: "Manual FPS" }).fill("30");
  await dialog.getByRole("button", { name: "Render Whole Video", exact: true }).click();
  await dialog.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Render Whole Video", exact: true }),
  ).toBeVisible();

  await dialog.getByRole("slider", { name: "Manual FPS" }).fill("4");
  await dialog.getByRole("radio", { name: "Timestamp range" }).check();
  await dialog.getByRole("slider", { name: "Export range start" }).fill("0");
  await dialog.getByRole("slider", { name: "Export range end" }).fill("0.5");
  await dialog.getByRole("button", { name: "Render Range", exact: true }).click();

  const ready = dialog.getByText("Sequence ZIP ready to save or copy.");
  await expect
    .poll(
      async () => {
        if (await ready.isVisible()) return "ready";
        return browserErrors[0] || "pending";
      },
      { timeout: 60_000 },
    )
    .toBe("ready");

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const download = await downloadPromise;
  const bytes = await downloadBytes(download);
  expect(download.suggestedFilename()).toMatch(/^ditherer-.*\.zip$/);
  expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(bytes.length).toBeGreaterThan(1_000);
  expect(browserErrors).toEqual([]);
  await writeBrowserCoverage(page, "export-artifacts-sequence");
});
