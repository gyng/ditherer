import { describe, expect, it } from "vitest";
import {
  APPLE_HGR_COLORS,
  decodeAppleHgrDots,
  decodeHam6Scanline,
  encodeHam6Scanline,
  HAM6_OP,
  pxlTiming,
  spectrumFlashPhase,
  spectrumColor,
  chooseSpectrumAttribute,
} from "filters/retroHardwareCodecs";
import { buildHam6Palette } from "filters/amigaHam6";
import { filterIndex, filterList } from "filters/index";

describe("Apple II HGR display contract", () => {
  it("decodes clear, adjacent, and isolated dots using byte phase", () => {
    const bits = Uint8Array.from([
      0, // clear -> black
      1, 1, // adjacent set dots -> white
      0,
      1, // isolated even -> purple in phase 0
      0,
      0,
      0,
      1, // isolated even -> blue in phase 1 (second seven-dot byte)
      0,
      1, // isolated even -> blue
      0,
      0,
      0,
    ]);
    const decoded = decodeAppleHgrDots(bits, Uint8Array.from([0, 1]));
    const at = (x: number) => Array.from(decoded.slice(x * 3, x * 3 + 3));
    expect(at(0)).toEqual(APPLE_HGR_COLORS.black);
    expect(at(1)).toEqual(APPLE_HGR_COLORS.white);
    expect(at(2)).toEqual(APPLE_HGR_COLORS.white);
    expect(at(4)).toEqual(APPLE_HGR_COLORS.purple);
    expect(at(8)).toEqual(APPLE_HGR_COLORS.blue);
    expect(at(10)).toEqual(APPLE_HGR_COLORS.blue);
  });

  it("uses complementary colors on odd isolated columns", () => {
    const phase0 = decodeAppleHgrDots(Uint8Array.from([0, 1, 0]), Uint8Array.from([0]));
    const phase1 = decodeAppleHgrDots(Uint8Array.from([0, 1, 0]), Uint8Array.from([1]));
    expect(Array.from(phase0.slice(3, 6))).toEqual(APPLE_HGR_COLORS.green);
    expect(Array.from(phase1.slice(3, 6))).toEqual(APPLE_HGR_COLORS.orange);
  });
});

describe("ZX Spectrum attribute cells", () => {
  it("chooses one brightness bank and at most two colors for all 64 dots", () => {
    const red = spectrumColor(2, false);
    const blue = spectrumColor(1, false);
    const source = new Uint8Array(64 * 3);
    for (let pixel = 0; pixel < 64; pixel++) {
      source.set(pixel < 32 ? red : blue, pixel * 3);
    }
    const attribute = chooseSpectrumAttribute(source);
    expect(new Set([attribute.ink, attribute.paper])).toEqual(new Set([1, 2]));
    expect(attribute.bright).toBe(false);
    expect(attribute.bitmap).toHaveLength(64);
    expect(new Set(attribute.bitmap)).toEqual(new Set([0, 1]));
  });

  it("selects the bright bank for saturated source colors", () => {
    const source = new Uint8Array(64 * 3);
    for (let pixel = 0; pixel < 64; pixel++) {
      source.set(pixel % 2 === 0 ? [255, 255, 0] : [0, 255, 255], pixel * 3);
    }
    expect(chooseSpectrumAttribute(source).bright).toBe(true);
  });

  it("swaps FLASH ink and paper every 16 hardware frames", () => {
    expect(Array.from({ length: 33 }, (_, frame) => spectrumFlashPhase(frame, 50)))
      .toEqual([
        ...new Array(16).fill(0),
        ...new Array(16).fill(1),
        0,
      ]);
    expect(spectrumFlashPhase(Number.POSITIVE_INFINITY, Number.NaN)).toBe(0);
  });
});

describe("Amiga OCS HAM6", () => {
  const palette = Uint8Array.from([
    0, 0, 0, 255,
    17, 34, 51, 255,
    ...new Array(14 * 4).fill(0),
  ]);

  it("decodes the documented direct, blue, red, and green opcodes", () => {
    const codes = Uint8Array.from([
      (HAM6_OP.DIRECT << 4) | 1,
      (HAM6_OP.BLUE << 4) | 15,
      (HAM6_OP.RED << 4) | 8,
      (HAM6_OP.GREEN << 4) | 4,
    ]);
    const output = decodeHam6Scanline(codes, palette);
    expect(Array.from(output)).toEqual([
      17, 34, 51, 255,
      17, 34, 255, 255,
      136, 34, 255, 255,
      136, 68, 255, 255,
    ]);
  });

  it("encodes to legal opcodes and reconstructs only 4-bit component levels", () => {
    const source = Uint8Array.from([
      18, 35, 52,
      19, 35, 250,
      132, 36, 249,
      130, 70, 247,
    ]);
    const encoded = encodeHam6Scanline(source, palette);
    expect(encoded.codes).toHaveLength(4);
    expect(decodeHam6Scanline(encoded.codes, palette)).toEqual(encoded.output);
    for (let index = 0; index < encoded.output.length; index += 4) {
      expect(encoded.output[index] % 17).toBe(0);
      expect(encoded.output[index + 1] % 17).toBe(0);
      expect(encoded.output[index + 2] % 17).toBe(0);
      expect(encoded.output[index + 3]).toBe(255);
    }
  });

  it("builds sixteen deterministic 12-bit OCS color registers", () => {
    const source = new Uint8ClampedArray(64 * 4);
    for (let pixel = 0; pixel < 64; pixel++) {
      source.set([pixel * 4, 255 - pixel * 4, pixel % 2 ? 220 : 20, 255], pixel * 4);
    }
    const first = buildHam6Palette(source, 4);
    expect(first).toHaveLength(16 * 4);
    expect(buildHam6Palette(source, 4)).toEqual(first);
    for (let offset = 0; offset < first.length; offset += 4) {
      expect(first[offset] % 17).toBe(0);
      expect(first[offset + 1] % 17).toBe(0);
      expect(first[offset + 2] % 17).toBe(0);
      expect(first[offset + 3]).toBe(255);
    }
  });
});

describe("PXL-2000 ping-pong timing", () => {
  it("holds each 15 Hz CCD capture for two frames at a 30 fps preview", () => {
    const sequence = Array.from({ length: 8 }, (_, frame) => pxlTiming(frame, 30));
    expect(sequence.map((entry) => entry.captureIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(sequence.map((entry) => entry.newCapture)).toEqual([true, false, true, false, true, false, true, false]);
  });

  it("retains the exact rational capture cadence at non-multiple preview rates", () => {
    const sequence = Array.from({ length: 8 }, (_, frame) => pxlTiming(frame, 24));
    expect(sequence.map((entry) => entry.captureIndex)).toEqual([0, 0, 1, 1, 2, 3, 3, 4]);
    expect(pxlTiming(Number.NaN, Number.NaN)).toEqual({ captureIndex: 0, newCapture: true });
  });
});

describe("hardware simulation registry", () => {
  it.each(["Apple II HGR", "ZX Spectrum", "Amiga HAM6", "PXL-2000"])(
    "registers %s for catalog and worker resolution",
    (name) => {
      const entry = filterList.find((candidate) => candidate.displayName === name);
      expect(entry?.category).toBe("Simulate");
      expect(entry?.filter.name).toBe(name);
      expect(filterIndex[name]).toBe(entry?.filter);
    },
  );
});
