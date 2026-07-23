import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import kmeans, { defaults as kmeansDefaults } from "filters/kmeans";
import pixelsort, { defaults as pixelsortDefaults } from "filters/pixelsort";
import voronoi, {
  defaults as voronoiDefaults,
  findNearestVoronoiSeed,
} from "filters/voronoi";
import nearest from "palettes/nearest";

type Pixel = readonly [number, number, number, number];

const identityPalette = { ...nearest, options: { levels: 256 } };

const makeCanvas = (width: number, height: number, pixels: readonly Pixel[]) => {
  const source = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((pixel, index) => source.set(pixel, index * 4));
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width,
    height,
    getContext: (type: string) => type === "2d" ? {
      getImageData: () => ({ data: new Uint8ClampedArray(source), width, height }),
      putImageData: (image: { data: Uint8ClampedArray }) => {
        written = new Uint8ClampedArray(image.data);
      },
    } : null,
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    output: () => {
      if (!written) throw new Error("filter did not write output");
      return written;
    },
    source,
  };
};

const variedPixels = (width: number, height: number): Pixel[] =>
  Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return [(x * 47 + y * 13) % 256, (x * 11 + y * 67) % 256, (x * 89 + y * 7) % 256, 255];
  });

afterEach(() => vi.restoreAllMocks());

describe("static stochastic filters", () => {
  it("Voronoi does not read global randomness", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("global randomness is not reproducible");
    });
    const fixture = makeCanvas(8, 8, variedPixels(8, 8));
    expect(() => voronoi.func(fixture.canvas, {
      ...voronoiDefaults,
      cells: 12,
      seed: 41,
      palette: identityPalette,
    } as never)).not.toThrow();
  });

  it("K-means does not read global randomness", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("global randomness is not reproducible");
    });
    const fixture = makeCanvas(8, 8, variedPixels(8, 8));
    expect(() => kmeans.func(fixture.canvas, {
      ...kmeansDefaults,
      seed: 19,
      palette: identityPalette,
    } as never)).not.toThrow();
  });

  it("Pixelsort does not read global randomness when extra spans are enabled", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("global randomness is not reproducible");
    });
    const fixture = makeCanvas(8, 8, variedPixels(8, 8));
    expect(() => pixelsort.func(fixture.canvas, {
      ...pixelsortDefaults,
      seed: 73,
      extraIntervalStartChance: 0.5,
      palette: identityPalette,
    } as never)).not.toThrow();
  });
});

describe("Voronoi quality contracts", () => {
  it("continues past a populated near ring when an outer bucket can be closer", () => {
    const seeds = Array.from({ length: 16 }, (_, index) => ({
      x: index === 15 ? 300 : 0,
      y: 50,
    }));
    expect(findNearestVoronoiSeed(199, 50, seeds, 400, 100)).toBe(15);
  });

  it("matches brute-force nearest distances across irregular bucket populations", () => {
    const seeds = Array.from({ length: 37 }, (_, index) => ({
      x: ((index * 83 + 17) % 311) + (index % 3) * 0.25,
      y: ((index * 47 + 29) % 173) + (index % 5) * 0.125,
    }));
    for (let y = 0; y < 173; y += 11) {
      for (let x = 0; x < 311; x += 13) {
        const found = findNearestVoronoiSeed(x, y, seeds, 311, 173);
        const foundDistance = (seeds[found].x - x) ** 2 + (seeds[found].y - y) ** 2;
        const bruteDistance = Math.min(...seeds.map(site => (site.x - x) ** 2 + (site.y - y) ** 2));
        expect(foundDistance, `nearest distance at ${x},${y}`).toBeCloseTo(bruteDistance, 10);
      }
    }
  });

  it("does not let fully transparent RGB tint a visible cell", () => {
    const fixture = makeCanvas(2, 1, [
      [255, 0, 0, 255],
      [0, 0, 255, 0],
    ]);
    voronoi.func(fixture.canvas, {
      ...voronoiDefaults,
      cells: 1,
      seed: 1,
      palette: identityPalette,
    } as never);
    const output = fixture.output();
    expect(Array.from(output.slice(0, 4))).toEqual([255, 0, 0, 128]);
    expect(Array.from(output.slice(4, 8))).toEqual([255, 0, 0, 128]);
  });

  it("does not silently binary-quantize its default cell averages", () => {
    const fixture = makeCanvas(2, 1, [
      [64, 64, 64, 255],
      [192, 192, 192, 255],
    ]);
    voronoi.func(fixture.canvas, { cells: 1, seed: 1 } as never);
    expect(Array.from(fixture.output())).toEqual([128, 128, 128, 255, 128, 128, 128, 255]);
  });
});

