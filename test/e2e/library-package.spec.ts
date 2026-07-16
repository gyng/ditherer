import { expect, test } from "@playwright/test";

type LibrarySmokeResult = {
  status: "ok" | "failed";
  catalogSize?: number;
  steps?: string[];
  frameIndex?: number;
  pixels?: number[];
  workerSteps?: string[];
  workerPixels?: number[];
  error?: string;
};

test("built filter package imports and processes a canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/library-smoke.html");
  await expect(page.getByTestId("status")).toHaveText(/ok|failed/);

  const result = await page.evaluate(
    () => (window as unknown as { __librarySmoke?: LibrarySmokeResult }).__librarySmoke,
  );
  expect(result, result?.error).toMatchObject({
    status: "ok",
    steps: ["Grayscale"],
    frameIndex: 1,
    workerSteps: ["Grayscale"],
  });
  expect(result?.catalogSize).toBeGreaterThan(300);
  expect(result?.pixels).toHaveLength(8);
  expect(result?.workerPixels).toHaveLength(8);
  expect(errors).toEqual([]);
});
