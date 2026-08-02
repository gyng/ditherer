import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: any) => input };
});

import convolve, { defaults as convolveDefaults, SHARPEN_3X3 } from "filters/convolve";

type Pixel = readonly [number, number, number, number];

const makeCanvas = (width: number, height: number, pixels: Pixel[]) => {
  const source = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((p, i) => source.set(p, i * 4));
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width,
    height,
    // No "webgl2" support here, so convolveGLAvailable() is false and the
    // CPU non-separable path (the one under test) is exercised.
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
      if (!written) throw new Error("no output");
      return written;
    },
  };
};

const g = (v: number): Pixel => [v, v, v, 255];

describe("Convolve 2D (non-separable) CPU path clamps both edges", () => {
  it("replicates the right-edge pixel instead of wrapping into the next row", () => {
    // SHARPEN_3X3 = [[0,-1,0],[-1,5,-1],[0,-1,0]] samples the 4 orthogonal
    // neighbours of the rightmost column's out-of-bounds "right" tap.
    // Correctly clamped: right tap = centre itself (150) -> 5*150-(150+150+100+150)=200.
    // Buggy (unclamped): right tap wraps to flat index (x+kx-half)+W*(y+ky-half)
    // = (0,2) = 250 -> 5*150-(150+150+100+250)=100.
    const fixture = makeCanvas(3, 3, [
      g(0),
      g(0),
      g(150), // row 0
      g(0),
      g(100),
      g(150), // row 1 (test pixel is x=2,y=1)
      g(250),
      g(0),
      g(150), // row 2
    ]);

    convolve.func(fixture.canvas, {
      ...convolveDefaults,
      kernel: SHARPEN_3X3,
      strength: 1,
      _webglAcceleration: false,
    } as never);

    const out = fixture.output();
    const idx = (2 + 3 * 1) * 4; // pixel (x=2, y=1)
    expect(out[idx]).toBe(200); // clamp-to-edge behaviour
    expect(out[idx]).not.toBe(100); // would be the wrap-into-next-row bug's value
  });

  it("replicates the bottom-edge pixel instead of reading past the buffer as zero", () => {
    // Test pixel (x=1, y=2): down tap is out of bounds.
    // Correctly clamped: down tap = centre itself (80) -> 5*80-(60+80+40+50)=170.
    // Buggy (unclamped): down tap reads past the buffer end -> undefined||0 = 0
    // -> 5*80-(60+0+40+50)=250.
    const fixture = makeCanvas(3, 3, [
      g(0),
      g(0),
      g(0), // row 0
      g(0),
      g(60),
      g(0), // row 1 (up-neighbour of the test pixel)
      g(40),
      g(80),
      g(50), // row 2 (test pixel is x=1,y=2; left=40, right=50)
    ]);

    convolve.func(fixture.canvas, {
      ...convolveDefaults,
      kernel: SHARPEN_3X3,
      strength: 1,
      _webglAcceleration: false,
    } as never);

    const out = fixture.output();
    const idx = (1 + 3 * 2) * 4; // pixel (x=1, y=2)
    expect(out[idx]).toBe(170); // clamp-to-edge behaviour
    expect(out[idx]).not.toBe(250); // would be the out-of-buffer-read-as-zero bug's value
  });
});
