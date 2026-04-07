import { describe, it, expect } from "vitest";
import {
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  linearizeColorF,
  delinearizeColorF,
  paletteGetColor,
} from "utils";

describe("float linear conversion", () => {
  describe("srgbBufToLinearFloat", () => {
    it("converts sRGB 0 to linear 0.0", () => {
      const buf = new Uint8ClampedArray([0, 0, 0, 255]);
      const linear = srgbBufToLinearFloat(buf);
      expect(linear[0]).toBeCloseTo(0, 5);
      expect(linear[1]).toBeCloseTo(0, 5);
      expect(linear[2]).toBeCloseTo(0, 5);
      expect(linear[3]).toBeCloseTo(1, 5); // alpha normalized
    });

    it("converts sRGB 255 to linear 1.0", () => {
      const buf = new Uint8ClampedArray([255, 255, 255, 255]);
      const linear = srgbBufToLinearFloat(buf);
      expect(linear[0]).toBeCloseTo(1.0, 5);
      expect(linear[1]).toBeCloseTo(1.0, 5);
      expect(linear[2]).toBeCloseTo(1.0, 5);
    });

    it("converts sRGB 128 to linear ~0.216 (not 0.5)", () => {
      const buf = new Uint8ClampedArray([128, 128, 128, 255]);
      const linear = srgbBufToLinearFloat(buf);
      // sRGB 128 = ~21.6% linear light, NOT 50%
      expect(linear[0]).toBeCloseTo(0.216, 2);
      expect(linear[0]).toBeLessThan(0.25); // definitely not mid-gray
    });

    it("converts sRGB 188 to linear ~0.5 (perceptual midpoint)", () => {
      const buf = new Uint8ClampedArray([188, 188, 188, 255]);
      const linear = srgbBufToLinearFloat(buf);
      expect(linear[0]).toBeCloseTo(0.5, 1);
    });

    it("is monotonically increasing", () => {
      const buf = new Uint8ClampedArray(256 * 4);
      for (let i = 0; i < 256; i++) {
        buf[i * 4] = i;
        buf[i * 4 + 1] = i;
        buf[i * 4 + 2] = i;
        buf[i * 4 + 3] = 255;
      }
      const linear = srgbBufToLinearFloat(buf);
      for (let i = 1; i < 256; i++) {
        expect(linear[i * 4]).toBeGreaterThanOrEqual(linear[(i - 1) * 4]);
      }
    });
  });

  describe("linearFloatToSrgbBuf", () => {
    it("converts linear 0.0 to sRGB 0", () => {
      const floats = new Float32Array([0, 0, 0, 1]);
      const out = new Uint8ClampedArray(4);
      linearFloatToSrgbBuf(floats, out);
      expect(out[0]).toEqual(0);
      expect(out[3]).toEqual(255);
    });

    it("converts linear 1.0 to sRGB 255", () => {
      const floats = new Float32Array([1, 1, 1, 1]);
      const out = new Uint8ClampedArray(4);
      linearFloatToSrgbBuf(floats, out);
      expect(out[0]).toEqual(255);
    });

    it("converts linear 0.5 to sRGB ~188 (not 128)", () => {
      const floats = new Float32Array([0.5, 0.5, 0.5, 1]);
      const out = new Uint8ClampedArray(4);
      linearFloatToSrgbBuf(floats, out);
      expect(out[0]).toBeGreaterThan(180);
      expect(out[0]).toBeLessThan(195);
    });

    it("clamps out-of-range values", () => {
      const floats = new Float32Array([-0.1, 1.5, 0.5, 1]);
      const out = new Uint8ClampedArray(4);
      linearFloatToSrgbBuf(floats, out);
      expect(out[0]).toEqual(0);
      expect(out[1]).toEqual(255);
    });
  });

  describe("roundtrip: sRGB → linear float → sRGB", () => {
    it("roundtrips all 256 values with max ±1 error", () => {
      const buf = new Uint8ClampedArray(256 * 4);
      for (let i = 0; i < 256; i++) {
        buf[i * 4] = i;
        buf[i * 4 + 1] = i;
        buf[i * 4 + 2] = i;
        buf[i * 4 + 3] = 255;
      }
      const linear = srgbBufToLinearFloat(buf);
      const roundtripped = new Uint8ClampedArray(buf.length);
      linearFloatToSrgbBuf(linear, roundtripped);

      let maxError = 0;
      for (let i = 0; i < 256; i++) {
        const err = Math.abs(roundtripped[i * 4] - buf[i * 4]);
        maxError = Math.max(maxError, err);
      }
      // Float precision should give perfect or ±1 roundtrip
      expect(maxError).toBeLessThanOrEqual(1);
    });

    it("preserves endpoints exactly", () => {
      const buf = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
      const linear = srgbBufToLinearFloat(buf);
      const out = new Uint8ClampedArray(8);
      linearFloatToSrgbBuf(linear, out);
      expect(out[0]).toEqual(0);   // black exact
      expect(out[4]).toEqual(255); // white exact
    });
  });

  describe("linearizeColorF / delinearizeColorF", () => {
    it("roundtrips a color", () => {
      const srgb = [128, 64, 200, 255];
      const linear = linearizeColorF(srgb);
      const back = delinearizeColorF(linear);
      expect(Math.abs(back[0] - srgb[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(back[1] - srgb[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(back[2] - srgb[2])).toBeLessThanOrEqual(1);
    });

    it("linearizeColorF produces float 0-1 values", () => {
      const linear = linearizeColorF([255, 128, 0, 255]);
      expect(linear[0]).toBeCloseTo(1.0, 3);
      expect(linear[1]).toBeGreaterThan(0);
      expect(linear[1]).toBeLessThan(1);
      expect(linear[2]).toBeCloseTo(0, 5);
    });
  });
});

describe("paletteGetColor", () => {
  // Simple palette that returns the nearest of two colors
  const bwPalette = {
    getColor: (pixel) => {
      const lum = (pixel[0] + pixel[1] + pixel[2]) / 3;
      return lum > 127 ? [255, 255, 255, 255] : [0, 0, 0, 255];
    }
  };

  it("passes through when isLinear=false", () => {
    const result = paletteGetColor(bwPalette, [200, 200, 200, 255], {}, false);
    expect(result).toEqual([255, 255, 255, 255]);
  });

  it("when isLinear=true, delinearizes before matching", () => {
    // Linear 0.5 = sRGB ~188. Should match white since 188 > 127.
    const result = paletteGetColor(bwPalette, [0.5, 0.5, 0.5, 1.0], {}, true);
    // Result should be linearized white
    const linearWhite = linearizeColorF([255, 255, 255, 255]);
    expect(result[0]).toBeCloseTo(linearWhite[0], 3);
  });

  it("sRGB 0.2 linear matches black (sRGB ~118, below 127)", () => {
    const result = paletteGetColor(bwPalette, [0.2, 0.2, 0.2, 1.0], {}, true);
    // 0.2 linear = sRGB ~118, below 127 threshold → black
    const linearBlack = linearizeColorF([0, 0, 0, 255]);
    expect(result[0]).toBeCloseTo(linearBlack[0], 3);
  });

  it("returns linear-space result when isLinear=true", () => {
    // sRGB 200 → linear → match → the result should be in linear space
    const result = paletteGetColor(bwPalette, [0.6, 0.6, 0.6, 1.0], {}, true);
    // Should be linear white (1.0) not sRGB white (255)
    expect(result[0]).toBeCloseTo(1.0, 3);
  });
});

describe("error diffusion linearization correctness", () => {
  it("linear float midpoint averaging is brighter than sRGB", () => {
    // The core benefit: averaging in linear space produces a brighter
    // midpoint than in sRGB. avg(0, 1) = 0.5 linear = sRGB 188,
    // vs avg(0, 255) = 128 sRGB.
    const buf = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const linear = srgbBufToLinearFloat(buf);

    // Average in linear space
    const linearMid = (linear[0] + linear[4]) / 2; // ~0.5
    const out = new Uint8ClampedArray(4);
    linearFloatToSrgbBuf(new Float32Array([linearMid, linearMid, linearMid, 1]), out);
    const linearAvgSrgb = out[0]; // should be ~188

    // Average in sRGB space
    const srgbMid = (buf[0] + buf[4]) / 2; // = 128

    // Linear average should be significantly brighter
    expect(linearAvgSrgb).toBeGreaterThan(srgbMid + 40);
    expect(linearAvgSrgb).toBeGreaterThan(180);
    expect(linearAvgSrgb).toBeLessThan(195);
  });

  it("linear error diffusion distributes error in perceptual space", () => {
    // In linear space, equal numerical error = equal light energy change.
    // Error of 0.1 at brightness 0.2 vs 0.8 represents the same
    // absolute luminance change.
    const darkPixel = srgbBufToLinearFloat(new Uint8ClampedArray([50, 50, 50, 255]));
    const brightPixel = srgbBufToLinearFloat(new Uint8ClampedArray([200, 200, 200, 255]));

    const error = 0.05;
    const darkAdjusted = darkPixel[0] + error;
    const brightAdjusted = brightPixel[0] + error;

    // Convert back to sRGB to see the perceptual effect
    const darkOut = new Uint8ClampedArray(4);
    const darkOrigOut = new Uint8ClampedArray(4);
    const brightOut = new Uint8ClampedArray(4);
    const brightOrigOut = new Uint8ClampedArray(4);

    linearFloatToSrgbBuf(new Float32Array([darkAdjusted, 0, 0, 1]), darkOut);
    linearFloatToSrgbBuf(new Float32Array([darkPixel[0], 0, 0, 1]), darkOrigOut);
    linearFloatToSrgbBuf(new Float32Array([brightAdjusted, 0, 0, 1]), brightOut);
    linearFloatToSrgbBuf(new Float32Array([brightPixel[0], 0, 0, 1]), brightOrigOut);

    const darkSrgbDelta = darkOut[0] - darkOrigOut[0];
    const brightSrgbDelta = brightOut[0] - brightOrigOut[0];

    // In sRGB, the same linear error produces MORE sRGB steps in shadows
    // than highlights (gamma expansion). This is correct — shadows need
    // more precision.
    expect(darkSrgbDelta).toBeGreaterThan(brightSrgbDelta);
  });
});
