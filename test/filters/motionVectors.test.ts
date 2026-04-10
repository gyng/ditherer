import { describe, expect, it } from "vitest";
import motionVectorsFilter from "filters/motionVectors";
import {
  MOTION_SOURCE,
  averageBlockError,
  clearMotionVectorStateCache,
  estimateMotionVector,
  prepareMotionAnalysisBuffers,
} from "utils/motionVectors";

const makeBuffer = (width: number, height: number, fill = [0, 0, 0, 255]) => {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = fill[0];
    buf[i + 1] = fill[1];
    buf[i + 2] = fill[2];
    buf[i + 3] = fill[3];
  }
  return buf;
};

const drawBlock = (
  buf: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  size: number,
  color: [number, number, number, number],
) => {
  for (let y = y0; y < y0 + size; y += 1) {
    for (let x = x0; x < x0 + size; x += 1) {
      const i = (y * width + x) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = color[3];
    }
  }
};

const makeFakeCanvas = (width: number, height: number, data: Uint8ClampedArray) => ({
  width,
  height,
  getContext: (type: string) => type === "2d" ? {
    getImageData: () => ({
      data: new Uint8ClampedArray(data),
      width,
      height,
    }),
  } : null,
});

const runAndCapture = (filterFn, input, options): Uint8ClampedArray | null => {
  let captured: Uint8ClampedArray | null = null;
  const OriginalImageData = (globalThis as any).ImageData;

  (globalThis as any).ImageData = new Proxy(OriginalImageData, {
    construct(target, args): object {
      const instance = Reflect.construct(target, args) as object;
      if (args[0] instanceof Uint8ClampedArray) captured = args[0];
      return instance;
    },
  });

  try {
    filterFn(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("motion vector helpers", () => {
  it("tracks a translated bright block within the search radius", () => {
    const width = 12;
    const height = 12;
    const previous = makeBuffer(width, height);
    const current = makeBuffer(width, height);

    drawBlock(previous, width, 2, 4, 3, [255, 255, 255, 255]);
    drawBlock(current, width, 4, 4, 3, [255, 255, 255, 255]);

    const vector = estimateMotionVector(
      current,
      previous,
      width,
      height,
      4,
      4,
      4,
      4,
      40,
      MOTION_SOURCE.RGB,
    );

    expect(vector.dx).toBe(-2);
    expect(vector.dy).toBe(0);
    expect(vector.magnitude).toBeGreaterThan(1.5);
  });

  it("changes the error metric across source modes", () => {
    const width = 4;
    const height = 4;
    const previous = makeBuffer(width, height, [0, 10, 0, 255]);
    const current = makeBuffer(width, height, [200, 10, 0, 255]);

    const redError = averageBlockError(current, previous, width, height, 0, 0, 4, 0, 0, MOTION_SOURCE.RED);
    const greenError = averageBlockError(current, previous, width, height, 0, 0, 4, 0, 0, MOTION_SOURCE.GREEN);
    const lumaError = averageBlockError(current, previous, width, height, 0, 0, 4, 0, 0, MOTION_SOURCE.LUMA);

    expect(redError).toBeGreaterThan(greenError);
    expect(lumaError).toBeGreaterThan(greenError);
    expect(lumaError).toBeLessThan(redError);
  });

  it("treats hue as circular in HSV/HSL analysis buffers", () => {
    const width = 2;
    const height = 1;
    const previous = new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
    ]);
    const current = new Uint8ClampedArray([
      255, 0, 20, 255,
      255, 0, 20, 255,
    ]);

    const hueBuffers = prepareMotionAnalysisBuffers(current, previous, width, height, MOTION_SOURCE.HUE);
    const hueError = averageBlockError(
      current,
      previous,
      width,
      height,
      0,
      0,
      1,
      0,
      0,
      MOTION_SOURCE.HUE,
      hueBuffers.currentScalar,
      hueBuffers.previousScalar,
      hueBuffers.circularRange,
    );

    expect(hueError).toBeLessThan(15);
  });

  it("clears cached vector state when asked", () => {
    const cache = new Map<string, Float32Array>();
    cache.set("12x12:12:6:RGB", new Float32Array([1, 2, 3, 4]));

    clearMotionVectorStateCache(cache);

    expect(cache.size).toBe(0);
  });
});

describe("Motion Vectors filter", () => {
  it("renders visible output for a translated block using the new filter", () => {
    const width = 12;
    const height = 12;
    const previous = makeBuffer(width, height);
    const current = makeBuffer(width, height);

    drawBlock(previous, width, 2, 4, 3, [255, 255, 255, 255]);
    drawBlock(current, width, 4, 4, 3, [255, 255, 255, 255]);

    const input = makeFakeCanvas(width, height, current);
    const captured = runAndCapture(motionVectorsFilter.func, input, {
      ...motionVectorsFilter.defaults,
      display: "ARROWS",
      glyphMode: "ARROW",
      sourceMode: MOTION_SOURCE.RGB,
      _prevInput: previous,
    });

    expect(captured).not.toBeNull();

    let nonBackgroundPixels = 0;
    for (let i = 0; i < captured!.length; i += 4) {
      const isBackground = captured![i] === 12 && captured![i + 1] === 12 && captured![i + 2] === 14;
      if (!isBackground) nonBackgroundPixels += 1;
    }

    expect(nonBackgroundPixels).toBeGreaterThan(0);
  });

  it("renders separate channel-colored arrows in RGB split mode", () => {
    const width = 16;
    const height = 16;
    const previous = makeBuffer(width, height);
    const current = makeBuffer(width, height);

    drawBlock(previous, width, 3, 5, 3, [255, 0, 0, 255]);
    drawBlock(current, width, 5, 5, 3, [255, 0, 0, 255]);
    drawBlock(previous, width, 11, 8, 3, [0, 0, 255, 255]);
    drawBlock(current, width, 9, 8, 3, [0, 0, 255, 255]);

    const input = makeFakeCanvas(width, height, current);
    const captured = runAndCapture(motionVectorsFilter.func, input, {
      ...motionVectorsFilter.defaults,
      display: "RGB_SPLIT_ARROWS",
      glyphMode: "LINE",
      _prevInput: previous,
    });

    expect(captured).not.toBeNull();

    let redDominant = 0;
    let blueDominant = 0;
    for (let i = 0; i < captured!.length; i += 4) {
      if (captured![i] > 180 && captured![i] > captured![i + 2]) redDominant += 1;
      if (captured![i + 2] > 180 && captured![i + 2] > captured![i]) blueDominant += 1;
    }

    expect(redDominant).toBeGreaterThan(0);
    expect(blueDominant).toBeGreaterThan(0);
  });

  it("renders visible output in HSV split mode", () => {
    const width = 16;
    const height = 16;
    const previous = makeBuffer(width, height);
    const current = makeBuffer(width, height);

    drawBlock(previous, width, 4, 5, 4, [255, 0, 0, 255]);
    drawBlock(current, width, 6, 5, 4, [255, 80, 0, 255]);

    const input = makeFakeCanvas(width, height, current);
    const captured = runAndCapture(motionVectorsFilter.func, input, {
      ...motionVectorsFilter.defaults,
      display: "HSV_SPLIT_ARROWS",
      glyphMode: "LINE",
      _prevInput: previous,
    });

    expect(captured).not.toBeNull();

    let brightPixels = 0;
    for (let i = 0; i < captured!.length; i += 4) {
      if (captured![i] + captured![i + 1] + captured![i + 2] > 120) brightPixels += 1;
    }

    expect(brightPixels).toBeGreaterThan(0);
  });
});
