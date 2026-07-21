// GL filter smoke check. Runs in a real browser so WebGL2 is available.
//
// For every registered filter we force WebGL acceleration and observe whether
// the browser actually compiles or draws through WebGL2. For every discovered
// GL path we:
//   1. render with default options in default and _linearize=true modes
//   2. render once per non-default ENUM value to exercise alternate shader
//      branches (e.g. bokeh shape, morphology mode, LCD subpixel layout)
//   3. require GL-only filters to issue a draw rather than silently returning
//      their input after a renderer failure
//   4. confirm each output is a contract-sized canvas with non-trivial alpha (catches
//      the "float-in-u8-clamped" bug the jsdom smoke was originally guarding,
//      plus any shader-compile/link failure on an enum branch)
// Aggregate pass/fail counts get written to window.__glSmokeResult and the
// page's status node; the Playwright spec reads both.

import {
  BOOL,
  ENUM,
  PALETTE,
  RANGE,
  filterIndex,
  getGLCtx,
  glAvailable,
  glUnavailableStub,
  nearest,
  serializePalette,
  user,
  vhsNtscGLUsingFloatPath,
} from "@gyng/ditherer-filters";
import { workerRPC } from "@gyng/ditherer-filters/client";

declare global {
  interface Window {
    __glSmokeResult?: {
      status: "ok" | "failed";
      passed: number;
      failed: number;
      skipped: number;
      glFilters: number;
      requiredGLFilters: number;
      shaderCompiles: number;
      programLinks: number;
      shaderFailures: number;
      drawCalls: number;
      failures: { name: string; mode: string; reason: string }[];
    };
  }
}

const statusNode = document.querySelector('[data-testid="status"]');
const detailsNode = document.querySelector('[data-testid="details"]');

const makeGradientCanvas = (w: number, h: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const data = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const xBand = Math.floor((x / Math.max(1, w)) * 4) / 3;
      const yBand = Math.floor((y / Math.max(1, h)) * 4) / 3;
      data.data[i] = Math.round(Math.min(1, xBand) * 255);
      data.data[i + 1] = Math.round(Math.min(1, yBand) * 255);
      data.data[i + 2] = 255 - data.data[i];
      // Broad flat bands give edge shaders non-edge interiors, while the
      // central checker and color steps retain high-frequency signal content.
      if (x >= w / 4 && x < (w * 3) / 4 && y >= h / 4 && y < (h * 3) / 4) {
        const high = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;
        data.data[i] = high ? 245 : 10;
        data.data[i + 1] = high ? 245 : 24;
        data.data[i + 2] = high ? 245 : 48;
      }
      data.data[i + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
};

const maxAlpha = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const ctx = (canvas as HTMLCanvasElement).getContext(
    "2d",
    { willReadFrequently: true },
  ) as CanvasRenderingContext2D | null;
  if (!ctx) return -1;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let m = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > m) m = pixels[i];
  }
  return m;
};

const lumaRange = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const ctx = (canvas as HTMLCanvasElement).getContext(
    "2d",
    { willReadFrequently: true },
  ) as CanvasRenderingContext2D | null;
  if (!ctx) return -1;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let low = 255;
  let high = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
    low = Math.min(low, luma);
    high = Math.max(high, luma);
  }
  return high - low;
};

const peakLuma = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const ctx = (canvas as HTMLCanvasElement).getContext(
    "2d",
    { willReadFrequently: true },
  ) as CanvasRenderingContext2D | null;
  if (!ctx) return -1;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let high = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    high = Math.max(
      high,
      pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114,
    );
  }
  return high;
};

const runWorkerCrt = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const width = 16;
  const height = 16;
  const inputCanvas = makeGradientCanvas(width, height);
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  if (!inputContext) return { ok: false, reason: "worker CRT input has no 2d context" };
  const input = inputContext.getImageData(0, 0, width, height).data;
  const workerDefaults = { ...(filterIndex.rgbStripe.defaults ?? {}) };
  delete workerDefaults.palette;

  try {
    const result = await workerRPC({
      imageData: input.slice().buffer,
      width,
      height,
      chain: [{
        id: "crt-worker-smoke",
        filterName: "rgbStripe",
        displayName: "CRT emulation",
        options: workerDefaults,
      }],
      frameIndex: 0,
      isAnimating: false,
      linearize: false,
      wasmAcceleration: false,
      webglAcceleration: true,
      convertGrayscale: false,
      prevOutputs: {},
      prevInputs: {},
      emaMaps: {},
      degaussFrame: -2147483648,
    });
    const output = new Uint8ClampedArray(result.imageData);
    let changedChannels = 0;
    for (let i = 0; i < output.length; i += 4) {
      if (output[i] !== input[i]) changedChannels += 1;
      if (output[i + 1] !== input[i + 1]) changedChannels += 1;
      if (output[i + 2] !== input[i + 2]) changedChannels += 1;
    }
    return changedChannels > width * height
      ? { ok: true }
      : { ok: false, reason: `worker CRT changed only ${changedChannels} color channels` };
  } catch (error) {
    return { ok: false, reason: `worker CRT threw: ${error instanceof Error ? error.message : String(error)}` };
  }
};

const runWorkerSpecFilters = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const width = 48;
  const height = 32;
  const inputCanvas = makeGradientCanvas(width, height);
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  if (!inputContext) return { ok: false, reason: "spec-filter worker input has no 2d context" };
  const input = inputContext.getImageData(0, 0, width, height).data;
  const names = [
    "Apollo Slow-Scan TV",
    "PAL / SECAM",
    "Fax Machine",
    "Gameboy Camera",
    "Teletext",
    "Wavelet Codec",
  ];
  const temporalNames = new Set([
    "Apollo Slow-Scan TV",
    "PAL / SECAM",
    "Fax Machine",
    "Gameboy Camera",
  ]);

  try {
    for (const name of names) {
      const filter = filterIndex[name];
      if (!filter) return { ok: false, reason: `${name} is missing from the worker registry` };
      const options: Record<string, unknown> = { ...(filter.defaults ?? {}) };
      const palette = options.palette as Parameters<typeof serializePalette>[0] | undefined;
      // Exercise the same executable-palette -> structured-clone-safe payload
      // conversion used by FilterContext before worker dispatch.
      if (palette) options.palette = serializePalette(palette);
      const id = `spec-worker-${name}`;
      const first = await workerRPC({
        imageData: input.slice().buffer,
        width,
        height,
        chain: [{ id, filterName: name, displayName: name, options }],
        frameIndex: 0,
        isAnimating: true,
        linearize: false,
        wasmAcceleration: false,
        webglAcceleration: true,
        convertGrayscale: false,
        prevOutputs: {},
        prevInputs: {},
        emaMaps: {},
        degaussFrame: -2147483648,
      });
      if (first.width !== width || first.height !== height) {
        return { ok: false, reason: `${name} worker size drifted to ${first.width}x${first.height}` };
      }
      if (first.stepTimes.length !== 1 || !first.prevOutputs[id] || !first.prevInputs[id] || !first.emaMaps[id]) {
        return { ok: false, reason: `${name} did not complete a worker step with temporal snapshots` };
      }
      const output = new Uint8ClampedArray(first.imageData);
      let changed = 0;
      let low = 255;
      let high = 0;
      for (let i = 0; i < output.length; i += 4) {
        if (output[i] !== input[i] || output[i + 1] !== input[i + 1] || output[i + 2] !== input[i + 2]) changed += 1;
        if (output[i + 3] < 200) return { ok: false, reason: `${name} worker emitted transparent pixels` };
        const luma = output[i] * 0.299 + output[i + 1] * 0.587 + output[i + 2] * 0.114;
        low = Math.min(low, luma);
        high = Math.max(high, luma);
      }
      if (changed < width || high - low < 8) {
        return { ok: false, reason: `${name} worker output was inert (changed=${changed}, range=${(high - low).toFixed(2)})` };
      }

      if (temporalNames.has(name)) {
        const second = await workerRPC({
          imageData: input.slice().buffer,
          width,
          height,
          chain: [{ id, filterName: name, displayName: name, options }],
          frameIndex: 1,
          isAnimating: true,
          linearize: false,
          wasmAcceleration: false,
          webglAcceleration: true,
          convertGrayscale: false,
          prevOutputs: { [id]: first.prevOutputs[id].imageData },
          prevInputs: first.prevInputs,
          emaMaps: first.emaMaps,
          degaussFrame: -2147483648,
        });
        if (second.stepTimes.length !== 1 || !second.prevOutputs[id]) {
          return { ok: false, reason: `${name} failed its second worker/temporal frame` };
        }
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `spec-filter worker threw: ${error instanceof Error ? error.message : String(error)}` };
  }
};

