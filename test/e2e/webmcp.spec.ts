import { expect, test } from "@playwright/test";

test.skip(process.env.PLAYWRIGHT_WEBMCP !== "1", "Run with PLAYWRIGHT_WEBMCP=1 and Chrome 150+");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ditherer-onboarding-complete", "1");
    localStorage.setItem("ditherer-workspace-layout", "docked");
  });
});

test("discovers and drives Ditherer through the current WebMCP API", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const badge = page.getByTestId("webmcp-badge");
  await expect(badge).toHaveAttribute("data-phase", "ready");
  await expect(badge).toContainText("8/8");

  const result = await page.evaluate(async () => {
    const modelContext = document.modelContext;
    if (!modelContext?.getTools || !modelContext.executeTool) {
      throw new Error("Current document.modelContext discovery APIs are unavailable");
    }
    const tools = await modelContext.getTools();
    const byName = (name: string) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Missing WebMCP tool: ${name}`);
      return tool;
    };
    const parseResult = <T,>(value: unknown): T => (
      typeof value === "string" ? JSON.parse(value) as T : value as T
    );

    const filters = parseResult<{ filters: Array<{ name: string }> }>(await modelContext.executeTool(
      byName("ditherer.listFilters"),
      JSON.stringify({ query: "Floyd-Steinberg" }),
    ));
    const chainBefore = parseResult<{ chain: Array<{ options: Record<string, unknown> }> }>(await modelContext.executeTool(
      byName("ditherer.getCurrentChain"),
      "{}",
    ));
    await modelContext.executeTool(
      byName("ditherer.setFilterOption"),
      JSON.stringify({ index: 0, optionName: "serpentine", value: false }),
    );
    const chainAfter = parseResult<{ chain: Array<{ options: Record<string, unknown> }> }>(await modelContext.executeTool(
      byName("ditherer.getCurrentChain"),
      "{}",
    ));

    return {
      names: tools.map((tool) => tool.name),
      filterNames: filters.filters.map((filter) => filter.name),
      serpentineBefore: chainBefore.chain[0]?.options.serpentine,
      serpentineAfter: chainAfter.chain[0]?.options.serpentine,
    };
  });

  expect(result.names).toHaveLength(8);
  expect(result.names).toContain("ditherer.getCurrentChain");
  expect(result.filterNames).toContain("Floyd-Steinberg");
  expect(result.serpentineBefore).toBe(true);
  expect(result.serpentineAfter).toBe(false);

  await page.getByRole("button", { name: "Adjust", exact: true }).click();
  const serpentineControl = page.locator("#active-filter-options label")
    .filter({ hasText: "Serpentine" })
    .locator('input[type="checkbox"]');
  await expect(serpentineControl).not.toBeChecked();

  await badge.focus();
  await expect(page.getByRole("tooltip")).toContainText("discover filters and presets");
});

test("completes discovery, media, preset, and export workflows through every WebMCP tool", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("webmcp-badge")).toHaveAttribute("data-phase", "ready");

  const workflow = page.evaluate(async () => {
    const modelContext = document.modelContext;
    if (!modelContext?.getTools || !modelContext.executeTool) {
      throw new Error("Current document.modelContext discovery APIs are unavailable");
    }
    const tools = await modelContext.getTools();
    const byName = (name: string) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Missing WebMCP tool: ${name}`);
      return tool;
    };
    const execute = async <T,>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      try {
        const value = await modelContext.executeTool(byName(name), JSON.stringify(args));
        return (typeof value === "string" ? JSON.parse(value) : value) as T;
      } catch (error) {
        throw new Error(`${name} failed: ${String(error)}`, { cause: error });
      }
    };

    // Round 1: discover a preset, apply it, and inspect the resulting chain.
    const presets = await execute<{
      presets: Array<{ name: string; filters: string[] }>;
    }>("ditherer.listPresets");
    const preset = presets.presets[0];
    if (!preset) throw new Error("Expected at least one discoverable preset");
    const applied = await execute<{ filtersApplied: number }>("ditherer.applyPreset", { name: preset.name });
    const presetChain = await execute<{ chain: Array<{ displayName: string }> }>("ditherer.getCurrentChain");

    // Round 2: replace the source with a real image payload and verify the app can export it.
    const loaded = await execute<{ filename: string; mimeType: string; sizeBytes: number }>("ditherer.loadMedia", {
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg==",
      filename: "webmcp-pixel.png",
    });
    const image = await execute<{
      mimeType: string;
      width: number;
      height: number;
      sizeBytes: number;
      dataUrl: string;
    }>("ditherer.exportImage", { format: "png", returnDataUrl: true });

    // Round 3: exercise the real canvas capture and MediaRecorder path.
    const video = await execute<{
      mimeType: string;
      durationSeconds: number;
      sizeBytes: number;
      dataUrl: string;
    }>("ditherer.exportVideo", { durationSeconds: 0.25, fps: 1, returnDataUrl: true });

    return {
      toolNames: tools.map((tool) => tool.name),
      presetFilters: preset.filters,
      filtersApplied: applied.filtersApplied,
      chainNames: presetChain.chain.map((entry) => entry.displayName),
      loaded,
      image,
      video,
    };
  });
  const result = await workflow.catch((error: unknown) => {
    throw new Error(`${String(error)}\nBrowser errors:\n${browserErrors.join("\n")}`);
  });

  expect(result.toolNames).toHaveLength(8);
  expect(result.filtersApplied).toBe(result.presetFilters.length);
  expect(result.chainNames).toEqual(result.presetFilters);
  expect(result.loaded).toMatchObject({ filename: "webmcp-pixel.png", mimeType: "image/png" });
  expect(result.loaded.sizeBytes).toBeGreaterThan(0);
  expect(result.image, browserErrors.join("\n")).toMatchObject({ mimeType: "image/png" });
  expect(result.image.width).toBeGreaterThan(0);
  expect(result.image.height).toBe(result.image.width);
  expect(result.image.sizeBytes).toBeGreaterThan(0);
  expect(result.image.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(result.video.mimeType).toContain("video/webm");
  expect(result.video.durationSeconds).toBe(0.25);
  expect(result.video.sizeBytes).toBeGreaterThan(0);
  expect(result.video.dataUrl).toMatch(/^data:video\/webm[^,]*;base64,/);
});
