import { afterEach, describe, expect, it, vi } from "vitest";

// cloneCanvas(input) normally deep-copies; return the input so the single mock
// canvas serves as both the read source and the draw target (its 2d context is
// cached, so inputCtx === outputCtx and every draw call is captured in place).
vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import halftone, { defaults as halftoneDefaults } from "filters/halftone";

type Pixel = readonly [number, number, number, number];
type Arc = { cx: number; cy: number; r: number; style: string };

const makeCanvas = (width: number, height: number, pixels: Pixel[]) => {
  const source = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((p, i) => source.set(p, i * 4));
  const arcs: Arc[] = [];
  let fillStyle = "";
  const ctx = {
    set fillStyle(v: string) { fillStyle = v; },
    get fillStyle() { return fillStyle; },
    globalCompositeOperation: "source-over",
    getImageData: () => ({ data: new Uint8ClampedArray(source), width, height }),
    fillRect: () => {},
    beginPath: () => {},
    arc: (cx: number, cy: number, r: number) => { arcs.push({ cx, cy, r, style: fillStyle }); },
    fill: () => {},
  };
  const canvas = {
    width,
    height,
    getContext: (type: string) => (type === "2d" ? ctx : null),
  } as unknown as HTMLCanvasElement;
  return { canvas, arcs };
};

// The three arcs drawn per cell are R, G, B in that order (fillStyle is set to
// rgba(255,0,0,..), (0,255,0,..), (0,0,255,..) before each). Pull the red one.
const redRadius = (arcs: Arc[]): number => {
  const red = arcs.find((a) => a.style.startsWith("rgba(255, 0, 0"));
  if (!red) throw new Error("no red dot drawn");
  return red.r;
};

afterEach(() => vi.restoreAllMocks());

describe("Halftone levels control (BUG 2 wired)", () => {
  // A flat mid-grey cell. The exposed `levels` slider must quantise the dot
  // tone: at levels=2 the mean (100) rounds down to 0 (no dot); at levels=32 it
  // rounds to a large radius. If `options.levels` were still ignored, both runs
  // would use the palette's fixed level count and produce identical radii.
  const flatGrey = (): Pixel[] => Array.from({ length: 16 }, () => [100, 100, 100, 255] as Pixel);

  const run = (levels: number) => {
    const { canvas, arcs } = makeCanvas(4, 4, flatGrey());
    halftone.func(canvas, {
      ...halftoneDefaults,
      size: 4,
      sizeMultiplier: 2,
      offset: 0,
      levels,
      _webglAcceleration: false,
    } as never);
    return redRadius(arcs);
  };

  it("changes the dot radius when levels changes (nearest palette)", () => {
    // The default palette is `nearest`, whose getColor honours `levels`.
    const coarse = run(2);   // 100 -> 0
    const fine = run(32);    // 100 -> ~99
    expect(coarse).not.toBeCloseTo(fine, 3);
    expect(coarse).toBeCloseTo(0, 5);
    expect(fine).toBeGreaterThan(1);
  });

  // A custom palette's getColor ignores a `levels` count, so the CPU quantiser
  // can't respond to the slider. To stay in lock-step with the GL backend
  // (which is forced to 256/passthrough for non-nearest palettes), the CPU must
  // ALSO pass through: changing levels must leave the dot radius unchanged.
  it("leaves the dot radius unchanged when levels changes (custom palette)", () => {
    const customPalette = { name: "custom", getColor: (c: number[]) => c, options: {} };
    const runCustom = (levels: number) => {
      const { canvas, arcs } = makeCanvas(4, 4, flatGrey());
      halftone.func(canvas, {
        ...halftoneDefaults,
        palette: customPalette,
        size: 4,
        sizeMultiplier: 2,
        offset: 0,
        levels,
        _webglAcceleration: false,
      } as never);
      return redRadius(arcs);
    };
    expect(runCustom(2)).toBeCloseTo(runCustom(32), 6);
  });
});

describe("Halftone cell averaging (BUG 1 direction: CPU averages the block)", () => {
  // 2x2 checkerboard forms a single grid cell whose block mean is 127.5. With
  // levels high enough to disable quantisation (nearest passes through at 256),
  // the red dot radius is meanR/255 * (size/2) * sizeMultiplier = 127.5/255*1*2
  // = 1.0. A centre point-sample would read pixel (1,1)=255 and yield 2.0, so
  // 1.0 proves the CPU derives the tone from the AVERAGE, not the centre.
  it("derives the dot tone from the cell mean, not the centre pixel", () => {
    const checker: Pixel[] = [
      [255, 255, 255, 255], // (0,0)
      [0, 0, 0, 255],       // (1,0)
      [0, 0, 0, 255],       // (0,1)
      [255, 255, 255, 255], // (1,1) — centre sample, distinct from the mean
    ];
    const { canvas, arcs } = makeCanvas(2, 2, checker);
    halftone.func(canvas, {
      ...halftoneDefaults,
      size: 2,
      sizeMultiplier: 2,
      offset: 0,
      levels: 256, // no quantisation -> radius reflects the raw mean
      _webglAcceleration: false,
    } as never);

    const r = redRadius(arcs);
    expect(r).toBeCloseTo(1.0, 5);   // == average (127.5)
    expect(r).toBeLessThan(1.5);     // != centre point-sample (would be 2.0)
  });
});