// Quantize's whole job is "emit only palette colours". shaderValidationOverrides
// already injects a 3-colour palette to wake the shader up (its default palette
// is identity, which returns the input untouched) — but the sweep then only
// checks alpha and peak luma, so an inverted u_algo or a broken nearest-match
// would sail through. Assert the output is actually a subset of that palette.
const runQuantizePaletteSubset = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Quantize;
  const colors = [[0, 0, 0], [255, 255, 255], [255, 64, 32]];
  const source = makeGradientCanvas(16, 16);
  const defaults = { ...(filter.defaults ?? {}) } as Record<string, unknown>;
  const palette = defaults.palette as Record<string, unknown> | undefined;
  const output = filter.func(source, {
    ...defaults,
    palette: {
      ...palette,
      options: {
        ...((palette?.options as Record<string, unknown> | undefined) ?? {}),
        colors,
        colorDistanceAlgorithm: "RGB",
      },
    },
    _linearize: false,
    _webglAcceleration: true,
  }) as HTMLCanvasElement;
  const data = output.getContext("2d", { willReadFrequently: true })
    ?.getImageData(0, 0, output.width, output.height).data;
  if (!data) return { ok: false, reason: "Quantize readback failed" };

  const allowed = new Set(colors.map((c) => `${c[0]},${c[1]},${c[2]}`));
  const seen = new Set<string>();
  for (let i = 0; i < data.length; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  const strays = [...seen].filter((c) => !allowed.has(c));
  if (strays.length > 0) {
    return { ok: false, reason: `Quantize emitted non-palette colors: ${strays.slice(0, 3).join(" | ")}` };
  }
  // A shader that collapsed to one colour would also be "a subset".
  if (seen.size < 2) return { ok: false, reason: `Quantize collapsed to ${seen.size} color(s)` };
  return { ok: true };
};

// The four screen angles are the entire point of CMYK halftoning — they're what
// stops the separations moiring. cmykHalftone is requiresGL, so
// filterOptionConformance (the only thing that sweeps RANGE options) skips it,
// and the gl-smoke enum sweep doesn't touch RANGE at all: swap angleY and angleK
// and every test passes. Assert each angle independently reaches the shader.
const runCmykAngles = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["CMYK Halftone"];
  if (!filter) return { ok: false, reason: "CMYK Halftone not in registry" };
  const render = (over: Record<string, unknown>): Uint8ClampedArray | null => {
    const source = makeGradientCanvas(32, 32);
    const output = filter.func(source, {
      ...(filter.defaults ?? {}),
      ...over,
      _linearize: false,
      _webglAcceleration: true,
    }) as HTMLCanvasElement;
    return output.getContext("2d", { willReadFrequently: true })
      ?.getImageData(0, 0, output.width, output.height).data ?? null;
  };
  const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return true;
    }
    return false;
  };

  const base = render({});
  if (!base) return { ok: false, reason: "CMYK readback failed" };
  // Rotating any one screen must change the print. If it doesn't, that angle
  // isn't wired to its separation.
  for (const angle of ["angleC", "angleM", "angleY", "angleK"]) {
    const rotated = render({ [angle]: 30 });
    if (!rotated) return { ok: false, reason: `CMYK readback failed for ${angle}` };
    if (!differs(base, rotated)) {
      return { ok: false, reason: `${angle} has no effect on output — not reaching its separation` };
    }
  }
  // ...and each must be independent: rotating C only must not equal rotating K
  // only, which is what a copy-pasted uniform upload would give.
  const c = render({ angleC: 30 });
  const k = render({ angleK: 30 });
  if (c && k && !differs(c, k)) {
    return { ok: false, reason: "angleC and angleK produce identical output — likely the same uniform" };
  }
  return { ok: true };
};

// Median Cut ships both backends: the shader when WebGL2 is available, and a JS
// nearestColor loop otherwise. They build the same palette and then answer the
// same question — which palette entry is closest — so they must agree. Nothing
// compared them, and a shader searching in linear space while the JS searches
// sRGB would just look like slightly different colours on machines without
// WebGL2.
//
// (The MAX_PALETTE=32 gate can't actually be crossed — the levels RANGE also
// tops out at 32 — so the backend split is driven by GL availability alone.)
const runMedianCutBackendAgreement = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Median Cut"];
  if (!filter) return { ok: false, reason: "Median Cut not in registry" };
  const render = (webgl: boolean): Uint8ClampedArray | null => {
    const source = makeGradientCanvas(24, 24);
    const output = filter.func(source, {
      ...(filter.defaults ?? {}),
      levels: 8,
      sampleRate: 1,
      _linearize: false,
      _webglAcceleration: webgl,
    }) as HTMLCanvasElement;
    return output.getContext("2d", { willReadFrequently: true })
      ?.getImageData(0, 0, output.width, output.height).data ?? null;
  };

  const gpu = render(true);
  const cpu = render(false);
  if (!gpu || !cpu) return { ok: false, reason: "Median Cut readback failed" };

  let mismatched = 0;
  let firstExample = "";
  for (let i = 0; i < cpu.length; i += 4) {
    if (gpu[i] !== cpu[i] || gpu[i + 1] !== cpu[i + 1] || gpu[i + 2] !== cpu[i + 2]) {
      mismatched += 1;
      if (!firstExample) {
        const p = i / 4;
        firstExample = `px ${p % 24},${Math.floor(p / 24)}: gl=${gpu[i]},${gpu[i + 1]},${gpu[i + 2]} cpu=${cpu[i]},${cpu[i + 1]},${cpu[i + 2]}`;
      }
    }
  }
  if (mismatched > 0) {
    return {
      ok: false,
      reason: `Median Cut backends disagree on ${mismatched} px — ${firstExample}`,
    };
  }
  // Guard the guard: if the GL path silently fell back to JS, both renders would
  // be the JS one and agreement would be meaningless.
  const changed = cpu.some((v, i) => i % 4 !== 3 && v !== 0);
  if (!changed) return { ok: false, reason: "Median Cut produced an empty render" };
  return { ok: true };
};

// Triangle dither used to seed its TPDF noise from Math.random(), so the same
// still rendered differently every time and nothing could pin it. Now that the
// seed is derived, assert the three things that buys us: reproducibility, that
// the seed actually reaches the shader, and that it still quantises.
const runTriangleDitherSeed = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Triangle dither"];
  if (!filter) return { ok: false, reason: "Triangle dither not in registry" };
  const render = (over: Record<string, unknown>): Uint8ClampedArray | null => {
    const source = makeGradientCanvas(16, 16);
    const output = filter.func(source, {
      ...(filter.defaults ?? {}),
      ...over,
      _linearize: false,
      _webglAcceleration: true,
    }) as HTMLCanvasElement;
    return output.getContext("2d", { willReadFrequently: true })
      ?.getImageData(0, 0, output.width, output.height).data ?? null;
  };
  const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  };

  const a = render({ seed: 42 });
  const b = render({ seed: 42 });
  const c = render({ seed: 7 });
  if (!a || !b || !c) return { ok: false, reason: "Triangle dither readback failed" };

  if (!same(a, b)) return { ok: false, reason: "same seed rendered differently — noise is not reproducible" };
  if (same(a, c)) return { ok: false, reason: "seed has no effect on the noise" };

  // Default palette is nearest levels=2, so this must come out 1-bit per
  // channel. If it doesn't, the shader quantise stage isn't running and we're
  // just adding noise to the image.
  const values = new Set<number>();
  for (let i = 0; i < a.length; i += 4) {
    values.add(a[i]); values.add(a[i + 1]); values.add(a[i + 2]);
  }
  const binary = [...values].every((v) => v === 0 || v === 255);
  if (!binary) {
    return { ok: false, reason: `levels=2 did not quantise: got ${[...values].slice(0, 6)}` };
  }
  if (values.size < 2) return { ok: false, reason: "output collapsed to a single value" };

  // animateNoise must vary with the frame, or video stops shimmering.
  const f0 = render({ seed: 42, animateNoise: true, _frameIndex: 0 });
  const f1 = render({ seed: 42, animateNoise: true, _frameIndex: 1 });
  if (f0 && f1 && same(f0, f1)) {
    return { ok: false, reason: "animateNoise on: frame 0 and 1 are identical" };
  }
  // ...and must not, when it's off.
  const s0 = render({ seed: 42, animateNoise: false, _frameIndex: 0 });
  const s1 = render({ seed: 42, animateNoise: false, _frameIndex: 5 });
  if (s0 && s1 && !same(s0, s1)) {
    return { ok: false, reason: "animateNoise off: output still changed with the frame" };
  }
  return { ok: true };
};

