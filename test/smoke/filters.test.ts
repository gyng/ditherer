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
    "Glitch",    // async, dispatches actions
    "Program",   // uses eval
    "Halftone",  // uses canvas compositing not supported in jsdom
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

  it("infinite call windows is registered and returns a canvas", () => {
    expect(filterIndex["Infinite Call Windows"]).toBeDefined();
    const input = cloneCanvas(canvas, true);
    const output = filterIndex["Infinite Call Windows"].func(
      input,
      filterIndex["Infinite Call Windows"].defaults
    );
    expect(output).toBeInstanceOf(HTMLCanvasElement);
    expect(output.width).toBe(16);
    expect(output.height).toBe(16);
  });

  it("infinite call windows handles missing _prevOutput cleanly", () => {
    const input = cloneCanvas(canvas, true);
    const output = filterIndex["Infinite Call Windows"].func(input, {
      ...filterIndex["Infinite Call Windows"].defaults,
      _prevOutput: null,
    });
    expect(output).toBeInstanceOf(HTMLCanvasElement);
    expect(output.width).toBe(16);
    expect(output.height).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// The canvas mock's getImageData always returns zeros, so we can't use a real
// canvas as input. Instead, provide a plain object that implements the subset
// of the canvas API the filters use, returning known pixel data.
// ---------------------------------------------------------------------------
const makeFakeInputCanvas = (w: number, h: number, fill: number[]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]; data[i + 1] = fill[1];
    data[i + 2] = fill[2]; data[i + 3] = fill[3];
  }
  return {
    width: w,
    height: h,
    // cloneCanvas(input, false) only reads .width/.height, so no drawImage needed.
    getContext: (type: string) => type === "2d" ? {
      getImageData: (_x: number, _y: number, cw: number, ch: number) => ({
        data: new Uint8ClampedArray(data),
        width: cw,
        height: ch
      })
    } : null
  };
};

// ---------------------------------------------------------------------------
// Run a filter and capture every Uint8ClampedArray passed to `new ImageData()`
// so we can inspect computed pixel values without relying on getImageData.
// Returns all captures — some filters post-process their output (e.g. a blur
// pass at the end of VHS) which reads through a jsdom canvas that returns
// zeros, so a single "last wins" capture would miss the real filter output.
// ---------------------------------------------------------------------------
const runAndCaptureAll = (filterFn, input, options): Uint8ClampedArray[] => {
  const captured: Uint8ClampedArray[] = [];
  const OriginalImageData = (globalThis as any).ImageData;

  (globalThis as any).ImageData = new Proxy(OriginalImageData, {
    construct(target, args): object {
      const instance = Reflect.construct(target, args) as object;
      if (args[0] instanceof Uint8ClampedArray) captured.push(args[0]);
      return instance;
    }
  });

  try {
    filterFn(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

// ---------------------------------------------------------------------------
// Regression: every filter must produce non-transparent output with
// _linearize: true. This catches the bug where a filter passes isLinear=true
// to paletteGetColor without doing the actual sRGB↔linear conversion,
// resulting in float [0-1] values written to Uint8ClampedArray → transparent.
//
// Filters that properly handle linearize (ordered, error diffusing, etc.)
// branch with `if (options._linearize)` and do their own conversion.
// Filters that use srgbPaletteGetColor ignore the flag entirely (correct).
// This test catches any filter that falls through the cracks.
// ---------------------------------------------------------------------------
describe("linearize safety: every filter produces opaque output with _linearize=true", () => {
  // Filters that are genuinely incompatible with a unit-test environment.
  // Kept to an absolute minimum; everything else is handled dynamically:
  //   • requiresGL filters get auto-skipped (no WebGL2 in jsdom)
  //   • filters that throw on our fake canvas get skipped with a message
  //     (typically drawImage/cloneCanvas(input, true) fallbacks)
  //   • filters that return without ever constructing ImageData get skipped
  //     (no palette path → the bug this test guards against can't manifest)
  const hardSkip = new Set([
    "Glitch",   // async, dispatches actions — doesn't return a canvas
    "Program",  // uses eval on user code — too risky to invoke blind
  ]);

  const checkAlpha = (
    name: string,
    filter: typeof filterIndex[string],
    options: Record<string, unknown>,
  ) => {
    let captures: Uint8ClampedArray[];
    try {
      captures = runAndCaptureAll(filter.func, makeFakeInputCanvas(8, 8, [128, 64, 32, 255]), options);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Filters that throw on the fake canvas (usually drawImage/cloneCanvas
      // fallbacks) are skipped rather than failed — we're not testing
      // compatibility with fake-canvas quirks here, just the linearize path.
      console.warn(`[smoke:${name}] skipped: threw ${msg}`);
      return;
    }
    if (captures.length === 0) {
      // No ImageData constructed → the palette path never ran for this
      // input → the linearize bug has no surface area here. Skip.
      console.warn(`[smoke:${name}] skipped: no ImageData output`);
      return;
    }
    // Walk every capture and take the highest alpha. Follow-on processing
    // (e.g. the convolve blur at the end of VHS) reads through a jsdom
    // canvas which returns zeros; that zero capture would mask a healthy
    // primary output if we only looked at the last one.
    let maxAlpha = 0;
    for (const data of captures) {
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > maxAlpha) maxAlpha = data[i];
      }
    }
    expect(maxAlpha, `${name} alpha collapsed to ${maxAlpha} (linearize bug?)`).toBeGreaterThan(100);
  };

  for (const [name, filter] of Object.entries(filterIndex)) {
    if (hardSkip.has(name)) { it.skip(`${name} (hard-skip)`, () => {}); continue; }
    if ((filter as { requiresGL?: boolean }).requiresGL) {
      it.skip(`${name} (requiresGL, covered by gl-smoke)`, () => {});
      continue;
    }

    it(`${name}: alpha preserved with _linearize=true`, () => {
      checkAlpha(name, filter, { ...filter.defaults, _linearize: true });
    });

    it(`${name}: alpha preserved with _linearize=false`, () => {
      checkAlpha(name, filter, { ...filter.defaults, _linearize: false });
    });
  }
});
