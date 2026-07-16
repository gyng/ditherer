import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import ditherGradient, { defaults } from "filters/ditherGradient";
import nearest from "palettes/nearest";

// ditherGradient.test.ts asserts only `expect(A).not.toEqual(B)` twice — that a
// dark input differs from a bright one, and PRINT differs from DREAMY. That
// proves the filter reads its input and reads its style option, and nothing
// else: any gradient-mapping or angle bug survives it.
//
// The filter's actual contract is a gradient mapped through the source and then
// ordered-dithered. Turn the dither off (amount 0) and the source influence down
// and the gradient itself becomes observable, so the geometry can be asserted
// directly.

const W = 16;
const H = 16;

const makeCanvas = (fill: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b] = fill(x, y);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
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

const flat = (): [number, number, number] => [128, 128, 128];

const run = (over: Record<string, unknown> = {}, fill = flat) => {
  const { canvas, written } = makeCanvas(fill);
  ditherGradient.func(canvas, { ...defaults, ...over } as any);
  const out = written();
  if (!out) throw new Error("no output written");
  return out;
};

const at = (buf: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * W + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2]];
};

// Isolate the gradient: no dither perturbation, no source remapping, and an
// identity palette (levels >= 256 passes colors through untouched).
const rawGradient = {
  amount: 0,
  sourceInfluence: 0,
  detailInfluence: 0,
  palette: { ...nearest, options: { levels: 256 } },
};

describe("Dither Gradient — gradient geometry", () => {
  it("runs along the configured axis at angle 0", () => {
    // A horizontal gradient over a flat source must vary across x and stay
    // constant down y. An angle applied to the wrong axis, or swapped sin/cos,
    // breaks exactly this.
    const out = run({ ...rawGradient, angle: 0 });
    for (let x = 0; x < W; x++) {
      const top = at(out, x, 0);
      for (let y = 1; y < H; y++) {
        expect(at(out, x, y), `column ${x} is not constant`).toEqual(top);
      }
    }
    expect(at(out, 0, 0)).not.toEqual(at(out, W - 1, 0));
  });

  it("runs along the other axis at angle 90", () => {
    const out = run({ ...rawGradient, angle: 90 });
    for (let y = 0; y < H; y++) {
      const left = at(out, 0, y);
      for (let x = 1; x < W; x++) {
        expect(at(out, x, y), `row ${y} is not constant`).toEqual(left);
      }
    }
    expect(at(out, 0, 0)).not.toEqual(at(out, 0, H - 1));
  });

  it("reaches its configured endpoint colors", () => {
    // The ramp must actually terminate at color1 and color2 rather than at some
    // rescaled version of them.
    const color1 = [255, 0, 0];
    const color2 = [0, 0, 255];
    const out = run({ ...rawGradient, angle: 0, color1, color2 });
    const start = at(out, 0, 0);
    const end = at(out, W - 1, 0);
    const near = (a: number[], b: number[]) =>
      Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    // Endpoints land closest to their own colors — and not swapped.
    expect(near(start, color1)).toBeLessThan(near(start, color2));
    expect(near(end, color2)).toBeLessThan(near(end, color1));
  });

  it("swapping the endpoint colors reverses the ramp", () => {
    const a = run({ ...rawGradient, angle: 0, color1: [255, 0, 0], color2: [0, 0, 255] });
    const b = run({ ...rawGradient, angle: 0, color1: [0, 0, 255], color2: [255, 0, 0] });
    // Left of one should match right of the other, give or take rounding.
    expect(at(a, 0, 0)[0]).toBeGreaterThan(at(a, W - 1, 0)[0]);
    expect(at(b, 0, 0)[0]).toBeLessThan(at(b, W - 1, 0)[0]);
  });

  it("is monotonic along its axis", () => {
    // A gradient that doubles back means the projection is wrong.
    const out = run({ ...rawGradient, angle: 0, color1: [0, 0, 0], color2: [255, 255, 255] });
    for (let x = 1; x < W; x++) {
      expect(at(out, x, 0)[0]).toBeGreaterThanOrEqual(at(out, x - 1, 0)[0]);
    }
  });
});

describe("Dither Gradient — dithering and palette", () => {
  it("quantizes to the palette", () => {
    // Default palette is nearest levels=2, so the finished image must be 1-bit
    // per channel. If it isn't, the palette pass isn't running.
    const out = run({}, (x, y) => [x * 16, y * 16, 128]);
    const values = new Set<number>();
    for (let i = 0; i < out.length; i += 4) {
      values.add(out[i]); values.add(out[i + 1]); values.add(out[i + 2]);
    }
    expect([...values].every((v) => v === 0 || v === 255)).toBe(true);
  });

  it("the dither amount actually perturbs the result", () => {
    // amount is what turns a flat band into a pattern; at 0 a flat source must
    // stay flat, and above 0 it must not.
    const off = run({ amount: 0, sourceInfluence: 0, detailInfluence: 0 });
    const on = run({ amount: 1, sourceInfluence: 0, detailInfluence: 0 });
    const distinct = (b: Uint8ClampedArray) => {
      const s = new Set<string>();
      for (let i = 0; i < b.length; i += 4) s.add(`${b[i]},${b[i + 1]},${b[i + 2]}`);
      return s.size;
    };
    expect(distinct(on)).toBeGreaterThan(distinct(off));
  });

  it("responds to source luminance", () => {
    // sourceInfluence remaps the gradient by source luma; with it off, two
    // different flat sources must map identically, and with it on they must not.
    const darkOff = run({ ...rawGradient }, () => [20, 20, 20]);
    const brightOff = run({ ...rawGradient }, () => [230, 230, 230]);
    expect(Array.from(darkOff)).toEqual(Array.from(brightOff));

    const darkOn = run({ ...rawGradient, sourceInfluence: 1 }, () => [20, 20, 20]);
    const brightOn = run({ ...rawGradient, sourceInfluence: 1 }, () => [230, 230, 230]);
    expect(Array.from(darkOn)).not.toEqual(Array.from(brightOn));
  });

  it("is deterministic", () => {
    expect(Array.from(run())).toEqual(Array.from(run()));
  });
});