// Halftone ships a live JS compositing fallback (used whenever WebGL2 is
// unavailable) alongside its shader. The jsdom smoke sweep skips the filter
// outright — "uses canvas compositing not supported in jsdom" — so gl-smoke
// covers the shader's liveness and the JS path is covered by nothing at all.
// That's the same shape as the error-diffusion WASM gap: the path a user without
// WebGL2 actually gets, asserted nowhere.
//
// The two can't be compared pixel-for-pixel — one rasterises dots in a shader,
// the other draws canvas arcs with a screen composite — so this asserts the JS
// path is alive and produces a comparable image rather than demanding equality.
const runHalftoneBackends = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Halftone;
  if (!filter) return { ok: false, reason: "Halftone not in registry" };
  const W = 64;
  const H = 64;
  const render = (webgl: boolean, over: Record<string, unknown> = {}): Uint8ClampedArray | null => {
    const source = makeGradientCanvas(W, H);
    const output = filter.func(source, {
      ...(filter.defaults ?? {}),
      ...over,
      _linearize: false,
      _webglAcceleration: webgl,
    }) as HTMLCanvasElement;
    return output.getContext("2d", { willReadFrequently: true })
      ?.getImageData(0, 0, W, H).data ?? null;
  };
  const meanLuma = (d: Uint8ClampedArray) => {
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    return sum / (d.length / 4);
  };

  const gl = render(true);
  const js = render(false);
  if (!gl || !js) return { ok: false, reason: "Halftone readback failed" };

  // The JS path must actually draw something. Blank output here would mean the
  // compositing fallback is broken and nobody would know.
  const jsMean = meanLuma(js);
  const glMean = meanLuma(gl);
  if (jsMean < 1) return { ok: false, reason: `JS fallback rendered a blank image (mean luma ${jsMean.toFixed(2)})` };
  if (glMean < 1) return { ok: false, reason: `GL path rendered a blank image (mean luma ${glMean.toFixed(2)})` };

  // ...and it must be recognisably the same picture. The two rasterise dots
  // differently — shader coverage vs canvas arcs with a screen composite — so
  // they will never match pixel-for-pixel. Measured 1.18x (gl 68.8, js 81.1) on
  // this fixture; 1.5x leaves room for antialiasing without sleeping through a
  // backend that's drawing something else entirely.
  const ratio = Math.max(jsMean, glMean) / Math.max(1, Math.min(jsMean, glMean));
  if (ratio > 1.5) {
    return {
      ok: false,
      reason: `Halftone backends diverge: mean luma gl=${glMean.toFixed(1)} js=${jsMean.toFixed(1)} (${ratio.toFixed(2)}x)`,
    };
  }

  // Both must respond to the grid size — it's the filter's headline control.
  for (const [label, data] of [["gl", render(true, { size: 24 })], ["js", render(false, { size: 24 })]] as const) {
    if (!data) return { ok: false, reason: `Halftone ${label} readback failed at size=24` };
    const base = label === "gl" ? gl : js;
    let changed = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== base[i] || data[i + 1] !== base[i + 1] || data[i + 2] !== base[i + 2]) { changed = true; break; }
    }
    if (!changed) return { ok: false, reason: `Halftone ${label}: size has no effect on output` };
  }

  console.log(`halftone: gl mean luma ${glMean.toFixed(1)}, js ${jsMean.toFixed(1)} (${ratio.toFixed(2)}x)`);
  return { ok: true };
};

