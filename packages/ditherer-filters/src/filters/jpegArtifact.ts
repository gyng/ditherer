import { BOOL, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "./types";
import { nearest } from "../palettes/index";
import { logFilterBackend, releasePooledCanvas } from "../utils/index";
import { applyPaletteToBuffer, paletteIsIdentity } from "../palettes/backend";
import { renderJpegArtifactGL } from "./jpegArtifactGL";
import { glUnavailableStub } from "../gl/index";

// Match the JS qualityScale helper so the GL path can share the same logic
// and only upload the scaled values to the shader.
const qualityScaleShared = (quality: number): number => {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  return Math.max(0.01, scale / 100);
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type JpegArtifactPalette = {
  options?: FilterOptionValues;
} & Record<string, unknown>;

type JpegArtifactOptions = FilterOptionValues & {
  qualityLuma?: number;
  qualityChroma?: number;
  quality?: number;
  subsampling?: string;
  blockSize?: number;
  ringing?: number;
  mosquito?: number;
  gridJitter?: number;
  corruptBurstChance?: number;
  deblock?: number;
  temporalHold?: number;
  keyframeInterval?: number;
  preserveAlpha?: boolean;
  palette?: JpegArtifactPalette;
  _prevOutput?: Uint8ClampedArray | null;
  _frameIndex?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object";

export const optionTypes = {
  qualityLuma: {
    type: RANGE,
    range: [1, 100],
    step: 1,
    default: 28,
    desc: "Luma quantization quality — lower values produce harsher block loss",
  },
  qualityChroma: {
    type: RANGE,
    range: [1, 100],
    step: 1,
    default: 16,
    desc: "Chroma quantization quality — lower values cause color bleed and smearing",
  },
  subsampling: {
    type: ENUM,
    default: "420",
    options: [
      { name: "4:4:4 (none)", value: "444" },
      { name: "4:2:2", value: "422" },
      { name: "4:2:0", value: "420" },
    ],
    desc: "Chroma resolution: full, half-horizontal, or half-horizontal-and-vertical",
  },
  blockSize: {
    type: RANGE,
    range: [8, 64],
    step: 8,
    default: 16,
    desc: "Macroblock size controlling burst grouping and temporal hold regions",
  },
  ringing: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.25,
    desc: "Sharpened edge overshoot around blocks (ringing)",
  },
  mosquito: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.2,
    desc: "Edge-adjacent chroma/luma noise similar to mosquito artifacts",
  },
  gridJitter: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.15,
    desc: "Per-macroblock quantization jitter for unstable decode grid",
  },
  corruptBurstChance: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.12,
    desc: "Probability that a macroblock enters severe corruption",
  },
  deblock: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.08,
    desc: "Post-pass seam softening across 8x8 boundaries",
  },
  temporalHold: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.1,
    desc: "Hold previous corrupted macroblocks between keyframes (P-frame smear)",
  },
  keyframeInterval: {
    type: RANGE,
    range: [1, 60],
    step: 1,
    default: 12,
    desc: "Every Nth frame refreshes all macroblocks from current input",
  },
  preserveAlpha: { type: BOOL, default: true, desc: "Preserve source alpha channel" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  qualityLuma: optionTypes.qualityLuma.default,
  qualityChroma: optionTypes.qualityChroma.default,
  subsampling: optionTypes.subsampling.default,
  blockSize: optionTypes.blockSize.default,
  ringing: optionTypes.ringing.default,
  mosquito: optionTypes.mosquito.default,
  gridJitter: optionTypes.gridJitter.default,
  corruptBurstChance: optionTypes.corruptBurstChance.default,
  deblock: optionTypes.deblock.default,
  temporalHold: optionTypes.temporalHold.default,
  keyframeInterval: optionTypes.keyframeInterval.default,
  preserveAlpha: optionTypes.preserveAlpha.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

export const tryApplyJpegArtifactToCanvas = (
  input: any,
  options: JpegArtifactOptions = defaults,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const palette = isRecord(options.palette) ? options.palette : defaults.palette;
  const paletteOptions = isRecord(palette.options) ? palette.options : defaults.palette.options;

  const safeOptions = {
    ...defaults,
    ...options,
    palette,
  };

  const safePalette = {
    ...defaults.palette,
    ...palette,
    options: {
      ...(defaults.palette?.options || {}),
      ...paletteOptions,
    },
  };

  const finite = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
  };
  const legacyQuality =
    options.quality === undefined ? null : finite(options.quality, defaults.qualityLuma, 1, 100);
  const qualityLuma = finite(options.qualityLuma ?? legacyQuality, defaults.qualityLuma, 1, 100);
  const qualityChroma = finite(
    options.qualityChroma ?? legacyQuality,
    defaults.qualityChroma,
    1,
    100,
  );
  const subsampling =
    safeOptions.subsampling === "444" || safeOptions.subsampling === "422"
      ? safeOptions.subsampling
      : "420";
  const blockSize = Math.max(
    8,
    Math.round(finite(safeOptions.blockSize, defaults.blockSize, 8, 64) / 8) * 8,
  );
  const ringing = finite(safeOptions.ringing, defaults.ringing, 0, 1);
  const mosquito = finite(safeOptions.mosquito, defaults.mosquito, 0, 1);
  const gridJitter = finite(safeOptions.gridJitter, defaults.gridJitter, 0, 1);
  const corruptBurstChance = finite(
    safeOptions.corruptBurstChance,
    defaults.corruptBurstChance,
    0,
    1,
  );
  const deblock = finite(safeOptions.deblock, defaults.deblock, 0, 1);
  const temporalHold = finite(safeOptions.temporalHold, defaults.temporalHold, 0, 1);
  const keyframeInterval = Math.max(
    1,
    Math.round(finite(safeOptions.keyframeInterval, defaults.keyframeInterval, 1, 60)),
  );
  const preserveAlpha = safeOptions.preserveAlpha !== false;

  const prevOutput = options._prevOutput instanceof Uint8ClampedArray ? options._prevOutput : null;
  const frameIndex = Number.isFinite(options._frameIndex) ? Number(options._frameIndex) : 0;

  const w = input.width;
  const h = input.height;

  const hasTemporal = (temporalHold ?? 0) > 0;
  const rendered = renderJpegArtifactGL(
    input,
    w,
    h,
    qualityScaleShared(qualityLuma),
    qualityScaleShared(qualityChroma),
    subsampling,
    gridJitter,
    corruptBurstChance,
    deblock,
    ringing,
    mosquito,
    frameIndex,
    preserveAlpha,
  );
  if (!rendered) return null;

  let transferred = false;
  try {
    const rCtx = (rendered as HTMLCanvasElement | OffscreenCanvas).getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    let appliedPalette = false;
    let appliedHold = false;
    if (rCtx) {
      const needPalette = !paletteIsIdentity(safePalette);
      const needHold = hasTemporal && prevOutput && prevOutput.length === w * h * 4;
      if (needPalette || needHold) {
        const pixels = rCtx.getImageData(0, 0, w, h).data;
        if (needPalette) {
          applyPaletteToBuffer(pixels, pixels, w, h, safePalette, true);
          appliedPalette = true;
        }
        if (needHold) {
          const kf = keyframeInterval;
          const isKeyframe = frameIndex % kf === 0;
          if (!isKeyframe) {
            const holdRng = mulberry32(frameIndex * 10007 + 17);
            const bs = blockSize;
            for (let by = 0; by < h; by += bs) {
              const yEnd = Math.min(h, by + bs);
              for (let bx = 0; bx < w; bx += bs) {
                if (holdRng() >= (temporalHold ?? 0)) continue;
                const xEnd = Math.min(w, bx + bs);
                for (let y = by; y < yEnd; y++) {
                  let idx = (y * w + bx) * 4;
                  for (let x = bx; x < xEnd; x++, idx += 4) {
                    pixels[idx] = prevOutput![idx] ?? 0;
                    pixels[idx + 1] = prevOutput![idx + 1] ?? 0;
                    pixels[idx + 2] = prevOutput![idx + 2] ?? 0;
                  }
                }
              }
            }
            appliedHold = true;
          }
        }
        rCtx.putImageData(new ImageData(pixels, w, h), 0, 0);
      }
    }
    const subNote = ` sub=${subsampling}`;
    const extras = `${appliedPalette ? "+palettePass" : ""}${appliedHold ? "+hold" : ""}`;
    logFilterBackend(
      "JPEG Artifact",
      "WebGL2",
      `qL=${qualityLuma} qC=${qualityChroma} block=${blockSize}${subNote}${extras}`,
    );
    transferred = true;
    return rendered;
  } finally {
    if (!transferred) releasePooledCanvas(rendered);
  }
};

export const applyJpegArtifactToCanvas = (
  input: any,
  options: JpegArtifactOptions = defaults,
): HTMLCanvasElement | OffscreenCanvas =>
  tryApplyJpegArtifactToCanvas(input, options) ?? glUnavailableStub(input.width, input.height);

const jpegArtifact = (input: any, options: JpegArtifactOptions = defaults) =>
  applyJpegArtifactToCanvas(input, options);

export default defineFilter({
  history: { prevOutput: true },
  name: "JPEG Artifact",
  func: jpegArtifact,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
  description:
    "Codec-style JPEG degradation with DCT quantization, chroma subsampling, and optional temporal hold corruption",
  temporal: true,
});
