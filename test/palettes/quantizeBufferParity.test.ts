import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { initWasmFromBinary, wasmIsLoaded } from "@gyng/ditherer-filters";
import { applyPaletteToBuffer } from "palettes/backend";
import user, { THEMES } from "palettes/user";
import { RGB_NEAREST, RGB_APPROX, HSV_NEAREST, LAB_NEAREST } from "constants/color";

// applyPaletteToBuffer now routes custom-colour RGB palettes through the
// whole-buffer WASM quantizer instead of the per-pixel JS loop (1348ms -> 83ms
// at 1920x1080). A palette pass that's fast and wrong would recolour every
// image in the app, so the WASM path must agree with the JS path exactly —
// not approximately.
//
// The two are only interchangeable because neither weighs alpha in the
// distance and both copy the source alpha through. That's the invariant worth
// pinning: if either side starts scoring alpha, they diverge on transparent
// images and these fail.

const PALETTE = THEMES.CGA;

const withAlgo = (algo: string) => ({
  ...user,
  options: { colors: PALETTE, colorDistanceAlgorithm: algo },
});

const makeBuf = (n: number, alpha?: number) => {
  const buf = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const h = (i * 2654435761) >>> 0;
    buf[i * 4] = h & 0xff;
    buf[i * 4 + 1] = (h >>> 8) & 0xff;
    buf[i * 4 + 2] = (h >>> 16) & 0xff;
    buf[i * 4 + 3] = alpha ?? ((h >>> 24) & 0xff);
  }
  return buf;
};

const apply = (src: Uint8ClampedArray, palette: unknown, wasm: boolean) => {
  const out = new Uint8ClampedArray(src.length);
  applyPaletteToBuffer(src, out, src.length / 4, 1, palette as never, wasm);
  return out;
};

describe("whole-buffer RGB quantizer parity", () => {
  beforeAll(async () => {
    if (wasmIsLoaded()) return;
    const bin = readFileSync(
      resolve(process.cwd(), "packages/ditherer-filters/src/wasm/rgba2laba/wasm/rgba2laba_bg.wasm"),
    );
    await initWasmFromBinary(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  });

  it("loaded the wasm — otherwise the wasm=true runs below are just the JS path", () => {
    // Without this the whole file would silently pass by comparing JS to JS.
    expect(wasmIsLoaded()).toBe(true);
  });

  it("RGB: WASM and JS agree on every pixel", () => {
    const src = makeBuf(4096, 255);
    expect(Array.from(apply(src, withAlgo(RGB_NEAREST), true)))
      .toEqual(Array.from(apply(src, withAlgo(RGB_NEAREST), false)));
  });

  it("RGB: they agree with varying alpha too", () => {
    // The interchange rests on alpha being carried through and never scored.
    const src = makeBuf(4096);
    expect(Array.from(apply(src, withAlgo(RGB_NEAREST), true)))
      .toEqual(Array.from(apply(src, withAlgo(RGB_NEAREST), false)));
  });

  it("RGB: source alpha is preserved exactly", () => {
    const src = makeBuf(1024);
    const out = apply(src, withAlgo(RGB_NEAREST), true);
    for (let i = 3; i < src.length; i += 4) expect(out[i]).toBe(src[i]);
  });

  it("RGB: only emits palette colours", () => {
    const allowed = new Set(PALETTE.map((c) => `${c[0]},${c[1]},${c[2]}`));
    const out = apply(makeBuf(4096, 255), withAlgo(RGB_NEAREST), true);
    for (let i = 0; i < out.length; i += 4) {
      expect(allowed.has(`${out[i]},${out[i + 1]},${out[i + 2]}`)).toBe(true);
    }
  });

  it("RGB: an exact palette colour maps to itself", () => {
    const src = new Uint8ClampedArray(PALETTE.length * 4);
    PALETTE.forEach((c, i) => {
      src[i * 4] = c[0]; src[i * 4 + 1] = c[1]; src[i * 4 + 2] = c[2]; src[i * 4 + 3] = 255;
    });
    const out = apply(src, withAlgo(RGB_NEAREST), true);
    expect(Array.from(out)).toEqual(Array.from(src));
  });

  it("works in place (input === output)", () => {
    // Callers like applyPalettePassToCanvas pass the same buffer for both.
    const src = makeBuf(512, 255);
    const expected = apply(src, withAlgo(RGB_NEAREST), false);
    const inPlace = new Uint8ClampedArray(src);
    applyPaletteToBuffer(inPlace, inPlace, 512, 1, withAlgo(RGB_NEAREST) as never, true);
    expect(Array.from(inPlace)).toEqual(Array.from(expected));
  });

  it.each([RGB_APPROX, HSV_NEAREST, LAB_NEAREST])(
    "%s is left on the JS path and is unaffected by the wasm flag",
    (algo) => {
      // Only RGB has a whole-buffer Rust function; the others must not be
      // silently routed through it, which would change their colours.
      const src = makeBuf(1024, 255);
      expect(Array.from(apply(src, withAlgo(algo), true)))
        .toEqual(Array.from(apply(src, withAlgo(algo), false)));
    },
  );

  it("wasmAcceleration=false still uses the JS path", () => {
    // The escape hatch has to keep working — it's how the app disables WASM.
    const src = makeBuf(1024, 255);
    const off = apply(src, withAlgo(RGB_NEAREST), false);
    const on = apply(src, withAlgo(RGB_NEAREST), true);
    expect(Array.from(off)).toEqual(Array.from(on));
  });
});