// Plan 002 (gamma-correct pipeline) wired `_linearize` into a specific set of
// filters, on the argument that sRGB maths is biased dark — avg(0,255) is 128
// where the perceptual midpoint is 188. Nothing asserts the flag has any effect:
// gl-smoke renders every filter with _linearize:true but only checks alpha and
// peak luma, so a filter that accepts the option and ignores it is
// indistinguishable from one that honours it. If the flag is dead for any of
// them, the pipeline is silently a no-op there.
//
// Every one of these does real colour maths, so linearising first must change
// the result. Runs in the browser because several are requiresGL.
// Fine-grained mid-tone detail. Getting this fixture right took four attempts,
// and every failure looked exactly like a bug in a filter — worth recording, because
// the next person to extend this sweep will hit the same wall:
//
//  - makeGradientCanvas is broad flat bands plus a 245/10 checker. Convolutions
//    are identity on flat regions (kernel sums to 1) and clamp to 0/255 at the
//    extremes in BOTH spaces, so nothing differs.
//  - A linear ramp is worse: a sharpen kernel is a discrete Laplacian, exactly
//    zero on a linear gradient — the input sits in the kernel's null space.
//  - A smooth low-frequency sinusoid is worse still for the DEFAULT kernel,
//    which is GAUSSIAN_3X3 (the ENUM's first *option* is Sharpen; its `default:`
//    is Gaussian). A 3x3 blur barely moves a 32px-period wave, so the two spaces
//    agree to under 1 LSB and round to identical.
//
// What actually discriminates: high-frequency detail in mid-tones. Neighbouring
// pixels far apart in value make a 3x3 kernel do real averaging, mid-tones keep
// everything off the clamps, and averaging is exactly where the two spaces
// diverge — which is plan 002's own argument (sRGB avg(0,255) = 128, but the
// perceptual midpoint is 188).
const makeSmoothRamp = (w: number, h: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const data = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // 1px checker in a NARROW mid band. The separation has to clear two
      // opposing hazards: wide enough that a 3x3 kernel's averaging differs
      // measurably between spaces (110 vs 150 lands ~2 LSB apart), but narrow
      // enough that a contrast/levels adjustment doesn't drive both ends into
      // the 0/255 clamps — where they'd saturate identically in either space and
      // look like a dead flag. A 70/185 checker fails the second test.
      const checker = (x + y) % 2 === 0;
      const fine = (x % 3 === 0) !== (y % 2 === 0);
      data.data[i] = checker ? 110 : 150;
      data.data[i + 1] = fine ? 105 : 145;
      data.data[i + 2] = (x % 2 === 0) ? 115 : 155;
      data.data[i + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
};

// Registry keys are `filter.name`, not the module filename. Watch out: there IS
// a separate "Sharpen" filter (sharpen.ts, an unsharp mask) that has nothing to
// do with convolve.ts and doesn't support linearize — testing that one instead
// produced a convincing "Sharpen=0" that meant nothing.
//
// `opts` forces each filter to actually do colour maths. Several ship identity
// defaults (Brightness/Contrast is brightness 0 / contrast 0 / gamma 1; Levels is
// 0..255 with gamma 1), and an identity transform is unaffected by the space it
// runs in — so testing them at their defaults would measure nothing.
const LINEARIZE_AWARE: { name: string; opts?: Record<string, unknown>; why?: string; knownDead?: string }[] = [
  { name: "Binarize" },
  { name: "Brightness/Contrast", opts: { brightness: 10, contrast: 15 } },
  { name: "Convolve" },
  { name: "Floyd-Steinberg" },
  { name: "Grayscale" },
  // KNOWN DEAD — pinned, not hidden. Halftone reads _linearize in its JS path
  // (it averages each cell's block in linear space, then delinearises to draw —
  // exactly plan 002's argument) but renderHalftoneGL takes no linearize
  // argument at all, so with WebGL2 available (the normal case) the toggle does
  // nothing. Plan 002 lists Halftone as CRITICAL for gamma correctness.
  //
  // Not fixed here because it isn't a missing uniform: the GL shader doesn't
  // average a block, it point-samples the cell centre, so there's no averaging
  // for linearisation to correct. Making it gamma-correct means deciding what
  // that should mean in GL (dot area proportional to linear intensity?), which
  // changes the look and still leaves the two backends structurally different.
  // That's a design call. See docs/plan/057.
  { name: "Halftone", knownDead: "GL path takes no linearize arg; JS path honours it" },
  { name: "Levels", opts: { gamma: 1.6 } },
  { name: "N-Candidate" },
  { name: "Ordered" },
  // Pixelate only linearises around its palette pass, and its default palette is
  // levels 256 — identity — so the pass is skipped entirely and the flag is a
  // no-op by design. Give it a real palette so the path under test actually runs.
  {
    name: "Pixelate",
    opts: { palette: { name: "nearest", options: { levels: 4 } } },
    why: "default palette is identity; linearize only wraps the palette pass",
  },
  { name: "Quantize" },
  { name: "Random" },
  { name: "Riemersma" },
];

const runLinearizeIsLive = (): { ok: true } | { ok: false; reason: string } => {
  const dead: string[] = [];
  const missing: string[] = [];
  const counts: string[] = [];
  const revived: string[] = [];

  for (const { name, opts, knownDead } of LINEARIZE_AWARE) {
    const filter = filterIndex[name];
    if (!filter) { missing.push(name); continue; }
    const render = (linearize: boolean): Uint8ClampedArray | null => {
      const source = makeSmoothRamp(32, 32);
      const options = {
        ...(filter.defaults ?? {}),
        ...shaderValidationOverrides(name, (filter.defaults ?? {}) as Record<string, unknown>),
        ...(opts ?? {}),
        _linearize: linearize,
        _webglAcceleration: true,
      };
      const output = filter.func(source, options) as HTMLCanvasElement;
      return output.getContext("2d", { willReadFrequently: true })
        ?.getImageData(0, 0, 32, 32).data ?? null;
    };
    const off = render(false);
    const on = render(true);
    if (!off || !on) { dead.push(`${name}(readback failed)`); continue; }
    let changed = 0;
    for (let i = 0; i < off.length; i += 4) {
      if (off[i] !== on[i] || off[i + 1] !== on[i + 1] || off[i + 2] !== on[i + 2]) changed += 1;
    }
    counts.push(`${name}=${changed}`);
    if (knownDead) {
      // Assert it's STILL dead, so a fix trips this and prompts an update rather
      // than silently leaving a stale exclusion behind.
      if (changed !== 0) {
        revived.push(`${name} (${knownDead}) now honours _linearize — remove the knownDead pin`);
      }
      continue;
    }
    if (changed === 0) dead.push(name);
  }

  if (missing.length > 0) {
    return { ok: false, reason: `not in registry (renamed?): ${missing.join(", ")}` };
  }
  if (revived.length > 0) {
    return { ok: false, reason: revived.join("; ") };
  }
  if (dead.length > 0) {
    return {
      ok: false,
      reason: `_linearize has no effect on: ${dead.join(", ")} — the gamma-correct path is a no-op there. changed-px per filter: ${counts.join(" ")}`,
    };
  }
  return { ok: true };
};


// Does orderedGL's OKLab mode actually do OKLab?
//
// Two failure modes, both silent:
//   1. ordered.ts falls back to ORDERED_PAL_MODE.LEVELS for an algorithm it
//      doesn't recognise, and LEVELS passes `paletteRgb: null` — so a missing
//      mapping renders level-quantized output with the palette DISCARDED. That
//      looks like a plausible image, not a failure. OKLab hit exactly this.
//   2. The shader's OKLab maths could be wrong. That is how the HSV `/255` bug
//      survived: GL and CPU disagreed on every HSV palette and nothing compared
//      them.
//
// Ordered is requiresGL:true — GL-only, no CPU backend — so the usual
// "both backends agree" shape is impossible here: `_webglAcceleration: false`
// changes nothing and both renders are the same shader. (An earlier version of
// this check did exactly that and passed against a deliberately broken shader.)
//
// So instead: pick colours where OKLab and RGB disagree about which palette
// entry is nearest, and require the shader to give the OKLab answer. That can
// only pass if the shader is really computing OKLab. Each triple's margin is
// wide (>35%) so the dither bias can't flip the winner, and BAYER_16X16 gives
// levels=256 — step 1, bias +-0.5 — so `quant` stays within an LSB of source.
const runOrderedOklabPalette = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Ordered;
  if (!filter) return { ok: false, reason: "Ordered not in registry" };

  // [source, nearest-in-OKLab, nearest-in-RGB] — found by search, margins >35%.
  const TRIPLES: [number[], number[], number[]][] = [
    [[125, 209, 54], [7, 195, 232], [232, 79, 43]],
    [[22, 90, 162], [138, 27, 42], [12, 214, 123]],
    [[32, 151, 116], [136, 140, 5], [81, 209, 131]],
    [[30, 167, 42], [228, 219, 68], [15, 54, 74]],
    [[239, 177, 46], [96, 238, 224], [217, 69, 187]],
  ];

  const flat = (rgb: number[], w: number, h: number): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    ctx.fillRect(0, 0, w, h);
    return canvas;
  };

  for (const [src, okAnswer, rgbAnswer] of TRIPLES) {
    const defaults = { ...(filter.defaults ?? {}) } as Record<string, unknown>;
    const basePalette = defaults.palette as Record<string, unknown>;
    const output = filter.func(flat(src, 16, 16), {
      ...defaults,
      thresholdMap: "BAYER_16X16",   // levels=256 -> bias +-0.5, quant ~= source
      palette: {
        ...basePalette,
        options: {
          ...((basePalette.options as Record<string, unknown>) ?? {}),
          colors: [[...okAnswer, 255], [...rgbAnswer, 255]],
          colorDistanceAlgorithm: "OKLAB",
        },
      },
      _linearize: false,
      _webglAcceleration: true,
    }) as HTMLCanvasElement;
    const data = output.getContext("2d", { willReadFrequently: true })
      ?.getImageData(0, 0, output.width, output.height).data;
    if (!data) return { ok: false, reason: "Ordered OKLab readback failed" };

    let okCount = 0, rgbCount = 0, other = 0;
    let otherExample = "";
    for (let i = 0; i < data.length; i += 4) {
      const px = [data[i], data[i + 1], data[i + 2]];
      if (px[0] === okAnswer[0] && px[1] === okAnswer[1] && px[2] === okAnswer[2]) okCount++;
      else if (px[0] === rgbAnswer[0] && px[1] === rgbAnswer[1] && px[2] === rgbAnswer[2]) rgbCount++;
      else { other++; if (!otherExample) otherExample = `${px}`; }
    }
    const total = data.length / 4;
    if (other > 0) {
      return {
        ok: false,
        reason: `Ordered OKLab src=[${src}] emitted ${other}/${total} px outside the palette (e.g. ${otherExample}) — palMode likely fell back to LEVELS, dropping the palette`,
      };
    }
    if (okCount !== total) {
      return {
        ok: false,
        reason: `Ordered OKLab src=[${src}] picked the RGB-nearest [${rgbAnswer}] for ${rgbCount}/${total} px instead of the OKLab-nearest [${okAnswer}] — shader OKLab disagrees with the CPU reference`,
      };
    }
  }
  return { ok: true };
};

