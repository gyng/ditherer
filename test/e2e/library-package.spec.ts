import { expect, test } from "@playwright/test";

type LibrarySmokeResult = {
  status: "ok" | "failed";
  catalogSize?: number;
  directFilter?: string;
  lazyFilter?: string;
  steps?: string[];
  frameIndex?: number;
  pixels?: number[];
  workerSteps?: string[];
  workerPixels?: number[];
  wasmInitialized?: boolean;
  disposed?: boolean;
  error?: string;
};

test("built filter package imports and processes a canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByTestId("status")).toHaveText(/ok|failed/);

  const result = await page.evaluate(
    () => (window as unknown as { __librarySmoke?: LibrarySmokeResult }).__librarySmoke,
  );
  expect(result, result?.error).toMatchObject({
    status: "ok",
    directFilter: "Grayscale",
    lazyFilter: "Grayscale",
    steps: ["Grayscale"],
    frameIndex: 1,
    workerSteps: ["Grayscale"],
  });
  expect(result?.catalogSize).toBeGreaterThan(300);
  expect(result?.pixels).toHaveLength(8);
  expect(result?.workerPixels).toHaveLength(8);
  expect(typeof result?.wasmInitialized).toBe("boolean");
  expect(result?.disposed).toBe(true);
  expect(errors).toEqual([]);
});
