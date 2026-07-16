import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// cloneCanvas needs a real canvas to drawImage from; identity is enough here
// and is what the sibling conformance tests do.
vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import { initWasmFromBinary, wasmIsLoaded } from "@gyng/ditherer-filters";
import {
  atkinson, burkes, floydSteinberg, jarvis, sierra, sierra2, sierraLite, stucki,
} from "filters/errorDiffusing";
import { ORDER, TEMPORAL_MODE } from "filters/errorDiffusingFilterFactory";
import nearest from "palettes/nearest";
import {
  ATKINSON, BURKES, FLOYD_STEINBERG, JARVIS, SIERRA, SIERRA_2, SIERRA_LITE, STUCKI,
  diffuse, type Tap,
} from "../fixtures/errorDiffusionReference";

// Pins the error-diffusion filters against an independent reference
// (test/fixtures/errorDiffusionReference.ts), on BOTH backends.
//
// This is the layer that was missing. The existing conformance tests either
// force `_wasmAcceleration: false` or mock the WASM kernel away and assert
// argument positions — so the path that actually ships (Rust
// `error_diffuse_buffer`) had no output assertion anywhere, and JS/WASM were
// never checked against each other. A kernel transcribed wrongly, a serpentine
// mirror that forgets to negate its offset, or Atkinson renormalised to 1/6
// would all have passed.

const W = 9;
const H = 7;

// A gradient with a couple of hard edges — flat colour would let a broken
// kernel look correct, since there'd be no error to misplace.
const makeSource = () => {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = Math.round((x / (W - 1)) * 255);
      rgba[i + 1] = Math.round((y / (H - 1)) * 255);
      rgba[i + 2] = (x + y) % 3 === 0 ? 200 : 40;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
};

// The filter writes its result back through putImageData; capture it there.
const makeCanvas = (data: Uint8ClampedArray) => {
  const source = new Uint8ClampedArray(data);
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width: W,
    height: H,
    getContext: (type: string) => type === "2d" ? {
      getImageData: () => ({ data: new Uint8ClampedArray(source), width: W, height: H }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        written = new Uint8ClampedArray(img.data);
      },
    } : null,
  } as unknown as HTMLCanvasElement;
  return { canvas, written: () => written };
};

// Simplest configuration the filter offers: plain left-to-right scanline, no
// linearize, no temporal carryover. Anything else is the implementation's own
// embellishment; this pins the core diffusion.
const baseOptions = (wasm: boolean) => ({
  serpentine: false,
  scanOrder: ORDER.HORIZONTAL,
  temporalMode: TEMPORAL_MODE.OFF,
  temporalBleed: 0,
  palette: { ...nearest, options: { levels: 2 } },
  _linearize: false,
  _wasmAcceleration: wasm,
});

const run = (filter: any, wasm: boolean): Uint8ClampedArray => {
  const { canvas, written } = makeCanvas(makeSource());
  filter.func(canvas, baseOptions(wasm));
  const result = written();
  if (!result) throw new Error("filter produced no output — nothing was written back");
  return result;
};

const compare = (actual: Uint8ClampedArray, expected: Uint8ClampedArray) => {
  let mismatched = 0;
  const examples: string[] = [];
  for (let i = 0; i < expected.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      if (actual[i + c] !== expected[i + c]) {
        mismatched++;
        if (examples.length < 4) {
          const p = i / 4;
          examples.push(
            `(${p % W},${Math.floor(p / W)}) ch${c}: got ${actual[i + c]} want ${expected[i + c]}`,
          );
        }
      }
    }
  }
  return { mismatched, examples };
};

const KERNELS: [string, any, Tap[]][] = [
  ["Floyd-Steinberg", floydSteinberg, FLOYD_STEINBERG],
  ["Atkinson", atkinson, ATKINSON],
  ["Jarvis", jarvis, JARVIS],
  ["Stucki", stucki, STUCKI],
  ["Burkes", burkes, BURKES],
  ["Sierra", sierra, SIERRA],
  ["Sierra 2-row", sierra2, SIERRA_2],
  ["Sierra lite", sierraLite, SIERRA_LITE],
];

describe("error diffusion vs an independent reference", () => {
  describe.each(KERNELS)("%s", (_name, filter, taps) => {
    it("JS path matches the reference exactly", () => {
      const expected = diffuse(makeSource(), W, H, taps, 2);
      const { mismatched, examples } = compare(run(filter, false), expected);
      expect(mismatched, `mismatched channels:\n  ${examples.join("\n  ")}`).toBe(0);
    });
  });
});

describe("error diffusion on the WASM path (the one that ships)", () => {
  beforeAll(async () => {
    if (wasmIsLoaded()) return;
    const bin = readFileSync(
      resolve(process.cwd(), "packages/ditherer-filters/src/wasm/rgba2laba/wasm/rgba2laba_bg.wasm"),
    );
    await initWasmFromBinary(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  });

  it("actually loaded the wasm — otherwise these assertions are vacuous", () => {
    expect(wasmIsLoaded()).toBe(true);
  });

  describe.each(KERNELS)("%s", (_name, filter, taps) => {
    it("WASM path matches the reference exactly", () => {
      const expected = diffuse(makeSource(), W, H, taps, 2);
      const { mismatched, examples } = compare(run(filter, true), expected);
      expect(mismatched, `mismatched channels:\n  ${examples.join("\n  ")}`).toBe(0);
    });

    it("WASM and JS agree", () => {
      const { mismatched, examples } = compare(run(filter, true), run(filter, false));
      expect(mismatched, `backends disagree:\n  ${examples.join("\n  ")}`).toBe(0);
    });
  });
});
