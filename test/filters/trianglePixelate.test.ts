import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import trianglePixelate, { defaults } from "filters/trianglePixelate";

// GL and CPU backends must agree on what a filter outputs. The GL fragment
// shader here always returns `texture(u_source, uv)` — full RGBA, alpha
// included. The CPU fallback point-samples the same source pixel (`buf[si]`)
// but was hardcoding outBuf[i+3] = 255, discarding whatever alpha it just
// read at `si` into the palette lookup. jsdom has no WebGL2, so glAvailable()
// is false here and this test always exercises the CPU path.

const W = 10;
const H = 10;

// cellSize === W === H means the whole canvas is a single square cell, split
// into two triangles by the diagonal `localX + localY < size`. That keeps
// the two fixed sample points deterministic and independent of any tie-break
// or averaging logic:
//   upper triangle (tri=0) samples (size/3, size/3)     -> rounds to (3, 3)
//   lower triangle (tri=1) samples (size*2/3, size*2/3) -> rounds to (7, 7)
const UPPER_SAMPLE = { x: 3, y: 3 };
const LOWER_SAMPLE = { x: 7, y: 7 };

const makeCanvas = (setup: (data: Uint8ClampedArray) => void) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 10; data[i + 1] = 20; data[i + 2] = 30; data[i + 3] = 255;
  }
  setup(data);
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width: W,
    height: H,
    getContext: (type: string) => type === "2d" ? {
      getImageData: () => ({ data: new Uint8ClampedArray(data), width: W, height: H }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        written = new Uint8ClampedArray(img.data);
      },
    } : null,
  } as unknown as HTMLCanvasElement;
  return { canvas, written: () => written };
};

const index = (x: number, y: number) => (y * W + x) * 4;

describe("Triangle Pixelate CPU/GL alpha parity", () => {
  it("carries the point-sampled source alpha through instead of forcing opaque", () => {
    const { canvas, written } = makeCanvas((data) => {
      const upperIdx = index(UPPER_SAMPLE.x, UPPER_SAMPLE.y);
      data[upperIdx] = 200; data[upperIdx + 1] = 100; data[upperIdx + 2] = 50; data[upperIdx + 3] = 128;

      const lowerIdx = index(LOWER_SAMPLE.x, LOWER_SAMPLE.y);
      data[lowerIdx] = 60; data[lowerIdx + 1] = 90; data[lowerIdx + 2] = 120; data[lowerIdx + 3] = 64;
    });

    trianglePixelate.func(canvas, { ...defaults, cellSize: W, outline: false } as any);
    const out = written();
    if (!out) throw new Error("no output written");

    // Pixel (0,0) is in the upper triangle (0+0 < 10); its cell samples (3,3).
    expect(out[index(0, 0) + 3], "upper-triangle region should carry the semi-transparent source alpha").toBe(128);
    // Pixel (9,9) is in the lower triangle (9+9 >= 10); its cell samples (7,7).
    expect(out[index(9, 9) + 3], "lower-triangle region should carry the semi-transparent source alpha").toBe(64);
  });
});
