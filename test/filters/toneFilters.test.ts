import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import dodgeBurn, { defaults as dodgeBurnDefaults } from "filters/dodgeBurn";
import { linearExposure } from "../../packages/ditherer-filters/src/filters/toneTransferContracts";
import nearest from "palettes/nearest";

const identityPalette = { ...nearest, options: { levels: 256 } };

const flat = (value: number, alpha = 255, w = 8, h = 8) => {
  const source = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < source.length; i += 4) {
    source[i] = value; source[i + 1] = value; source[i + 2] = value; source[i + 3] = alpha;
  }
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width: w, height: h,
    getContext: (type: string) => type === "2d" ? {
      getImageData: () => ({ data: new Uint8ClampedArray(source), width: w, height: h }),
      putImageData: (img: { data: Uint8ClampedArray }) => { written = new Uint8ClampedArray(img.data); },
    } : null,
  } as unknown as HTMLCanvasElement;
  return { canvas, output: () => { if (!written) throw new Error("no output"); return written; } };
};

afterEach(() => vi.restoreAllMocks());

describe("Dodge / Burn linear-light exposure (JS path)", () => {
  it("applies the dodge factor in linear light, matching the reference", () => {
    // Shadow value 64, range 128, strength 0.5 -> factor 1.25 applied in linear.
    const value = 64, strength = 0.5, range = 128;
    const factor = 1 + strength * (1 - value / range);
    const expected = Math.round(linearExposure(value / 255, factor) * 255);
    const fx = flat(value);
    dodgeBurn.func(fx.canvas, {
      ...dodgeBurnDefaults, mode: "DODGE", strength, range,
      palette: identityPalette, _webglAcceleration: false,
    } as never);
    const out = fx.output();
    expect(out[0]).toBe(expected);
    expect(out[0]).toBeGreaterThan(value); // brightened
  });

  it("burns highlights darker and leaves in-range tones untouched", () => {
    const burn = flat(220);
    dodgeBurn.func(burn.canvas, {
      ...dodgeBurnDefaults, mode: "BURN", strength: 0.5, range: 128,
      palette: identityPalette, _webglAcceleration: false,
    } as never);
    expect(burn.output()[0]).toBeLessThan(220);

    // A pixel exactly at the range boundary is neither dodged nor burned
    // (strict comparisons), so factor 1 -> unchanged.
    const edge = flat(128);
    dodgeBurn.func(edge.canvas, {
      ...dodgeBurnDefaults, mode: "BOTH", strength: 0.8, range: 128,
      palette: identityPalette, _webglAcceleration: false,
    } as never);
    expect(edge.output()[0]).toBe(128);
  });

  it("preserves alpha and tolerates malformed options", () => {
    const fx = flat(90, 128);
    expect(() => dodgeBurn.func(fx.canvas, {
      mode: "WRONG", strength: Number.NaN, range: null,
      palette: identityPalette, _webglAcceleration: false,
    } as never)).not.toThrow();
    const out = fx.output();
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(128);
  });
});
