import { filterIndex, serializePalette } from "@gyng/ditherer-filters";
import { workerRPC } from "@gyng/ditherer-filters/client";
import { makeGradientCanvas, makeSmoothRamp } from "../fixtures";
import { shaderValidationOverrides } from "../profiles";

export const runWorkerCrt = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
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

export const runWorkerSpecFilters = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
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
export const runQuantizePaletteSubset = (): { ok: true } | { ok: false; reason: string } => {
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
export const runCmykAngles = (): { ok: true } | { ok: false; reason: string } => {
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
export const runMedianCutBackendAgreement = (): { ok: true } | { ok: false; reason: string } => {
  const filter = filterIndex["Median Cut"];
  if (!filter) return { ok: false, reason: "Median Cut not in registry" };
  const render = (webgl: boolean, levels: number): Uint8ClampedArray | null => {
    const source = makeGradientCanvas(24, 24);
    const output = filter.func(source, {
      ...(filter.defaults ?? {}),
      levels,
      sampleRate: 1,
      _linearize: false,
      _webglAcceleration: webgl,
    }) as HTMLCanvasElement;
    return output.getContext("2d", { willReadFrequently: true })
      ?.getImageData(0, 0, output.width, output.height).data ?? null;
  };

  for (const levels of [7, 8, 13]) {
    const gpu = render(true, levels);
    const cpu = render(false, levels);
    if (!gpu || !cpu) return { ok: false, reason: `Median Cut readback failed at ${levels} colors` };

    let mismatched = 0;
    let firstExample = "";
    const cpuColors = new Set<string>();
    for (let i = 0; i < cpu.length; i += 4) {
      cpuColors.add(`${cpu[i]},${cpu[i + 1]},${cpu[i + 2]}`);
      if (gpu[i] !== cpu[i] || gpu[i + 1] !== cpu[i + 1] || gpu[i + 2] !== cpu[i + 2]) {
        mismatched += 1;
        if (!firstExample) {
          const p = i / 4;
          firstExample = `px ${p % 24},${Math.floor(p / 24)}: gl=${gpu[i]},${gpu[i + 1]},${gpu[i + 2]} cpu=${cpu[i]},${cpu[i + 1]},${cpu[i + 2]}`;
        }
      }
    }
    if (cpuColors.size > levels) {
      return { ok: false, reason: `Median Cut emitted ${cpuColors.size} colors for a ${levels}-color maximum` };
    }
    if (mismatched > 0) {
      return {
        ok: false,
        reason: `Median Cut backends disagree at ${levels} colors on ${mismatched} px — ${firstExample}`,
      };
    }
    // Guard the guard: if the GL path silently fell back to JS, both renders
    // would be the JS one and agreement would be meaningless.
    const changed = cpu.some((v, i) => i % 4 !== 3 && v !== 0);
    if (!changed) return { ok: false, reason: `Median Cut produced an empty render at ${levels} colors` };
  }
  return { ok: true };
};

// Triangle dither used to seed its TPDF noise from Math.random(), so the same
// still rendered differently every time and nothing could pin it. Now that the
// seed is derived, assert the three things that buys us: reproducibility, that
// the seed actually reaches the shader, and that it still quantises.
export const runTriangleDitherSeed = (): { ok: true } | { ok: false; reason: string } => {
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
export const runHalftoneBackends = (): { ok: true } | { ok: false; reason: string } => {
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
  // Halftone's GL path now honours _linearize: it block-averages each cell (a
  // stride sample of the whole cell) and, under _linearize, averages in linear
  // light and quantises in sRGB to match the JS path — so the toggle changes the
  // dot tone under WebGL2 as it does on CPU. (Previously pinned knownDead when
  // the GL path point-sampled the cell centre in gamma.)
  { name: "Halftone" },
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

export const runLinearizeIsLive = (): { ok: true } | { ok: false; reason: string } => {
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
export const runOrderedOklabPalette = (): { ok: true } | { ok: false; reason: string } => {
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

export const runOrderedPaletteLevels = (): { ok: true } | { ok: false; reason: string } => {
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

// A few filters have a meaningful GL path that their UI default deliberately
// leaves idle. These fixtures activate the real shader contract; they are not
// output snapshots or implementation-specific source assertions.
