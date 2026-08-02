import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import dataBend, { defaults as dataBendDefaults } from "filters/dataBend";
import datamosh, { defaults as datamoshDefaults } from "filters/datamosh";
import analogStatic, { defaults as analogStaticDefaults } from "filters/analogStatic";
import nearest from "palettes/nearest";

const identityPalette = { ...nearest, options: { levels: 256 } };

const makeCanvas = (width: number, height: number, source: Uint8ClampedArray) => {
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
      if (!written) throw new Error("no output");
      return written;
    },
  };
};

const solid = (
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Uint8ClampedArray => {
  const b = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < b.length; i += 4) b.set(rgba, i);
  return b;
};

afterEach(() => vi.restoreAllMocks());

describe("Data Bend byte-stream echo", () => {
  it("darkens where the delayed sample is below the 128 midpoint (bipolar, not additive-only)", () => {
    // First half black (0), second half white (255). A white byte reads a
    // delayed black byte (0 - 128 < 0), so it must DARKEN — impossible for the
    // old additive-only echo.
    const w = 16,
      h = 1;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let x = 0; x < w; x++) {
      const v = x < w / 2 ? 0 : 255;
      src.set([v, v, v, 255], x * 4);
    }
    const fx = makeCanvas(w, h, src);
    dataBend.func(fx.canvas, {
      ...dataBendDefaults,
      effect: "ECHO",
      intensity: 0.6,
      offset: 20,
      palette: identityPalette,
    });
    const out = fx.output();
    const px8 = 8 * 4; // a white pixel whose echo source is in the black half
    expect(out[px8]).toBeLessThan(255);
  });

  it("preserves alpha and tolerates malformed options", () => {
    const fx = makeCanvas(8, 2, solid(8, 2, [120, 60, 200, 128]));
    expect(() =>
      dataBend.func(fx.canvas, {
        effect: "WRONG",
        intensity: Number.NaN,
        offset: null,
        palette: identityPalette,
      } as never),
    ).not.toThrow();
    const out = fx.output();
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(128);
  });
});

describe("Datamosh motion-compensated prediction", () => {
  const w = 32,
    h = 32;

  it("emits the clean current frame on a keyframe", () => {
    const cur = solid(w, h, [200, 30, 30, 255]);
    const fx = makeCanvas(w, h, cur);
    datamosh.func(fx.canvas, {
      ...datamoshDefaults,
      keyframeInterval: 24,
      palette: identityPalette,
      _frameIndex: 0, // 0 % 24 === 0 → keyframe
      _prevInput: solid(w, h, [0, 0, 255, 255]),
      _prevOutput: solid(w, h, [0, 0, 255, 255]),
    } as never);
    const out = fx.output();
    expect([out[0], out[1], out[2]]).toEqual([200, 30, 30]);
  });

  it("predicts a moshed frame from the previous OUTPUT, not the current input", () => {
    // No inter-frame motion (prevInput == current), so vectors are zero and the
    // predicted frame is exactly the previous output (blue) — proving it draws
    // from the reference buffer, not the current red input.
    const cur = solid(w, h, [200, 30, 30, 255]);
    const fx = makeCanvas(w, h, cur);
    datamosh.func(fx.canvas, {
      ...datamoshDefaults,
      keyframeInterval: 24,
      corruptChance: 0,
      channelShift: 0,
      palette: identityPalette,
      _frameIndex: 1, // 1 % 24 !== 0 → mosh
      _prevInput: solid(w, h, [200, 30, 30, 255]),
      _prevOutput: solid(w, h, [0, 0, 255, 255]),
    } as never);
    const out = fx.output();
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 255]);
  });

  it("falls back to a clean frame with no reference frames and preserves alpha", () => {
    const cur = solid(w, h, [111, 122, 133, 96]);
    const fx = makeCanvas(w, h, cur);
    datamosh.func(fx.canvas, {
      ...datamoshDefaults,
      palette: identityPalette,
      _frameIndex: 3,
    } as never);
    const out = fx.output();
    expect([out[0], out[1], out[2]]).toEqual([111, 122, 133]);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(96);
  });
});

describe("Analog Static persistence stays on-palette (CPU)", () => {
  it("blends the previous frame before quantization so a reduced palette is not broken", () => {
    // persistence blended AFTER the palette would emit interpolated colours
    // outside a 2-level palette (e.g. 100 from 0 and 200). Blending before the
    // palette keeps every channel on {0,255}.
    const levels2 = { ...nearest, options: { levels: 2 } };
    const fx = makeCanvas(8, 8, solid(8, 8, [100, 100, 100, 255]));
    analogStatic.func(fx.canvas, {
      ...analogStaticDefaults,
      noiseAmount: 0,
      barIntensity: 0,
      ghosting: 0,
      verticalHold: 0,
      persistence: 0.5,
      palette: levels2,
      _webglAcceleration: false,
      _prevOutput: solid(8, 8, [200, 200, 200, 255]),
    } as never);
    const out = fx.output();
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) expect([0, 255]).toContain(out[i + c]);
    }
  });
});
