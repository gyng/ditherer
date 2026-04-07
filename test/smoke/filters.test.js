import { describe, it, expect } from "vitest";
import { filterList, filterIndex } from "filters";
import { cloneCanvas } from "utils";

// Create a test canvas with known pixel data
const createTestCanvas = (width, height, fillColor = [128, 64, 32, 255]) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = fillColor[0];
    imageData.data[i + 1] = fillColor[1];
    imageData.data[i + 2] = fillColor[2];
    imageData.data[i + 3] = fillColor[3];
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

describe("filter registry", () => {
  it("has filters registered", () => {
    expect(filterList.length).toBeGreaterThan(10);
  });

  it("every filter has required properties", () => {
    for (const entry of filterList) {
      expect(entry).toHaveProperty("displayName");
      expect(entry).toHaveProperty("filter");
      expect(entry.filter).toHaveProperty("func");
      expect(entry.filter).toHaveProperty("optionTypes");
      expect(typeof entry.filter.func).toBe("function");
    }
  });

  it("filterIndex maps names to filter objects", () => {
    expect(filterIndex).toHaveProperty("Grayscale");
    expect(filterIndex).toHaveProperty("Invert");
    expect(filterIndex.Grayscale).toHaveProperty("func");
  });
});

describe("smoke: run each filter on a test image", () => {
  const canvas = createTestCanvas(16, 16);

  // Filters that need special handling or are async
  const skipFilters = new Set([
    "Glitch",        // async, dispatches actions
    "Program",       // uses eval
    "Halftone",      // uses canvas compositing not supported in jsdom
  ]);

  for (const entry of filterList) {
    const name = entry.displayName;

    if (skipFilters.has(name)) {
      it.skip(`${name} (async/special)`, () => {});
      continue;
    }

    it(`${name} runs without throwing`, () => {
      const input = cloneCanvas(canvas, true);
      const result = entry.filter.func(input, entry.filter.options);
      // Filter should return a canvas or a string (ASYNC_FILTER)
      expect(
        result instanceof HTMLCanvasElement || typeof result === "string"
      ).toBe(true);
    });
  }
});

describe("smoke: filters return valid canvases", () => {
  const canvas = createTestCanvas(16, 16);

  it("grayscale returns a canvas", () => {
    const input = cloneCanvas(canvas, true);
    const output = filterIndex.Grayscale.func(input);
    expect(output).toBeInstanceOf(HTMLCanvasElement);
    expect(output.width).toBe(16);
    expect(output.height).toBe(16);
  });

  it("invert returns a canvas", () => {
    const input = cloneCanvas(canvas, true);
    const output = filterIndex.Invert.func(input, filterIndex.Invert.defaults);
    expect(output).toBeInstanceOf(HTMLCanvasElement);
    expect(output.width).toBe(16);
  });
});
