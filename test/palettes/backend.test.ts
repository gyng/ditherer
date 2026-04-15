import { describe, expect, it, beforeAll } from "vitest";
import { wasmReady } from "utils";
import nearest from "palettes/nearest";
import user from "palettes/user";
import {
  applyPaletteToBuffer,
  buildNearestLUT,
  paletteIsIdentity,
} from "palettes/backend";

beforeAll(async () => {
  await wasmReady;
});

describe("palettes/backend paletteIsIdentity", () => {
  it("treats levels>=256 with no colors as identity", () => {
    expect(paletteIsIdentity({ options: { levels: 256 } })).toBe(true);
    expect(paletteIsIdentity({ options: { levels: 512 } })).toBe(true);
    expect(paletteIsIdentity(undefined)).toBe(true);
  });

  it("flags non-identity when levels quantize", () => {
    expect(paletteIsIdentity({ options: { levels: 2 } })).toBe(false);
    expect(paletteIsIdentity({ options: { levels: 8 } })).toBe(false);
  });

  it("flags non-identity when a color table is present", () => {
    expect(paletteIsIdentity({ options: { levels: 256, colors: [[0, 0, 0]] } })).toBe(false);
  });
});

describe("palettes/backend buildNearestLUT", () => {
  it("is the identity at levels=256", () => {
    const lut = buildNearestLUT(256);
    for (let i = 0; i < 256; i += 1) expect(lut[i]).toBe(i);
  });

  it("maps everything below 128 to 0 and ≥128 to 255 at levels=2", () => {
    const lut = buildNearestLUT(2);
    expect(lut[0]).toBe(0);
    expect(lut[127]).toBe(0);
    expect(lut[128]).toBe(255);
    expect(lut[255]).toBe(255);
  });

  it("matches the reference nearest.getColor across all input values", () => {
    for (const levels of [2, 3, 4, 8, 16, 64, 255]) {
      const lut = buildNearestLUT(levels);
      for (let i = 0; i < 256; i += 1) {
        const ref = nearest.getColor([i, i, i, 255], { levels });
        // All three channels must match the LUT; reference returns same per-channel.
        expect(lut[i]).toBe(ref[0]);
        expect(lut[i]).toBe(ref[1]);
        expect(lut[i]).toBe(ref[2]);
      }
    }
  });
});

describe("palettes/backend applyPaletteToBuffer", () => {
  const mkBuf = (w: number, h: number): Uint8ClampedArray => {
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < buf.length; i += 4) {
      const px = i / 4;
      buf[i] = px & 0xff;
      buf[i + 1] = (px * 7) & 0xff;
      buf[i + 2] = (px * 13) & 0xff;
      buf[i + 3] = 255;
    }
    return buf;
  };

  it("is a no-op for identity palette", () => {
    const input = mkBuf(4, 4);
    const output = new Uint8ClampedArray(input.length);
    applyPaletteToBuffer(input, output, 4, 4, { options: { levels: 256 } }, true);
    expect(Array.from(output)).toEqual(Array.from(input));
  });

  it("matches nearest.getColor bit-exactly via WASM LUT path", () => {
    const input = mkBuf(8, 8);
    const output = new Uint8ClampedArray(input.length);
    const palette = { ...nearest, options: { levels: 4 } };
    applyPaletteToBuffer(input, output, 8, 8, palette, true);
    for (let i = 0; i < input.length; i += 4) {
      const ref = nearest.getColor(
        [input[i], input[i + 1], input[i + 2], input[i + 3]],
        { levels: 4 },
      );
      expect(output[i]).toBe(ref[0]);
      expect(output[i + 1]).toBe(ref[1]);
      expect(output[i + 2]).toBe(ref[2]);
      expect(output[i + 3]).toBe(255);
    }
  });

  it("matches nearest.getColor bit-exactly via JS fallback path", () => {
    const input = mkBuf(8, 8);
    const output = new Uint8ClampedArray(input.length);
    const palette = { ...nearest, options: { levels: 8 } };
    applyPaletteToBuffer(input, output, 8, 8, palette, /* wasmAcceleration */ false);
    for (let i = 0; i < input.length; i += 4) {
      const ref = nearest.getColor(
        [input[i], input[i + 1], input[i + 2], input[i + 3]],
        { levels: 8 },
      );
      expect(output[i]).toBe(ref[0]);
      expect(output[i + 1]).toBe(ref[1]);
      expect(output[i + 2]).toBe(ref[2]);
    }
  });

  it("supports in-place application", () => {
    const buf = mkBuf(4, 4);
    const expected = new Uint8ClampedArray(buf);
    applyPaletteToBuffer(expected, expected, 4, 4, { ...nearest, options: { levels: 2 } }, false);
    const inplace = mkBuf(4, 4);
    applyPaletteToBuffer(inplace, inplace, 4, 4, { ...nearest, options: { levels: 2 } }, true);
    expect(Array.from(inplace)).toEqual(Array.from(expected));
  });

  it("falls back to the JS per-pixel loop for color-distance palettes (User/Adaptive)", () => {
    const colors = [[0, 0, 0], [255, 255, 255], [255, 0, 0]];
    const input = mkBuf(4, 4);
    const output = new Uint8ClampedArray(input.length);
    const palette = { ...user, options: { colors, colorDistanceAlgorithm: "EUCLIDEAN_RGB" } };
    applyPaletteToBuffer(input, output, 4, 4, palette, false);
    // Every output pixel must be one of the three palette colors.
    const allowed = new Set(colors.map((c) => `${c[0]},${c[1]},${c[2]}`));
    for (let i = 0; i < output.length; i += 4) {
      expect(allowed.has(`${output[i]},${output[i + 1]},${output[i + 2]}`)).toBe(true);
    }
  });
});
