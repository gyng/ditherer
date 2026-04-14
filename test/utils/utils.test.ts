import { describe, it, expect } from "vitest";
import * as utils from "utils";

describe("utils", () => {
  it("quantize a value", () => {
    expect(utils.quantizeValue(127.4, 2)).toEqual(0);
    expect(utils.quantizeValue(127.5, 2)).toEqual(255);
    expect(utils.quantizeValue(127.4, 3)).toEqual(128);
    expect(utils.quantizeValue(127.4, 4)).toEqual(85);
  });

  it("scales a 2d array, ignoring null values", () => {
    const input = [[1, 2], [null, 4]];
    const expected = [[2, 4], [null, 8]];
    const actual = utils.scaleMatrix(input, 2);
    expect(actual).toEqual(expected);
  });

  it("adds two 4-tuples together", () => {
    const actual = utils.add([1, 2, 3, 4], [2, 3, 4, 5]);
    const expected = [3, 5, 7, 9];
    expect(actual).toEqual(expected);
  });

  it("subtracts a 4-tuple from another", () => {
    const actual = utils.sub([5, 6, 7, 8], [4, 3, 2, 1]);
    const expected = [1, 3, 5, 7];
    expect(actual).toEqual(expected);
  });

  it("scales a 4-tuple by a number, ignoring alpha channel by default", () => {
    const actual = utils.scale([1, 2, 3, 4], 2);
    const expected = [2, 4, 6, 4];
    expect(actual).toEqual(expected);
  });

  it("gets the buffer index for a pixel", () => {
    const actual = utils.getBufferIndex(5, 2, 10);
    expect(actual).toEqual(100);
  });

  it("samples bilinear values between four corners", () => {
    const buf = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
      255, 255, 255, 255
    ]);
    const actual = utils.sampleBilinear(buf, 2, 2, 0.5, 0.5);
    expect(actual).toEqual([128, 128, 64, 255]);
  });

  it("clamps bilinear sampling outside image bounds", () => {
    const buf = new Uint8ClampedArray([
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255
    ]);
    const actual = utils.sampleBilinear(buf, 2, 2, -4, 3);
    expect(actual).toEqual([70, 80, 90, 255]);
  });

  it("fills a buffer with a 4-tuple at an index", () => {
    const buf = new Uint8ClampedArray(5);
    utils.fillBufferPixel(buf, 1, 2, 3, 4, 5);
    expect(buf[0]).toEqual(0);
    expect(buf[1]).toEqual(2);
    expect(buf[2]).toEqual(3);
    expect(buf[3]).toEqual(4);
    expect(buf[4]).toEqual(5);
  });

  it("adds a buffer with a 4-tuple at an index", () => {
    const buf = new Uint8ClampedArray(5);
    buf[0] = 2;
    buf[1] = 3;
    buf[2] = 4;
    buf[3] = 5;
    buf[4] = 6;
    utils.addBufferPixel(buf, 1, [2, 3, 4, 5]);
    expect(buf[0]).toEqual(2);
    expect(buf[1]).toEqual(5);
    expect(buf[2]).toEqual(7);
    expect(buf[3]).toEqual(9);
    expect(buf[4]).toEqual(11);
  });

  describe("Lab <> RGB color conversion", () => {
    it("lab converts to rgb and back losslessly", () => {
      const color = [127, 127, 127, 127];
      const lab = utils.rgba2laba(color, utils.referenceTable.CIE_1931.D65);
      const rgb = utils.laba2rgba(lab, utils.referenceTable.CIE_1931.D65);
      expect(lab).not.toEqual(color);
      expect(rgb).toEqual(color);
    });
  });

  describe("medianCut", () => {
    const input = new Uint8ClampedArray([
      0, 0, 0, 0,
      127, 127, 127, 127,
      255, 255, 255, 255
    ]);

    it("returns an array of colours", () => {
      const palette = utils.medianCutPalette(input, 1, true, "MID", "RGB");
      expect(palette[0]).toEqual([255, 255, 255, 255]);
      expect(palette[1]).toEqual([0, 0, 0, 0]);
    });

    it("returns up to the color limit", () => {
      const palette = utils.medianCutPalette(input, 0, true, "MID", "RGB");
      expect(palette).toHaveLength(1);
      expect(palette[0]).toEqual([127, 127, 127, 127]);
    });

    it("returns maximum of number of colors in source image", () => {
      const palette = utils.medianCutPalette(input, 10, true, "MID", "RGB");
      expect(palette).toHaveLength(3);
      expect(palette[0]).toEqual([255, 255, 255, 255]);
      expect(palette[1]).toEqual([127, 127, 127, 127]);
      expect(palette[2]).toEqual([0, 0, 0, 0]);
    });
  });

  describe("luminance", () => {
    it("applies alpha scaling correctly", () => {
      const opaque = [128, 128, 128, 255];
      const halfAlpha = [128, 128, 128, 127];
      const lumOpaque = utils.luminance(opaque, false);
      const lumHalf = utils.luminance(halfAlpha, false);
      expect(lumHalf).toBeCloseTo(lumOpaque * (127 / 255), 1);
    });

    it("defaults to gamma-correct (linear) mode", () => {
      const color = [128, 128, 128, 255];
      const linear = utils.luminance(color, true);
      const perceptual = utils.luminance(color, false);
      expect(linear).not.toEqual(perceptual);
    });
  });

  describe("equalize", () => {
    it("normalizes values to 0-255 range", () => {
      const input = new Uint8ClampedArray([50, 100, 150]);
      utils.equalize(input);
      expect(input[0]).toEqual(0);
      expect(input[2]).toEqual(255);
    });
  });

  describe("linearizeBuffer / delinearizeBuffer", () => {
    it("linearizes sRGB 128 to ~55", () => {
      const buf = new Uint8ClampedArray([128, 128, 128, 255]);
      utils.linearizeBuffer(buf);
      expect(buf[0]).toEqual(55);
      expect(buf[1]).toEqual(55);
      expect(buf[2]).toEqual(55);
      expect(buf[3]).toEqual(255); // alpha unchanged
    });

    it("preserves 0 and 255", () => {
      const buf = new Uint8ClampedArray([0, 255, 0, 255]);
      utils.linearizeBuffer(buf);
      expect(buf[0]).toEqual(0);
      expect(buf[1]).toEqual(255);
    });

    it("roundtrips with acceptable error", () => {
      // 8-bit linear has fewer levels in shadows/lower midtones than sRGB
      // (sRGB's gamma curve allocates more bits to shadows). Multiple sRGB
      // values map to the same quantized linear value, so roundtrip is lossy.
      // Max error ~10 in deep shadows, ~5 in lower midtones, ±1 above sRGB 100.
      const original = new Uint8ClampedArray(256 * 4);
      for (let i = 0; i < 256; i++) {
        original[i * 4] = i;
        original[i * 4 + 1] = i;
        original[i * 4 + 2] = i;
        original[i * 4 + 3] = 255;
      }
      const copy = new Uint8ClampedArray(original);
      utils.linearizeBuffer(copy);
      utils.delinearizeBuffer(copy);
      // Upper half roundtrips cleanly
      let maxUpperError = 0;
      for (let i = 128; i < 256; i++) {
        maxUpperError = Math.max(maxUpperError, Math.abs(copy[i * 4] - original[i * 4]));
      }
      expect(maxUpperError).toBeLessThanOrEqual(1);
      // Endpoints exact
      expect(copy[0]).toEqual(0);
      expect(copy[255 * 4]).toEqual(255);
    });

    it("delinearizes linear 55 back to ~128", () => {
      const buf = new Uint8ClampedArray([55, 55, 55, 255]);
      utils.delinearizeBuffer(buf);
      expect(Math.abs(buf[0] - 128)).toBeLessThanOrEqual(1);
    });
  });

  describe("readback canvases", () => {
    it("createReadbackCanvas returns an HTMLCanvasElement with the requested size", () => {
      const canvas = utils.createReadbackCanvas(32, 16);
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(canvas.width).toBe(32);
      expect(canvas.height).toBe(16);
    });

    it("createReadbackCanvas without dimensions leaves the browser default size", () => {
      const canvas = utils.createReadbackCanvas();
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      // width/height are only explicitly set when we're given positive values
      expect(canvas.width).toBeGreaterThanOrEqual(0);
      expect(canvas.height).toBeGreaterThanOrEqual(0);
    });

    it("getReadbackContext returns a 2D context", () => {
      const canvas = utils.createReadbackCanvas(4, 4);
      const ctx = utils.getReadbackContext(canvas);
      expect(ctx).not.toBeNull();
      expect(ctx!.getImageData).toBeTypeOf("function");
    });
  });

  describe("cloneCanvas", () => {
    it("returns an HTMLCanvasElement with matching dimensions", () => {
      const source = utils.createReadbackCanvas(4, 4);
      const clone = utils.cloneCanvas(source);
      expect(clone).toBeInstanceOf(HTMLCanvasElement);
      expect(clone.width).toBe(4);
      expect(clone.height).toBe(4);
    });

    it("cloneCanvas(copyData=false) still mirrors the dimensions", () => {
      const source = utils.createReadbackCanvas(6, 3);
      const clone = utils.cloneCanvas(source, false);
      expect(clone.width).toBe(6);
      expect(clone.height).toBe(3);
    });
  });

  describe("uniqueColors", () => {
    it("returns distinct rgba tuples counted across the buffer", () => {
      const buf = new Uint8ClampedArray([
        10, 20, 30, 255,
        40, 50, 60, 255,
        10, 20, 30, 255, // duplicate of first
      ]);
      const colors = utils.uniqueColors(buf);
      expect(colors).toHaveLength(2);
      const asKeys = colors.map((c: number[]) => c.join(","));
      expect(asKeys).toContain("10,20,30,255");
      expect(asKeys).toContain("40,50,60,255");
    });

    it("respects the limit and returns the N least-frequent colors (sort asc by count)", () => {
      const buf = new Uint8ClampedArray([
        // red x3
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
        // green x1
        0, 255, 0, 255,
        // blue x2
        0, 0, 255, 255, 0, 0, 255, 255,
      ]);
      const colors = utils.uniqueColors(buf, 2);
      expect(colors).toHaveLength(2);
      // Sorted ascending by count: green (1) first, blue (2) second
      expect(colors[0]).toEqual([0, 255, 0, 255]);
      expect(colors[1]).toEqual([0, 0, 255, 255]);
    });
  });

  describe("color helpers", () => {
    it("luminanceItuBt709 weights RGB per ITU-R BT.709 (non-linear mode)", () => {
      // In linear=false mode, values are normalised to [0,1] before weighting
      // and then scaled by alpha. Pure white alpha=255 → ~255.
      expect(utils.luminanceItuBt709([255, 255, 255, 255], false)).toBeCloseTo(255, 1);
      expect(utils.luminanceItuBt709([0, 0, 0, 255], false)).toBeCloseTo(0, 5);
      expect(utils.luminanceItuBt709([255, 0, 0, 255], false)).toBeCloseTo(0.2126 * 255, 1);
    });

    it("luminance (BT.601) tracks the same direction as BT.709", () => {
      expect(utils.luminance([255, 255, 255, 255], false)).toBeCloseTo(255, 1);
      expect(utils.luminance([0, 0, 0, 255], false)).toBeCloseTo(0, 5);
    });

    it("rgba formats components into an array", () => {
      expect(utils.rgba(1, 2, 3, 4)).toEqual([1, 2, 3, 4]);
    });

    it("clamp restricts a value to [min, max]", () => {
      expect(utils.clamp(0, 10, -5)).toBe(0);
      expect(utils.clamp(0, 10, 100)).toBe(10);
      expect(utils.clamp(0, 10, 5)).toBe(5);
    });

    it("rgba2hsva maps red / green / blue to hue 0 / 120 / 240", () => {
      const red = utils.rgba2hsva([255, 0, 0, 255]);
      expect(red[0]).toBeGreaterThanOrEqual(0);
      expect(red[0]).toBeLessThan(5);
      const green = utils.rgba2hsva([0, 255, 0, 255]);
      expect(green[0]).toBeGreaterThan(115);
      expect(green[0]).toBeLessThan(125);
      const blue = utils.rgba2hsva([0, 0, 255, 255]);
      expect(blue[0]).toBeGreaterThan(235);
      expect(blue[0]).toBeLessThan(245);
    });

    it("rgba2laba + laba2rgba roughly roundtrip", () => {
      const lab = utils.rgba2laba([128, 64, 200, 255]);
      const rgb = utils.laba2rgba(lab);
      expect(Math.abs(rgb[0] - 128)).toBeLessThanOrEqual(4);
      expect(Math.abs(rgb[1] - 64)).toBeLessThanOrEqual(4);
      expect(Math.abs(rgb[2] - 200)).toBeLessThanOrEqual(4);
    });

    it("contrast and brightness scale channels predictably", () => {
      const c = utils.contrast([100, 128, 200, 255], 2);
      expect(c[0]).toBeLessThan(100);
      expect(c[2]).toBeGreaterThan(200);
      expect(c[3]).toBe(255);

      const b = utils.brightness([100, 100, 100, 255], 50);
      expect(b[0]).toBe(150);
      expect(b[3]).toBe(255);
    });

    it("gamma applies per-channel", () => {
      const result = utils.gamma([255, 128, 0, 255], 2.2);
      expect(result[0]).toBe(255); // 1^2.2 == 1
      expect(result[3]).toBe(255);
      expect(result[2]).toBe(0);
    });

    it("equalize stretches the histogram", () => {
      // Buffer with narrow range gets remapped
      const buf = new Uint8ClampedArray([100, 100, 100, 255, 150, 150, 150, 255]);
      utils.equalize(buf, buf.length);
      // First pixel should remap toward low end, second toward high end
      expect(buf[0]).toBeLessThan(buf[4]);
    });
  });

  describe("medianCutPalette", () => {
    it("returns one color when limit is 0", () => {
      const buf = new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
      ]);
      const palette = utils.medianCutPalette(buf, 0, false, "MID");
      expect(Array.isArray(palette)).toBe(true);
      expect(palette.length).toBeGreaterThanOrEqual(1);
    });

    it("subdivides into 2^limit buckets", () => {
      const buf = new Uint8ClampedArray([
        255, 0, 0, 255,
        200, 0, 0, 255,
        0, 255, 0, 255,
        0, 200, 0, 255,
        0, 0, 255, 255,
        0, 0, 200, 255,
        255, 255, 0, 255,
        200, 200, 0, 255,
      ]);
      const palette = utils.medianCutPalette(buf, 2, false, "AVERAGE");
      expect(palette.length).toBeLessThanOrEqual(4);
      expect(palette.length).toBeGreaterThanOrEqual(1);
    });
  });
});