const runOrderedPaletteLevels = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex.Ordered;
  const render = (levels: number): Uint8ClampedArray | null => {
    const source = makeGradientCanvas(16, 16);
    const defaults = { ...(filter.defaults ?? {}) } as Record<string, unknown>;
    const basePalette = defaults.palette as Record<string, unknown>;
    const output = filter.func(source, {
      ...defaults,
      palette: {
        ...basePalette,
        options: {
          ...((basePalette.options as Record<string, unknown>) ?? {}),
          levels,
        },
      },
      _linearize: false,
      _webglAcceleration: true,
    }) as HTMLCanvasElement;
    const context = output.getContext("2d", { willReadFrequently: true });
    return context?.getImageData(0, 0, output.width, output.height).data ?? null;
  };

  const binary = render(2);
  const expanded = render(32);
  if (!binary || !expanded) return { ok: false, reason: "Ordered palette-level readback failed" };
  const binaryChannels = new Set<number>();
  const expandedChannels = new Set<number>();
  let changed = 0;
  for (let i = 0; i < binary.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      binaryChannels.add(binary[i + channel]);
      expandedChannels.add(expanded[i + channel]);
      if (binary[i + channel] !== expanded[i + channel]) changed += 1;
    }
  }
  const binaryOnly = [...binaryChannels].every((value) => value === 0 || value === 255);
  if (!binaryOnly || expandedChannels.size <= binaryChannels.size || changed === 0) {
    return {
      ok: false,
      reason: `Nearest levels ignored: binary=${[...binaryChannels]} expanded=${[...expandedChannels]} changed=${changed}`,
    };
  }
  return { ok: true };
};

type FilterLike = {
  func: (input: unknown, options: unknown) => unknown;
  defaults?: Record<string, unknown>;
  optionTypes?: Record<string, {
    type?: string;
    options?: { value: unknown }[];
    range?: [number, number];
  }>;
  requiresGL?: boolean;
  temporal?: boolean;
};

// Intercept the browser's WebGL2 entry points instead of relying on filter
// metadata. This covers shared-pipeline renderers, older self-contained GL
// renderers, and worker-safe OffscreenCanvas implementations alike. A compile
// attempt lets us attribute an exception to GL even when drawing never starts.
let shaderCompiles = 0;
let programLinks = 0;
let drawCalls = 0;
const shaderFailureLogs: string[] = [];

const installGLCallTracking = (): void => {
  const proto = WebGL2RenderingContext.prototype;
  const compileShader = proto.compileShader;
  const linkProgram = proto.linkProgram;
  const drawArrays = proto.drawArrays;
  proto.compileShader = function trackedCompileShader(shader: WebGLShader): void {
    shaderCompiles += 1;
    compileShader.call(this, shader);
    if (!this.getShaderParameter(shader, this.COMPILE_STATUS)) {
      shaderFailureLogs.push(`compile: ${this.getShaderInfoLog(shader) || "no driver log"}`);
    }
  };
  proto.linkProgram = function trackedLinkProgram(program: WebGLProgram): void {
    programLinks += 1;
    linkProgram.call(this, program);
    if (!this.getProgramParameter(program, this.LINK_STATUS)) {
      shaderFailureLogs.push(`link: ${this.getProgramInfoLog(program) || "no driver log"}`);
    }
  };
  proto.drawArrays = function trackedDrawArrays(mode: number, first: number, count: number): void {
    drawCalls += 1;
    drawArrays.call(this, mode, first, count);
  };
};

const runtimeOptions = (): Record<string, unknown> => {
  const input = makeGradientCanvas(16, 16);
  const ctx = input.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("temporal fixture has no 2d context");
  const previous = ctx.getImageData(0, 0, input.width, input.height).data;
  // An inverted previous frame activates motion/EMA shaders instead of merely
  // compiling their idle passthrough. Keeping spatial detail avoids falsely
  // diagnosing filters that intentionally render history as black-frame bugs.
  for (let i = 0; i < previous.length; i += 4) {
    previous[i] = 255 - previous[i];
    previous[i + 1] = 255 - previous[i + 1];
    previous[i + 2] = 255 - previous[i + 2];
    previous[i + 3] = 255;
  }
  return {
    _webglAcceleration: true,
    _wasmAcceleration: false,
    _frameIndex: 2,
    _isAnimating: true,
    _prevInput: previous.slice(),
    _prevOutput: previous.slice(),
    _ema: Float32Array.from(previous),
  };
};

// A few filters have a meaningful GL path that their UI default deliberately
// leaves idle. These fixtures activate the real shader contract; they are not
// output snapshots or implementation-specific source assertions.
const shaderValidationOverrides = (
  name: string,
  defaults: Record<string, unknown>,
): Record<string, unknown> => {
  if (name === "Quantize") {
    const palette = defaults.palette as Record<string, unknown> | undefined;
    return {
      palette: {
        ...palette,
        options: {
          ...((palette?.options as Record<string, unknown> | undefined) ?? {}),
          colors: [[0, 0, 0], [255, 255, 255], [255, 64, 32]],
          colorDistanceAlgorithm: "RGB",
        },
      },
    };
  }
  if (name === "CRT Degauss") {
    return { triggerMode: "MOTION", triggerThreshold: 0.01 };
  }
  return {};
};

const outputScaleFor = (name: string): number =>
  name === "Pixel Art Upscale" ? 2 : 1;

const STRICT_SPEC_FILTERS = new Set([
  "Apollo Slow-Scan TV",
  "Gameboy Camera",
  "PAL / SECAM",
  "Teletext",
  "Wavelet Codec",
]);

type RunResult =
  | { ok: true; attemptedGL: boolean; drewGL: boolean }
  | { ok: false; attemptedGL: boolean; drewGL: boolean; reason: string };

