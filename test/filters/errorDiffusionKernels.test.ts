import { describe, expect, it } from "vitest";

import {
  atkinsonKernel, burkesKernel, falseFsKernel, fsKernel, horizontalStripeKernel,
  jarvisKernel, sierra2kernel, sierra3kernel, sierraLiteKernel, stuckiKernel,
  verticalStripeKernel,
} from "filters/errorDiffusing";

// These kernels ARE the algorithms — "Atkinson" means nothing except its
// weights. errorDiffusionOracle.test.ts already catches a wrong weight
// behaviourally; this file exists for the two things it can't do:
//
//  - state the normalisation as intent, so Atkinson's deliberate 6/8 reads as a
//    decision rather than a bug someone helpfully "fixes" to 8/8
//  - cover the stripe kernels, which have no published reference to diff against
//
// If one of these fails, don't adjust the number to match — the number is the
// published definition, so a mismatch means the kernel changed.

const sum = (k: { kernel: (number | null)[][] }) =>
  k.kernel.flat().reduce((acc: number, v) => acc + (v ?? 0), 0);

const shape = (k: { kernel: (number | null)[][] }) =>
  [k.kernel.length, Math.max(...k.kernel.map((r) => r.length))];

describe("error-diffusion kernel normalisation", () => {
  // Every classic kernel conserves the error it distributes: the weights sum to
  // 1, so the residual is moved, never created or lost.
  it.each([
    ["Floyd-Steinberg", fsKernel],
    ["False Floyd-Steinberg", falseFsKernel],
    ["Sierra", sierra3kernel],
    ["Sierra 2-row", sierra2kernel],
    ["Sierra lite", sierraLiteKernel],
    ["Jarvis", jarvisKernel],
    ["Stucki", stuckiKernel],
    ["Burkes", burkesKernel],
  ])("%s conserves error (weights sum to 1)", (_name, kernel) => {
    expect(sum(kernel)).toBeCloseTo(1, 10);
  });

  it("Atkinson deliberately discards 25% of the error", () => {
    // 6 taps at 1/8 = 6/8. This is not a normalisation bug — throwing away a
    // quarter of the error is exactly why Atkinson blows out contrast and looks
    // like a Mac Classic. Renormalising to 1 would destroy the filter's identity
    // while leaving every smoke test green.
    expect(sum(atkinsonKernel)).toBeCloseTo(6 / 8, 10);
    expect(atkinsonKernel.kernel.flat().filter((v) => v != null)).toHaveLength(6);
  });

  it("the stripe kernels distribute only half the error", () => {
    // 2 taps at 1/4 each. Deliberately lossy — they're filed under "weird
    // kernels" and exist for the streak artefact, not for fidelity.
    expect(sum(horizontalStripeKernel)).toBeCloseTo(0.5, 10);
    expect(sum(verticalStripeKernel)).toBeCloseTo(0.5, 10);
  });
});

describe("error-diffusion kernel geometry", () => {
  // The offset places the kernel's origin relative to the current pixel. Get it
  // wrong and error diffuses to the wrong side — output stays plausible, so
  // nothing else would notice.
  it.each([
    ["Floyd-Steinberg", fsKernel, [-1, 0], [2, 3]],
    ["False Floyd-Steinberg", falseFsKernel, [0, 0], [2, 2]],
    ["Sierra", sierra3kernel, [-2, 0], [3, 5]],
    ["Sierra 2-row", sierra2kernel, [-2, 0], [2, 5]],
    ["Sierra lite", sierraLiteKernel, [-1, 0], [2, 3]],
    ["Atkinson", atkinsonKernel, [-1, 0], [3, 4]],
    ["Jarvis", jarvisKernel, [-2, 0], [3, 5]],
    ["Stucki", stuckiKernel, [-2, 0], [3, 5]],
    ["Burkes", burkesKernel, [-2, 0], [2, 5]],
  ])("%s has the published offset and extent", (_name, kernel, offset, extent) => {
    expect(kernel.offset).toEqual(offset);
    expect(shape(kernel)).toEqual(extent);
  });

  it("never diffuses into already-visited pixels", () => {
    // A tap landing behind the cursor on the current row would feed error into a
    // pixel that's already been quantised — silently lost, and a sign the offset
    // or matrix drifted. Row 0 may only carry weight strictly ahead of the pixel.
    for (const [name, k] of [
      ["Floyd-Steinberg", fsKernel], ["Sierra", sierra3kernel],
      ["Sierra 2-row", sierra2kernel], ["Sierra lite", sierraLiteKernel],
      ["Atkinson", atkinsonKernel], ["Jarvis", jarvisKernel],
      ["Stucki", stuckiKernel], ["Burkes", burkesKernel],
    ] as const) {
      const offsetX = k.offset[0] ?? 0;
      k.kernel[0]?.forEach((weight, w) => {
        if (weight == null) return;
        expect(w + offsetX, `${name}: row-0 tap at dx=${w + offsetX} is not ahead of the cursor`)
          .toBeGreaterThan(0);
      });
    }
  });
});