describe("K-means quality contracts", () => {
  it("applies the selected output palette", () => {
    const fixture = makeCanvas(4, 2, variedPixels(4, 2));
    const fixedPalette = {
      name: "fixed-test-palette",
      options: {},
      getColor: (pixel: number[]) => [7, 9, 11, pixel[3]],
    };
    kmeans.func(fixture.canvas, {
      ...kmeansDefaults,
      k: 3,
      seed: 5,
      palette: fixedPalette,
    } as never);
    const output = fixture.output();
    for (let offset = 0; offset < output.length; offset += 4) {
      expect(Array.from(output.slice(offset, offset + 4))).toEqual([7, 9, 11, 255]);
    }
  });

  it("handles more requested clusters than distinct visible samples", () => {
    const fixture = makeCanvas(2, 2, Array.from({ length: 4 }, () => [80, 120, 160, 255] as const));
    kmeans.func(fixture.canvas, {
      ...kmeansDefaults,
      k: 32,
      sampleRate: 20,
      seed: 2,
      palette: identityPalette,
    } as never);
    expect(Array.from(fixture.output())).toEqual(Array.from(fixture.source));
  });

  it("does not let invisible RGB steer a visible centroid", () => {
    const fixture = makeCanvas(2, 1, [
      [255, 0, 0, 255],
      [0, 0, 255, 0],
    ]);
    kmeans.func(fixture.canvas, {
      ...kmeansDefaults,
      k: 2,
      sampleRate: 1,
      seed: 3,
      palette: identityPalette,
    } as never);
    expect(Array.from(fixture.output())).toEqual([255, 0, 0, 255, 0, 0, 255, 0]);
  });

  it("finds visible content between coarse sample-grid taps", () => {
    const fixture = makeCanvas(2, 2, [
      [0, 0, 0, 0],
      [220, 90, 30, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    kmeans.func(fixture.canvas, {
      ...kmeansDefaults,
      k: 8,
      sampleRate: 20,
      seed: 4,
      palette: identityPalette,
    } as never);
    expect(Array.from(fixture.output().slice(4, 8))).toEqual([220, 90, 30, 255]);
  });

  it("defaults to perceptual clustering without destructive palette quantization", () => {
    expect(kmeansDefaults.colorSpace).toBe("LAB");
    expect(kmeansDefaults.palette.options.levels).toBe(256);
  });
});

describe("Pixelsort quality contracts", () => {
  it("does not silently binary-quantize direct-module default sorting", () => {
    const pixels: Pixel[] = Array.from({ length: 8 }, (_, index) => {
      const value = 28 + index * 27;
      return [value, 210 - index * 19, 45 + index * 21, 255];
    });
    const fixture = makeCanvas(8, 1, pixels);
    pixelsort.func(fixture.canvas, {
      ...pixelsortDefaults,
      direction: "ROW",
      sortPixelLuminanceAbove: 0,
      sortPixelLuminanceBelow: 255,
      sortPixelLuminanceChangeAbove: -255,
      sortPixelLuminanceChangeBelow: 255,
    } as never);
    const sourceColors = new Set(pixels.map(pixel => pixel.join(",")));
    const output = fixture.output();
    for (let offset = 0; offset < output.length; offset += 4) {
      expect(sourceColors.has(Array.from(output.slice(offset, offset + 4)).join(","))).toBe(true);
    }
  });

  it("treats a maximum interval size of one as an identity permutation", () => {
    const fixture = makeCanvas(8, 1, Array.from({ length: 8 }, (_, index) => {
      const value = 255 - index * 31;
      return [value, value, value, 255] as const;
    }));
    pixelsort.func(fixture.canvas, {
      ...pixelsortDefaults,
      direction: "ROW",
      comparator: "LUMINANCE",
      sortDirection: "ASCENDING",
      sortPixelLuminanceAbove: 0,
      sortPixelLuminanceBelow: 255,
      sortPixelLuminanceChangeAbove: -255,
      sortPixelLuminanceChangeBelow: 255,
      extraIntervalStartChance: 0,
      maxIntervalSize: 1,
      palette: identityPalette,
    } as never);
    expect(Array.from(fixture.output())).toEqual(Array.from(fixture.source));
  });

  it("repeats seeded extra-span decisions byte for byte", () => {
    const first = makeCanvas(12, 3, variedPixels(12, 3));
    const second = makeCanvas(12, 3, variedPixels(12, 3));
    const options = {
      ...pixelsortDefaults,
      direction: "ROW",
      sortPixelLuminanceAbove: 255,
      sortPixelLuminanceBelow: 0,
      extraIntervalStartChance: 0.55,
      seed: 97,
      palette: identityPalette,
    };
    pixelsort.func(first.canvas, options as never);
    pixelsort.func(second.canvas, options as never);
    expect(Array.from(first.output())).toEqual(Array.from(second.output()));
  });
});
