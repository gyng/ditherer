import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import crosshatch, { defaults as crosshatchDefaults } from "filters/crosshatch";
import engraving, { defaults as engravingDefaults } from "filters/engraving";
import nearest from "palettes/nearest";

const identityPalette = { ...nearest, options: { levels: 256 } };

type Written = { data: Uint8ClampedArray };

const flatCanvas = (value: number, alpha = 255, width = 32, height = 32) => {
  const source = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < source.length; i += 4) {
    source[i] = value;
    source[i + 1] = value;
    source[i + 2] = value;
    source[i + 3] = alpha;
  }
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width,
    height,
    getContext: (type: string) =>
      type === "2d"
        ? {
            getImageData: () => ({ data: new Uint8ClampedArray(source), width, height }),
            putImageData: (image: Written) => {
              written = new Uint8ClampedArray(image.data);
            },
          }
        : null,
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    output: () => {
      if (!written) throw new Error("no output");
      return written;
    },
  };
};

const meanLuma = (data: Uint8ClampedArray): number => {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return sum / (data.length / 4);
};

const run = (
  filter: { func: (input: unknown, options: unknown) => unknown },
  base: Record<string, unknown>,
  value: number,
  alpha = 255,
) => {
  const fixture = flatCanvas(value, alpha);
  filter.func(fixture.canvas, { ...base, palette: identityPalette, _webglAcceleration: false });
  return fixture.output();
};

afterEach(() => vi.restoreAllMocks());

describe.each([
  ["Crosshatch", crosshatch, crosshatchDefaults],
  ["Engraving", engraving, engravingDefaults],
] as const)("%s tonal density (JS path)", (_name, filter, base) => {
  it("renders a near-black region darker than a mid-grey region", () => {
    // The core defect fixed: the old two-threshold response collapsed every
    // shadow tone to the same pattern. A darker input must ink more.
    const midGrey = meanLuma(run(filter, base as never, 150));
    const shadow = meanLuma(run(filter, base as never, 90));
    const nearBlack = meanLuma(run(filter, base as never, 20));
    expect(shadow).toBeLessThan(midGrey);
    expect(nearBlack).toBeLessThan(shadow);
  });

  it("leaves a white region as bare paper", () => {
    expect(meanLuma(run(filter, base as never, 255))).toBeGreaterThan(230);
  });

  it("preserves source alpha", () => {
    const data = run(filter, base as never, 80, 128);
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(128);
  });

  it("does not throw on malformed options and still writes output", () => {
    const fixture = flatCanvas(120);
    expect(() =>
      filter.func(fixture.canvas, {
        density: Number.NaN,
        lineSpacing: Number.NaN,
        angle1: null,
        angle2: "INVALID",
        angle: Number.POSITIVE_INFINITY,
        palette: identityPalette,
        _webglAcceleration: false,
      } as never),
    ).not.toThrow();
    expect(fixture.output().length).toBe(32 * 32 * 4);
  });
});