const runOne = (
  filter: FilterLike,
  options: Record<string, unknown>,
  requireDynamicRange = false,
  requireGLDraw = false,
  outputScale = 1,
  requireVisibleOutput = true,
  inputWidth = 16,
  inputHeight = inputWidth,
  inputFactory: (width: number, height: number) => HTMLCanvasElement = makeGradientCanvas,
): RunResult => {
  const compilesBefore = shaderCompiles;
  const drawsBefore = drawCalls;
  const failuresBefore = shaderFailureLogs.length;
  const result = (ok: boolean, reason?: string): RunResult => {
    const attemptedGL = shaderCompiles > compilesBefore || drawCalls > drawsBefore;
    const drewGL = drawCalls > drawsBefore;
    if (ok) return { ok: true, attemptedGL, drewGL };
    return { ok: false, attemptedGL, drewGL, reason: reason ?? "unknown failure" };
  };
  const input = inputFactory(inputWidth, inputHeight);
  let output: unknown;
  try {
    output = filter.func(input, options);
  } catch (e) {
    return result(false, `threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (shaderFailureLogs.length > failuresBefore) {
    const logs = shaderFailureLogs.slice(failuresBefore).join(" | ");
    return result(false, `shader compile/link failure: ${logs}`);
  }
  if (requireGLDraw && drawCalls === drawsBefore) {
    return result(false, "declares requiresGL but issued no WebGL draw (silent fallback)");
  }
  if (!output || typeof (output as { getContext?: unknown }).getContext !== "function") {
    return result(false, `returned non-canvas: ${typeof output}`);
  }
  const canvas = output as HTMLCanvasElement;
  const expectedWidth = inputWidth * outputScale;
  const expectedHeight = inputHeight * outputScale;
  if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
    return result(false, `size drift ${canvas.width}x${canvas.height} (expected ${expectedWidth}x${expectedHeight})`);
  }
  if (requireVisibleOutput) {
    const a = maxAlpha(canvas);
    if (a <= 100) {
      return result(false, `maxAlpha=${a} (expected > 100, a linearize bug likely)`);
    }
    const peak = peakLuma(canvas);
    if (peak < 8) {
      return result(false, `peakLuma=${peak.toFixed(2)} (opaque black output)`);
    }
  }
  if (requireDynamicRange) {
    const range = lumaRange(canvas);
    if (range < 8) return result(false, `lumaRange=${range.toFixed(2)} (black/flat output)`);
  }
  return result(true);
};

const runIdentity = (
  filter: FilterLike,
  options: Record<string, unknown>,
  tolerance: number,
): { ok: true } | { ok: false; reason: string } => {
  const input = makeGradientCanvas(32, 32);
  const inputPixels = input.getContext("2d", { willReadFrequently: true })
    ?.getImageData(0, 0, 32, 32).data;
  const drawsBefore = drawCalls;
  const failuresBefore = shaderFailureLogs.length;
  let output: HTMLCanvasElement;
  try {
    output = filter.func(input, options) as HTMLCanvasElement;
  } catch (error) {
    return { ok: false, reason: `threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (shaderFailureLogs.length > failuresBefore) {
    return { ok: false, reason: `shader failure: ${shaderFailureLogs.slice(failuresBefore).join(" | ")}` };
  }
  if (drawCalls === drawsBefore) return { ok: false, reason: "issued no WebGL draw" };
  const outputPixels = output.getContext("2d", { willReadFrequently: true })
    ?.getImageData(0, 0, 32, 32).data;
  if (!inputPixels || !outputPixels || inputPixels.length !== outputPixels.length) {
    return { ok: false, reason: "pixel readback failed or changed size" };
  }
  let maximumDelta = 0;
  for (let i = 0; i < inputPixels.length; i++) {
    maximumDelta = Math.max(maximumDelta, Math.abs(inputPixels[i] - outputPixels[i]));
  }
  return maximumDelta <= tolerance
    ? { ok: true }
    : { ok: false, reason: `max channel delta=${maximumDelta} (expected <=${tolerance})` };
};

const runEquivalent = (
  filter: FilterLike,
  leftOptions: Record<string, unknown>,
  rightOptions: Record<string, unknown>,
  tolerance: number,
): { ok: true } | { ok: false; reason: string } => {
  const render = (options: Record<string, unknown>): HTMLCanvasElement | null => {
    try {
      return filter.func(makeGradientCanvas(32, 32), options) as HTMLCanvasElement;
    } catch {
      return null;
    }
  };
  const left = render(leftOptions);
  const right = render(rightOptions);
  const leftContext = left?.getContext("2d", { willReadFrequently: true });
  const rightContext = right?.getContext("2d", { willReadFrequently: true });
  if (!leftContext || !rightContext) return { ok: false, reason: "render or readback failed" };
  const leftPixels = leftContext.getImageData(0, 0, 32, 32).data;
  const rightPixels = rightContext.getImageData(0, 0, 32, 32).data;
  let maximumDelta = 0;
  for (let i = 0; i < leftPixels.length; i++) {
    maximumDelta = Math.max(maximumDelta, Math.abs(leftPixels[i] - rightPixels[i]));
  }
  return maximumDelta <= tolerance
    ? { ok: true }
    : { ok: false, reason: `max channel delta=${maximumDelta} (expected <=${tolerance})` };
};

const runTeletextRepeatConcealment = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Teletext"] as FilterLike;
  const width = 400;
  const height = 240;
  const input = document.createElement("canvas");
  input.width = width;
  input.height = height;
  const inputContext = input.getContext("2d");
  if (!inputContext) return { ok: false, reason: "input has no 2d context" };
  inputContext.fillStyle = "white";
  inputContext.fillRect(0, 0, width, height);

  const render = (concealment: "BLANK" | "REPEAT"): HTMLCanvasElement | null => {
    try {
      return filter.func(input, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        bitErrorRate: 0.05,
        burstErrors: 0,
        concealment,
        randomSeed: 60,
      }) as HTMLCanvasElement;
    } catch {
      return null;
    }
  };
  const blank = render("BLANK");
  const repeat = render("REPEAT");
  const blankContext = blank?.getContext("2d", { willReadFrequently: true });
  const repeatContext = repeat?.getContext("2d", { willReadFrequently: true });
  if (!blankContext || !repeatContext) {
    return { ok: false, reason: "concealment render or readback failed" };
  }
  const blankPixels = blankContext.getImageData(0, 0, width, height).data;
  const repeatPixels = repeatContext.getImageData(0, 0, width, height).data;
  const darkCells = (pixels: Uint8ClampedArray, row: number): number => {
    let dark = 0;
    for (let column = 0; column < 40; column++) {
      const x = column * 10 + 2;
      const y = row * 10 + 1;
      const index = (y * width + x) * 4;
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] < 96) dark += 1;
    }
    return dark;
  };
  for (let row = 1; row < 24; row++) {
    const blankDark = darkCells(blankPixels, row);
    if (blankDark >= 30 && darkCells(repeatPixels, row) < 20) return { ok: true };
  }
  return { ok: false, reason: "a damaged packet row was not visibly restored from its prior row" };
};

const runPalDelayLineCancellation = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["PAL / SECAM"] as FilterLike;
  const width = 64;
  const height = 32;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) return { ok: false, reason: "PAL fixture has no 2d context" };
  sourceContext.fillStyle = "rgb(220, 54, 160)";
  sourceContext.fillRect(0, 0, width, height);

  const render = (delayLine: boolean): Uint8ClampedArray | null => {
    try {
      const output = filter.func(source, {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        system: "PAL",
        phaseError: 45,
        tuningError: 0,
        delayLine,
        crossColor: 0,
        crossLuma: 0,
        channelNoise: 0,
        interlace: false,
      }) as HTMLCanvasElement;
      return output.getContext("2d", { willReadFrequently: true })
        ?.getImageData(0, 0, width, height).data ?? null;
    } catch {
      return null;
    }
  };
  const withoutDelay = render(false);
  const withDelay = render(true);
  if (!withoutDelay || !withDelay) return { ok: false, reason: "PAL cancellation render/readback failed" };

  const adjacentLineError = (pixels: Uint8ClampedArray): number => {
    let total = 0;
    let samples = 0;
    for (let y = 1; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const current = (y * width + x) * 4;
        const previous = ((y - 1) * width + x) * 4;
        total += Math.abs(pixels[current] - pixels[previous]);
        total += Math.abs(pixels[current + 1] - pixels[previous + 1]);
        total += Math.abs(pixels[current + 2] - pixels[previous + 2]);
        samples += 3;
      }
    }
    return total / samples;
  };
  const uncorrected = adjacentLineError(withoutDelay);
  const corrected = adjacentLineError(withDelay);
  return uncorrected > 4 && corrected < uncorrected * 0.25
    ? { ok: true }
    : { ok: false, reason: `PAL delay line did not cancel alternating phase error (${uncorrected.toFixed(2)} -> ${corrected.toFixed(2)})` };
};

const makeSolidCanvas = (width: number, height: number, value: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("solid fixture has no 2d context");
  context.fillStyle = `rgb(${value}, ${value}, ${value})`;
  context.fillRect(0, 0, width, height);
  return canvas;
};

const canvasPixels = (canvas: HTMLCanvasElement): Uint8ClampedArray | null =>
  canvas.getContext("2d", { willReadFrequently: true })
    ?.getImageData(0, 0, canvas.width, canvas.height).data.slice() ?? null;

