import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import delaunay, { defaults as delaunayDefaults } from "filters/delaunay";
import { buildMedianCutPalette } from "filters/medianCut";
import { resolveStainedGlassCellColors } from "../../packages/ditherer-filters/src/utils/stainedGlassColor";
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
    getContext: (type: string) =>
      type === "2d"
        ? {
            getImageData: () => ({ data: new Uint8ClampedArray(source), width, height }),
            putImageData: (image: { data: Uint8ClampedArray }) => {
              written = new Uint8ClampedArray(image.data);
            },
          }
        : null,
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    output: () => {
      if (!written) throw new Error("filter did not write output");
      return written;
    },
  };
};

describe("Delaunay quality contracts", () => {
  it("covers the complete opaque raster instead of only the random-site hull", () => {
    const pixels: Pixel[] = Array.from({ length: 32 * 24 }, (_, index) => [
      (index * 17) % 256,
      (index * 43) % 256,
      (index * 71) % 256,
      255,
    ]);
    const fixture = makeCanvas(32, 24, pixels);
    delaunay.func(fixture.canvas, {
      ...delaunayDefaults,
      pointCount: 50,
      edgeWeight: 0,
      showEdges: false,
      seed: 9,
      palette: identityPalette,
    } as never);
    const output = fixture.output();
    for (let offset = 3; offset < output.length; offset += 4) {
      expect(output[offset], `alpha at pixel ${(offset - 3) / 4}`).toBe(255);
    }
  });

  it("preserves source alpha", () => {
    const pixels: Pixel[] = Array.from({ length: 12 * 12 }, (_, index) => [
      180,
      70,
      25,
      (index * 37) % 256,
    ]);
    const fixture = makeCanvas(12, 12, pixels);
    delaunay.func(fixture.canvas, {
      ...delaunayDefaults,
      pointCount: 50,
      edgeWeight: 0,
      showEdges: true,
      seed: 3,
      palette: identityPalette,
    } as never);
    const output = fixture.output();
    pixels.forEach((pixel, index) => expect(output[index * 4 + 3]).toBe(pixel[3]));
  });

  it("does not let invisible RGB tint visible triangle representatives", () => {
    const pixels: Pixel[] = Array.from({ length: 16 * 16 }, (_, index) =>
      index % 5 === 0 ? [230, 35, 20, 255] : [0, 0, 255, 0],
    );
    const fixture = makeCanvas(16, 16, pixels);
    delaunay.func(fixture.canvas, {
      ...delaunayDefaults,
      pointCount: 50,
      edgeWeight: 0,
      showEdges: false,
      seed: 11,
      palette: identityPalette,
    } as never);
    const output = fixture.output();
    pixels.forEach((pixel, index) => {
      if (pixel[3] === 0) return;
      const offset = index * 4;
      expect(output[offset]).toBeGreaterThan(200);
      expect(output[offset + 2]).toBeLessThan(60);
    });
  });
});

describe("Stained Glass color statistics", () => {
  const visible: Pixel[] = [
    ...Array.from({ length: 4 }, () => [240, 20, 20, 255] as const),
    ...Array.from({ length: 3 }, () => [20, 20, 240, 255] as const),
    ...Array.from({ length: 3 }, () => [20, 240, 20, 255] as const),
  ];
  const toBuffer = (pixels: readonly Pixel[]) => {
    const out = new Uint8ClampedArray(pixels.length * 4);
    pixels.forEach((pixel, index) => out.set(pixel, index * 4));
    return out;
  };

  it("implements distinct average, weighted-median, and dominant-cluster modes", () => {
    const ids = new Int32Array(visible.length);
    const source = toBuffer(visible);
    const average = Array.from(
      resolveStainedGlassCellColors(ids, source, 1, "AVERAGE").slice(0, 3),
    );
    const median = Array.from(resolveStainedGlassCellColors(ids, source, 1, "MEDIAN").slice(0, 3));
    const dominant = Array.from(
      resolveStainedGlassCellColors(ids, source, 1, "DOMINANT").slice(0, 3),
    );
    expect(new Set([average.join(","), median.join(","), dominant.join(",")]).size).toBe(3);
    expect(dominant).toEqual([240, 20, 20]);
  });

  it("does not let fully transparent outliers alter pane colors", () => {
    const baselineIds = new Int32Array(visible.length);
    const expanded = [...visible, ...Array.from({ length: 20 }, () => [255, 0, 255, 0] as const)];
    const expandedIds = new Int32Array(expanded.length);
    for (const mode of ["AVERAGE", "MEDIAN", "DOMINANT"] as const) {
      expect(
        Array.from(resolveStainedGlassCellColors(expandedIds, toBuffer(expanded), 1, mode)),
      ).toEqual(Array.from(resolveStainedGlassCellColors(baselineIds, toBuffer(visible), 1, mode)));
    }
  });
});

describe("Median Cut palette contracts", () => {
  const varied = new Uint8ClampedArray(64 * 4);
  for (let index = 0; index < 64; index++) {
    varied[index * 4] = (index * 47) % 256;
    varied[index * 4 + 1] = (index * 83) % 256;
    varied[index * 4 + 2] = (index * 131) % 256;
    varied[index * 4 + 3] = 255;
  }

  it.each([3, 5, 7, 13, 17, 31])(
    "honors a maximum of %i colors exactly when enough colors exist",
    (levels) => {
      const palette = buildMedianCutPalette(varied, levels, "AVERAGE", "RGB");
      expect(palette).toHaveLength(levels);
    },
  );

  it("ignores hidden RGB when building its visible palette", () => {
    const visibleOnly = new Uint8ClampedArray([
      230, 30, 20, 255, 20, 210, 40, 255, 30, 40, 220, 255, 180, 160, 40, 255,
    ]);
    const hiddenChanged = new Uint8ClampedArray([
      ...visibleOnly,
      255,
      0,
      255,
      0,
      0,
      255,
      255,
      0,
      255,
      255,
      255,
      0,
    ]);
    expect(buildMedianCutPalette(hiddenChanged, 3, "AVERAGE", "RGB")).toEqual(
      buildMedianCutPalette(visibleOnly, 3, "AVERAGE", "RGB"),
    );
  });
});
