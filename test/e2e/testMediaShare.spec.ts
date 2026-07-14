import { expect, test } from "@playwright/test";
import {
  startBrowserCoverage,
  writeBrowserCoverage,
} from "./browserCoverage";

const sharedMedia = (url: string) => new URL(url).searchParams.get("testMedia");

test("shared URLs restore bundled test images and videos", async ({ page }) => {
  await startBrowserCoverage(page);
  await page.goto("/?testMedia=image%3Apepper.png");

  await expect(page.getByText("Input - pepper.png", { exact: true })).toBeVisible();
  await expect.poll(() => sharedMedia(page.url())).toBe("image:pepper.png");

  await page.locator("#test-video-select").selectOption({ label: "akiyo.mp4" });
  await expect(page.getByText("Input - akiyo.mp4", { exact: true })).toBeVisible();
  await expect.poll(() => sharedMedia(page.url())).toBe("video:akiyo.mp4");

  await page.reload();
  await expect(page.getByText("Input - akiyo.mp4", { exact: true })).toBeVisible();
  await expect.poll(() => sharedMedia(page.url())).toBe("video:akiyo.mp4");
  await writeBrowserCoverage(page, "test-media-share");
});