const runApolloFractionalHold = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Apollo Slow-Scan TV"] as FilterLike;
  const options = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    mode: "320_10",
    animSpeed: 15,
    phosphorPersistence: 0,
    vidiconLag: 0,
    vidiconBloom: 0,
    discHold: true,
    interlace: false,
    rfNoise: 0,
    syncError: 0,
    palette: { ...nearest, options: { levels: 256 } },
  };
  let previous: Uint8ClampedArray | null = null;
  const frames: Uint8ClampedArray[] = [];
  for (const [frame, value] of [40, 120, 220].entries()) {
    try {
      const output = filter.func(makeSolidCanvas(32, 24, value), {
        ...options,
        _frameIndex: frame,
        _prevOutput: previous,
      }) as HTMLCanvasElement;
      const pixels = canvasPixels(output);
      if (!pixels) return { ok: false, reason: `Apollo frame ${frame} readback failed` };
      frames.push(pixels);
      previous = pixels;
    } catch (error) {
      return { ok: false, reason: `Apollo fractional hold threw: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const maximumDelta = (left: Uint8ClampedArray, right: Uint8ClampedArray): number => {
    let delta = 0;
    for (let i = 0; i < left.length; i++) delta = Math.max(delta, Math.abs(left[i] - right[i]));
    return delta;
  };
  const heldDelta = maximumDelta(frames[0], frames[1]);
  const newPictureDelta = maximumDelta(frames[1], frames[2]);
  return heldDelta <= 1 && newPictureDelta > 50
    ? { ok: true }
    : { ok: false, reason: `Apollo 15 fps hold sequence was wrong (held=${heldDelta}, new=${newPictureDelta})` };
};

const runGameboyThresholdMatrix = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Gameboy Camera"] as FilterLike;
  let pixels: Uint8ClampedArray | null;
  try {
    const output = filter.func(makeSolidCanvas(64, 56, 128), {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      resolution: 64,
      contrast: 1,
      exposure: 1,
      gain: 1,
      bias: 0,
      invertSensor: false,
      edgeMode: "OFF",
      sensorNoise: 0,
      ditherStrength: 1,
      palette: { ...nearest, options: { levels: 256 } },
    }) as HTMLCanvasElement;
    pixels = canvasPixels(output);
  } catch (error) {
    return { ok: false, reason: `Game Boy matrix render threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!pixels) return { ok: false, reason: "Game Boy matrix readback failed" };
  const colorAt = (x: number, y: number): string => {
    const index = (y * 64 + x) * 4;
    return `${pixels?.[index]},${pixels?.[index + 1]},${pixels?.[index + 2]}`;
  };
  let hasFourPixelRepeat = true;
  let differsAtTwo = false;
  const colors = new Set<string>();
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const color = colorAt(x, y);
      colors.add(color);
      if (color !== colorAt(x + 4, y) || color !== colorAt(x, y + 4)) hasFourPixelRepeat = false;
      if (color !== colorAt((x + 2) % 4, y) || color !== colorAt(x, (y + 2) % 4)) differsAtTwo = true;
    }
  }
  return hasFourPixelRepeat && differsAtTwo && colors.size >= 2
    ? { ok: true }
    : { ok: false, reason: `Game Boy threshold tile was not genuinely 4x4 (repeat=${hasFourPixelRepeat}, differsAt2=${differsAtTwo}, colors=${colors.size})` };
};

