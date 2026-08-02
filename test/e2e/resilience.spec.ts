import { expect, test } from "@playwright/test";
import { startBrowserCoverage, writeBrowserCoverage } from "./browserCoverage";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

test("media failures and invalid project/settings input stay recoverable", async ({ page }) => {
  await startBrowserCoverage(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/test-assets/image/pepper.png", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.goto("/?testMedia=image%3Apepper.png");

  const mediaError = page.getByRole("alert");
  await expect(mediaError).toContainText("Failed to load image asset");
  await mediaError.getByRole("button", { name: "Dismiss" }).click();
  await expect(mediaError).toBeHidden();
  await page.unroute("**/test-assets/image/pepper.png");
  await page
    .getByRole("combobox", { name: "Choose an example image" })
    .selectOption({ label: "lenna.png" });
  await expect(page.getByText("Input - lenna.png", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const importDialog = page.getByRole("dialog", { name: "Paste JSON" });
  await importDialog.getByRole("textbox").fill("{ definitely not json }");
  const errorDialogPromise = page.waitForEvent("dialog");
  const importClick = importDialog.getByRole("button", { name: "OK" }).click();
  const errorDialog = await errorDialogPromise;
  expect(errorDialog.message()).toContain("Could not import project JSON");
  await errorDialog.accept();
  await importClick;
  await expect(importDialog).toBeVisible();
  await importDialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Screensaver", exact: true }).click();
  const screensaver = page.getByRole("dialog", { name: "Screensaver settings" });
  await screensaver.getByLabel("Seconds per swap").fill("-1");
  const configErrorPromise = page.waitForEvent("dialog");
  const startClick = screensaver.getByRole("button", { name: "Start" }).click();
  const configError = await configErrorPromise;
  expect(configError.message()).toContain("positive screensaver swap interval");
  await configError.accept();
  await startClick;
  await expect(screensaver).toBeVisible();
  await screensaver.getByRole("button", { name: "Cancel" }).click();

  expect(pageErrors).toEqual([]);
  await writeBrowserCoverage(page, "resilience-recovery");
});

test("WebGL-required filters explain unsupported hardware instead of failing silently", async ({
  page,
}) => {
  await startBrowserCoverage(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, ...args: unknown[]) {
      if (contextId === "webgl2") return null;
      return original.call(
        this,
        contextId as "2d",
        ...(args as [CanvasRenderingContext2DSettings]),
      );
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?testMedia=image%3Apepper.png");
  await page.getByRole("button", { name: "Compose", exact: true }).click();
  await page.getByRole("button", { name: "Open filter and preset library" }).click();
  const library = page.getByTestId("filter-library-dialog");
  await library.getByRole("textbox", { name: "Search filters" }).fill("Black Hole Lens");
  const result = page
    .getByTestId("filter-library-list")
    .getByRole("button", { name: /Black Hole Lens/ })
    .first();
  await expect(result).toBeDisabled();
  await expect(result).toHaveAttribute("title", /WebGL2 is required/);
  await expect(page.getByTestId("filter-library-list")).toContainText("GL req");
  await writeBrowserCoverage(page, "resilience-no-gl");
});
