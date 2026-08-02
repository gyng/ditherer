import { filterIndex } from "@gyng/ditherer-filters";
import { canvasPixels, makeSolidCanvas, runtimeOptions } from "../fixtures";
import type { FilterLike } from "../types";

type Result = { ok: true } | { ok: false; reason: string };

const meanLuma = (px: Uint8ClampedArray): number => {
  let s = 0;
  for (let i = 0; i < px.length; i += 4)
    s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  return s / (px.length / 4);
};

const run = (
  name: string,
  canvas: HTMLCanvasElement,
  extra: Record<string, unknown>,
): Uint8ClampedArray | null => {
  const filter = filterIndex[name] as FilterLike | undefined;
  if (!filter) return null;
  return canvasPixels(
    filter.func(canvas, {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      ...extra,
    }) as HTMLCanvasElement,
  );
};

/** Solarize: a smooth Sabattier reversal — highlights fold toward black, and
 * zero strength is identity. */
export const runSolarizeReversal = (): Result => {
  const filter = filterIndex.Solarize as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Solarize missing from registry" };

  const white = run("Solarize", makeSolidCanvas(24, 24, 240), { threshold: 128, strength: 1 });
  const dark = run("Solarize", makeSolidCanvas(24, 24, 40), { threshold: 128, strength: 1 });
  const identity = run("Solarize", makeSolidCanvas(24, 24, 200), { threshold: 128, strength: 0 });
  if (!white || !dark || !identity) return { ok: false, reason: "Solarize readback failed" };

  if (!(meanLuma(white) < 120)) {
    return { ok: false, reason: `highlights did not reverse (luma ${meanLuma(white).toFixed(1)})` };
  }
  if (!(meanLuma(dark) < 90)) {
    return {
      ok: false,
      reason: `shadow tone was pushed up unexpectedly (luma ${meanLuma(dark).toFixed(1)})`,
    };
  }
  if (Math.abs(meanLuma(identity) - 200) > 3) {
    return {
      ok: false,
      reason: `strength 0 is not identity (luma ${meanLuma(identity).toFixed(1)})`,
    };
  }
  return { ok: true };
};

/**
 * Atmospheric Haze must use EXPONENTIAL Koschmieder transmission composited in
 * linear light, not the old transmission-linear-in-depth gamma lerp. On a grey
 * luma ramp in LUMA depth mode, the airlight tint (blue−red bias, since a grey
 * source contributes none) is proportional to (1 − e^(−β·luma)) — a concave
 * buildup, so equal depth steps yield a LARGER tint increase near than far. A
 * linear-in-depth haze would give equal steps and fail the convexity check.
 */
export const runHazeKoschmiederDepth = (): Result => {
  const w = 48,
    h = 16;
  // Grey horizontal ramp: luma ~ x/(w-1), so LUMA-mode depth spans 0..1.
  const ramp = document.createElement("canvas");
  ramp.width = w;
  ramp.height = h;
  const ctx = ramp.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: "haze ramp fixture has no 2d context" };
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const v = Math.round((x / (w - 1)) * 255),
        o = (y * w + x) * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);

  const hazed = run("Atmospheric Haze", ramp, {
    strength: 0.9,
    depthMode: "LUMA",
    highlightBloom: 0,
  });
  const identity = run("Atmospheric Haze", makeSolidCanvas(24, 24, 128), {
    strength: 0,
    depthMode: "LUMA",
    highlightBloom: 0,
  });
  if (!hazed || !identity) return { ok: false, reason: "Atmospheric Haze readback failed" };

  const blueBiasAt = (fx: number): number => {
    const x = Math.round(fx * (w - 1));
    let sum = 0;
    for (let y = 0; y < h; y += 1) {
      const i = (y * w + x) * 4;
      sum += hazed[i + 2] - hazed[i];
    }
    return sum / h;
  };
  const near = blueBiasAt(0.25),
    mid = blueBiasAt(0.5),
    far = blueBiasAt(0.75);
  if (!(far > mid && mid > near && near > 4)) {
    return {
      ok: false,
      reason: `airlight tint not increasing with depth (${near.toFixed(1)}, ${mid.toFixed(1)}, ${far.toFixed(1)})`,
    };
  }
  // Exponential (concave) buildup: near step must exceed the far step. A
  // linear-in-depth transmission would make these equal.
  const stepNear = mid - near,
    stepFar = far - mid;
  if (!(stepNear > stepFar * 1.25)) {
    return {
      ok: false,
      reason: `transmission not exponential (step near ${stepNear.toFixed(1)} vs far ${stepFar.toFixed(1)})`,
    };
  }
  if (Math.abs(meanLuma(identity) - 128) > 3) {
    return {
      ok: false,
      reason: `strength 0 is not identity (luma ${meanLuma(identity).toFixed(1)})`,
    };
  }
  return { ok: true };
};

/** Dodge/Burn: dodge brightens shadows, burn darkens highlights; zero strength
 * is identity. */
export const runDodgeBurnDirectional = (): Result => {
  const dodged = run("Dodge / Burn", makeSolidCanvas(20, 20, 60), {
    mode: "DODGE",
    strength: 0.6,
    range: 128,
  });
  const burned = run("Dodge / Burn", makeSolidCanvas(20, 20, 210), {
    mode: "BURN",
    strength: 0.6,
    range: 128,
  });
  const identity = run("Dodge / Burn", makeSolidCanvas(20, 20, 150), {
    mode: "BOTH",
    strength: 0,
    range: 128,
  });
  if (!dodged || !burned || !identity) return { ok: false, reason: "Dodge/Burn readback failed" };

  if (!(meanLuma(dodged) > 60 + 3)) {
    return {
      ok: false,
      reason: `dodge did not brighten the shadow (luma ${meanLuma(dodged).toFixed(1)})`,
    };
  }
  if (!(meanLuma(burned) < 210 - 3)) {
    return {
      ok: false,
      reason: `burn did not darken the highlight (luma ${meanLuma(burned).toFixed(1)})`,
    };
  }
  if (Math.abs(meanLuma(identity) - 150) > 3) {
    return {
      ok: false,
      reason: `strength 0 is not identity (luma ${meanLuma(identity).toFixed(1)})`,
    };
  }
  // Linear-light vs gamma-space discriminator: dodging mid-grey 128 by factor
  // ~1.5 lands near 154 in linear light but ~192 as a gamma-space multiply, so
  // an on-the-gamma-multiply regression exceeds this bound.
  const linMid = run("Dodge / Burn", makeSolidCanvas(16, 16, 128), {
    mode: "DODGE",
    strength: 1,
    range: 255,
  });
  if (!linMid) return { ok: false, reason: "Dodge/Burn readback failed" };
  if (!(meanLuma(linMid) < 178)) {
    return {
      ok: false,
      reason: `exposure applied in gamma space, not linear (luma ${meanLuma(linMid).toFixed(1)})`,
    };
  }
  return { ok: true };
};