const warmTemporalState = (
  filter: FilterLike,
  options: Record<string, unknown>,
): { ok: true } | { ok: false; reason: string } => {
  const failuresBefore = shaderFailureLogs.length;
  try {
    filter.func(makeGradientCanvas(16, 16), options);
  } catch (error) {
    return {
      ok: false,
      reason: `temporal warm-up threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (shaderFailureLogs.length > failuresBefore) {
    return {
      ok: false,
      reason: `temporal warm-up shader failure: ${shaderFailureLogs.slice(failuresBefore).join(" | ")}`,
    };
  }
  return { ok: true };
};

// Yield every alternate enum value (i.e. everything except the current default)
// as { optionKey, label, overrideValue } triples, so the main loop can build
// option objects and tag failures with the specific branch that broke.
const enumBranches = (
  filter: FilterLike,
): { key: string; label: string; value: unknown }[] => {
  const out: { key: string; label: string; value: unknown }[] = [];
  const defs = filter.optionTypes;
  const defaults = filter.defaults ?? {};
  if (!defs) return out;
  for (const [key, spec] of Object.entries(defs)) {
    if (spec?.type !== ENUM || !Array.isArray(spec.options)) continue;
    const currentDefault = defaults[key];
    for (const entry of spec.options) {
      if (entry.value === currentDefault) continue;
      out.push({ key, label: String(entry.value), value: entry.value });
    }
  }
  return out;
};

// CPU filters already run every scalar boundary in filterOptionConformance.
// GL-capable filters need the same persisted-option contract in a real browser,
// where the values also reach actual uniform uploads and shader draws. Two
// combined profiles keep this gate bounded while covering cross-option states.
const scalarProfiles = (
  filter: FilterLike,
): { label: string; values: Record<string, unknown> }[] => {
  const minimum: Record<string, unknown> = {};
  const maximum: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(filter.optionTypes ?? {})) {
    if (spec.type === BOOL) {
      minimum[key] = false;
      maximum[key] = true;
    } else if (spec.type === RANGE && spec.range) {
      minimum[key] = spec.range[0];
      maximum[key] = spec.range[1];
    }
  }
  if (Object.keys(minimum).length === 0) return [];
  return [
    { label: "scalar-minimum-disabled", values: minimum },
    { label: "scalar-maximum-enabled", values: maximum },
  ];
};

const hasPaletteControl = (filter: FilterLike): boolean =>
  Object.values(filter.optionTypes ?? {}).some((spec) => spec.type === PALETTE);

const scalarOptionKeys = (filter: FilterLike): string[] =>
  Object.entries(filter.optionTypes ?? {})
    .filter(([, spec]) => spec.type === BOOL || spec.type === RANGE)
    .map(([key]) => key);

const enumOptionKeys = (filter: FilterLike): string[] =>
  Object.entries(filter.optionTypes ?? {})
    .filter(([, spec]) => spec.type === ENUM)
    .map(([key]) => key);

// These controls size lookup structures or carry structured enum payloads.
// The app's existing state migration restores them before filter dispatch.
const migratedScalarDefaults = new Set([
  "Contour Map",
  "Palette Mapper",
  "Voronoi",
  "Thermal camera",
  // VHS has bespoke missing-option profiles for every control added after its
  // original schema. Removing all historical scalars creates no real saved
  // state and feeds deliberately invalid uniforms to its fallback probe.
  "VHS / NTSC",
]);

const migratedEnumDefaults = new Set([
  "Anaglyph:depthSource",
  "Convolve:kernel",
]);

const main = async () => {
  installGLCallTracking();
  if (!glAvailable()) {
    const details = { reason: "WebGL2 unavailable in this browser" };
    if (statusNode) statusNode.textContent = "failed";
    if (detailsNode) detailsNode.textContent = JSON.stringify(details, null, 2);
    window.__glSmokeResult = { status: "failed", passed: 0, failed: 0, skipped: 0, glFilters: 0, requiredGLFilters: 0, shaderCompiles, programLinks, shaderFailures: shaderFailureLogs.length, drawCalls, failures: [{ name: "<runtime>", mode: "init", reason: details.reason }] };
    return;
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let requiredGLFilters = 0;
  const glFilterNames = new Set<string>();
  const failures: { name: string; mode: string; reason: string }[] = [];

  const record = (
    name: string,
    mode: string,
    result: { ok: true } | { ok: false; reason: string },
  ) => {
    if (result.ok) passed += 1;
    else { failed += 1; failures.push({ name, mode, reason: result.reason }); }
  };

  // Stub plate contract: amber-on-dark, fully opaque, correct size. Only
  // observable where a real 2d rasteriser exists (not jsdom), so the check
  // lives here next to the filter sweep.
  {
    const stub = glUnavailableStub(48, 32) as HTMLCanvasElement;
    const check = ((): { ok: true } | { ok: false; reason: string } => {
      if (stub.width !== 48 || stub.height !== 32) {
        return { ok: false, reason: `stub size drift ${stub.width}x${stub.height}` };
      }
      const ctx = stub.getContext("2d");
      if (!ctx) return { ok: false, reason: "stub has no 2d context" };
      const pixels = ctx.getImageData(0, 0, stub.width, stub.height).data;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 255) return { ok: false, reason: `stub alpha=${pixels[i]} at idx ${i}` };
      }
      const corner = (x: number, y: number) => {
        const idx = (y * stub.width + x) * 4;
        return [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
      };
      const plate = corner(1, 1);
      if (plate[0] !== 26 || plate[1] !== 26 || plate[2] !== 26) {
        return { ok: false, reason: `stub plate=${plate.join(",")} (expected 26,26,26)` };
      }
      let sawAmber = false;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (r > 180 && g > 100 && g < 220 && b < 120) { sawAmber = true; break; }
      }
      if (!sawAmber) return { ok: false, reason: "stub amber text missing" };
      return { ok: true };
    })();
    record("<glUnavailableStub>", "plate", check);
  }

  for (const [name, filter] of Object.entries(filterIndex)) {
    const f = filter as FilterLike;
    if (f.requiresGL) requiredGLFilters += 1;
    const defaults = (f.defaults as Record<string, unknown>) ?? {};
    const activated = shaderValidationOverrides(name, defaults);
    const scale = outputScaleFor(name);
    const requireDynamicRange = name === "VHS / NTSC" || STRICT_SPEC_FILTERS.has(name);
    if (f.temporal) {
      const warmup0 = warmTemporalState(f, {
        ...defaults,
        ...activated,
        ...runtimeOptions(),
        _frameIndex: 0,
      });
      if (!warmup0.ok) {
        record(name, "warmup-frame-0", warmup0);
        continue;
      }
      const warmup1 = warmTemporalState(f, {
        ...defaults,
        ...activated,
        ...runtimeOptions(),
        _frameIndex: 1,
      });
      if (!warmup1.ok) {
        record(name, "warmup-frame-1", warmup1);
        continue;
      }
    }
    const defaultResult = runOne(
      f,
      { ...defaults, ...activated, ...runtimeOptions() },
      requireDynamicRange,
      f.requiresGL,
      scale,
    );

    // A CPU-only filter is just a discovery miss, not a GL validation result.
    // Exceptions from one are covered by the normal filter tests. If it tried
    // to compile or draw, however, it belongs to this gate and must pass.
    if (!f.requiresGL && !defaultResult.attemptedGL) {
      skipped += 1;
      continue;
    }

    glFilterNames.add(name);
    record(name, "default", defaultResult);
    if (!defaultResult.ok) continue;

    if (!f.requiresGL) {
      record(name, "webgl-acceleration-disabled", runOne(
        f,
        {
          ...defaults,
          ...activated,
          ...runtimeOptions(),
          _webglAcceleration: false,
        },
        false,
        false,
        scale,
      ));
    }

    record(name, "linearize", runOne(
      f,
      { ...defaults, ...activated, ...runtimeOptions(), _linearize: true },
      requireDynamicRange,
      true,
      scale,
    ));

    if (name === "Teletext") {
      record(name, "oversized-49px-cells", runOne(
        f,
        { ...defaults, ...runtimeOptions() },
        true,
        true,
        1,
        true,
        1960,
        24,
      ));
      record(name, "repeat-row-concealment", runTeletextRepeatConcealment());
    }
    if (name === "PAL / SECAM") {
      record(name, "delay-line-phase-cancellation", runPalDelayLineCancellation());
    }
    if (name === "Gameboy Camera") {
      record(name, "4x4-controller-threshold-matrix", runGameboyThresholdMatrix());
      record(name, "malformed-state-falls-back", runEquivalent(
        f,
        { ...defaults, ...runtimeOptions() },
        {
          ...defaults,
          ...runtimeOptions(),
          invertSensor: "false",
          edgeMode: "INVALID",
        },
        1,
      ));
      record(name, "extreme-wide-aspect", runOne(
        f,
        { ...defaults, ...runtimeOptions() },
        true,
        true,
        1,
        true,
        2048,
        2,
        makeSmoothRamp,
      ));
    }
    if (name === "Apollo Slow-Scan TV") {
      record(name, "fractional-preview-disc-hold", runApolloFractionalHold());
    }
    if (name === "Wavelet Codec") {
      record(name, "53-profile-lossless-settings", runIdentity(f, {
        ...defaults,
        ...runtimeOptions(),
        transform: "REVERSIBLE_53",
        channels: "RGB",
        quality: 100,
        detailLoss: 0,
        bitplaneDrop: 0,
        codeblockLoss: 0,
        ringing: 0,
      }, 1));
    }

    for (const branch of enumBranches(f)) {
      const options = { ...defaults, ...activated, ...runtimeOptions(), [branch.key]: branch.value };
      record(name, `${branch.key}=${branch.label}`, runOne(
        f,
        options,
        requireDynamicRange,
        true,
        scale,
      ));
    }
    for (const profile of scalarProfiles(f)) {
      record(name, profile.label, runOne(
        f,
        { ...defaults, ...activated, ...runtimeOptions(), ...profile.values },
        false,
        false,
        scale,
        false,
      ));
    }
    const scalarKeys = scalarOptionKeys(f);
    if (scalarKeys.length > 0 && !migratedScalarDefaults.has(name)) {
      const legacyOptions = { ...defaults, ...activated, ...runtimeOptions() };
      for (const key of scalarKeys) delete legacyOptions[key];
      const strictState = STRICT_SPEC_FILTERS.has(name);
      record(name, "legacy-state-without-scalars", runOne(
        f,
        legacyOptions,
        strictState,
        strictState,
        scale,
        strictState,
      ));
    }
    for (const key of enumOptionKeys(f)) {
      if (migratedEnumDefaults.has(`${name}:${key}`)) continue;
      const legacyOptions = { ...defaults, ...activated, ...runtimeOptions() };
      delete legacyOptions[key];
      const strictState = STRICT_SPEC_FILTERS.has(name);
      record(name, `legacy-state-without-${key}`, runOne(
        f,
        legacyOptions,
        strictState,
        strictState,
        scale,
        strictState,
      ));
    }
    if (hasPaletteControl(f) && name !== "Quantize") {
      record(name, "non-identity-palette", runOne(
        f,
        {
          ...defaults,
          ...activated,
          ...runtimeOptions(),
          palette: { ...nearest, options: { levels: 2 } },
        },
        false,
        true,
        scale,
        false,
      ));
    }
    if (hasPaletteControl(f)) {
      const customPalette = {
        ...user,
        options: {
          ...user.options,
          colors: [[0, 0, 0, 255], [255, 255, 255, 255], [255, 64, 32, 255]],
          colorDistanceAlgorithm: "RGB",
        },
      };
      record(name, "custom-palette", runOne(
        f,
        { ...defaults, ...activated, ...runtimeOptions(), palette: customPalette },
        false,
        true,
        scale,
        false,
      ));
      record(name, "custom-palette-linearized", runOne(
        f,
        {
          ...defaults,
          ...activated,
          ...runtimeOptions(),
          palette: customPalette,
          _linearize: true,
        },
        false,
        true,
        scale,
        false,
      ));
    }
    if (name === "VHS / NTSC") {
      for (const key of ["tapeSharpness", "ringingFrequency", "ringingPower"]) {
        const legacyOptions = { ...defaults, ...runtimeOptions() };
        delete legacyOptions[key];
        record(name, `legacy-state-without-${key}`, runOne(f, legacyOptions, true, true));
      }
      const floatCapable = Boolean(getGLCtx()?.gl.getExtension("EXT_color_buffer_float"));
      if (floatCapable && !vhsNtscGLUsingFloatPath()) {
        record(name, "RGBA16F-capability-selection", {
          ok: false,
          reason: "EXT_color_buffer_float is available but the RGBA8 fallback was used",
        });
      }
    }
  }

  record("rgbStripe", "worker", await runWorkerCrt());
  record("specification filters", "worker-and-temporal-state", await runWorkerSpecFilters());
  record("Ordered", "nearest-palette-levels", runOrderedPaletteLevels());
  record("Ordered", "oklab-palette", runOrderedOklabPalette());
  record("Quantize", "palette-subset", runQuantizePaletteSubset());
  record("CMYK Halftone", "screen-angles", runCmykAngles());
  record("Median Cut", "backend-agreement", runMedianCutBackendAgreement());
  record("Triangle dither", "seeded-noise", runTriangleDitherSeed());
  record("Halftone", "backend-liveness", runHalftoneBackends());
  record("pipeline", "linearize-is-live", runLinearizeIsLive());

  const status: "ok" | "failed" = failed === 0 ? "ok" : "failed";
  const details = {
    passed,
    failed,
    skipped,
    glFilters: glFilterNames.size,
    requiredGLFilters,
    shaderCompiles,
    programLinks,
    shaderFailures: shaderFailureLogs.length,
    drawCalls,
    failures,
  };
  if (statusNode) statusNode.textContent = status;
  if (detailsNode) detailsNode.textContent = JSON.stringify(details, null, 2);
  window.__glSmokeResult = { status, ...details };
};

void main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  if (statusNode) statusNode.textContent = "failed";
  if (detailsNode) detailsNode.textContent = JSON.stringify({ reason }, null, 2);
  window.__glSmokeResult = { status: "failed", passed: 0, failed: 0, skipped: 0, glFilters: 0, requiredGLFilters: 0, shaderCompiles, programLinks, shaderFailures: shaderFailureLogs.length, drawCalls, failures: [{ name: "<runtime>", mode: "boot", reason }] };
  console.error("GL smoke failed:", error);
});
