import { BOOL, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  paletteGetColor,
  rgba,
  wasmJpegArtifactBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
  logFilterBackend,
  JPEG_SUBSAMPLING,
} from "utils";
import { applyPaletteToBuffer, paletteIsIdentity } from "palettes/backend";
import { jpegArtifactGLAvailable, renderJpegArtifactGL } from "./jpegArtifactGL";

// Match the JS qualityScale helper so the GL/WASM paths can share the same
// logic and only upload the scaled values to the shader.
const qualityScaleShared = (quality: number): number => {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  return Math.max(0.01, scale / 100);
};

const BLOCK = 8;
const INV_SQRT2 = 1 / Math.sqrt(2);
const readF32 = (buf: Float32Array, index: number) => buf[index] ?? 0;
const readU8 = (buf: Uint8ClampedArray, index: number) => buf[index] ?? 0;
const readQ = (table: number[], index: number) => table[index] ?? 1;
const readDct = (index: number) => DCT_C[index] ?? 0;

const LUMA_Q = [
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];

const CHROMA_Q = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
];

const DCT_C = new Float32Array(BLOCK * BLOCK);
for (let u = 0; u < BLOCK; u++) {
  const au = u === 0 ? INV_SQRT2 : 1;
  for (let x = 0; x < BLOCK; x++) {
    DCT_C[u * BLOCK + x] = 0.5 * au * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const qualityScale = (quality: number) => {
  const q = clamp(Math.round(quality), 1, 100);
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

const forwardDct8 = (input: Float32Array, out: Float32Array, tmp: Float32Array) => {
  for (let y = 0; y < BLOCK; y++) {
    const yi = y * BLOCK;
    for (let u = 0; u < BLOCK; u++) {
      const ui = u * BLOCK;
      tmp[yi + u] =
        readF32(input, yi) * readDct(ui) +
        readF32(input, yi + 1) * readDct(ui + 1) +
        readF32(input, yi + 2) * readDct(ui + 2) +
        readF32(input, yi + 3) * readDct(ui + 3) +
        readF32(input, yi + 4) * readDct(ui + 4) +
        readF32(input, yi + 5) * readDct(ui + 5) +
        readF32(input, yi + 6) * readDct(ui + 6) +
        readF32(input, yi + 7) * readDct(ui + 7);
    }
  }

  for (let v = 0; v < BLOCK; v++) {
    const vi = v * BLOCK;
    for (let u = 0; u < BLOCK; u++) {
      out[vi + u] =
        readDct(vi) * readF32(tmp, u) +
        readDct(vi + 1) * readF32(tmp, BLOCK + u) +
        readDct(vi + 2) * readF32(tmp, BLOCK * 2 + u) +
        readDct(vi + 3) * readF32(tmp, BLOCK * 3 + u) +
        readDct(vi + 4) * readF32(tmp, BLOCK * 4 + u) +
        readDct(vi + 5) * readF32(tmp, BLOCK * 5 + u) +
        readDct(vi + 6) * readF32(tmp, BLOCK * 6 + u) +
        readDct(vi + 7) * readF32(tmp, BLOCK * 7 + u);
    }
  }
};

const inverseDct8 = (coeff: Float32Array, out: Float32Array, tmp: Float32Array) => {
  for (let y = 0; y < BLOCK; y++) {
    const yi = y * BLOCK;
    for (let u = 0; u < BLOCK; u++) {
      tmp[yi + u] =
        readDct(y) * readF32(coeff, u) +
        readDct(BLOCK + y) * readF32(coeff, BLOCK + u) +
        readDct(BLOCK * 2 + y) * readF32(coeff, BLOCK * 2 + u) +
        readDct(BLOCK * 3 + y) * readF32(coeff, BLOCK * 3 + u) +
        readDct(BLOCK * 4 + y) * readF32(coeff, BLOCK * 4 + u) +
        readDct(BLOCK * 5 + y) * readF32(coeff, BLOCK * 5 + u) +
        readDct(BLOCK * 6 + y) * readF32(coeff, BLOCK * 6 + u) +
        readDct(BLOCK * 7 + y) * readF32(coeff, BLOCK * 7 + u);
    }
  }

  for (let y = 0; y < BLOCK; y++) {
    const yi = y * BLOCK;
    for (let x = 0; x < BLOCK; x++) {
      out[yi + x] =
        readF32(tmp, yi) * readDct(x) +
        readF32(tmp, yi + 1) * readDct(BLOCK + x) +
        readF32(tmp, yi + 2) * readDct(BLOCK * 2 + x) +
        readF32(tmp, yi + 3) * readDct(BLOCK * 3 + x) +
        readF32(tmp, yi + 4) * readDct(BLOCK * 4 + x) +
        readF32(tmp, yi + 5) * readDct(BLOCK * 5 + x) +
        readF32(tmp, yi + 6) * readDct(BLOCK * 6 + x) +
        readF32(tmp, yi + 7) * readDct(BLOCK * 7 + x);
    }
  }
};

const downsampleChroma = (
  src: Float32Array,
  w: number,
  h: number,
  subsampling: string
): { plane: Float32Array; w: number; h: number } => {
  if (subsampling === "444") {
    return { plane: new Float32Array(src), w, h };
  }

  if (subsampling === "422") {
    const dw = Math.ceil(w / 2);
    const out = new Float32Array(dw * h);
    for (let y = 0; y < h; y++) {
      const sRow = y * w;
      const dRow = y * dw;
      for (let x = 0; x < dw; x++) {
        const sx = x * 2;
        const sx1 = Math.min(w - 1, sx + 1);
        out[dRow + x] = (readF32(src, sRow + sx) + readF32(src, sRow + sx1)) * 0.5;
      }
    }
    return { plane: out, w: dw, h };
  }

  const dw = Math.ceil(w / 2);
  const dh = Math.ceil(h / 2);
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = y * 2;
    const sy1 = Math.min(h - 1, sy + 1);
    for (let x = 0; x < dw; x++) {
      const sx = x * 2;
      const sx1 = Math.min(w - 1, sx + 1);
      const a = readF32(src, sy * w + sx);
      const b = readF32(src, sy * w + sx1);
      const c = readF32(src, sy1 * w + sx);
      const d = readF32(src, sy1 * w + sx1);
      out[y * dw + x] = (a + b + c + d) * 0.25;
    }
  }
  return { plane: out, w: dw, h: dh };
};

const upsampleChroma = (
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  subsampling: string
) => {
  if (subsampling === "444" && sw === dw && sh === dh) {
    return new Float32Array(src);
  }

  const out = new Float32Array(dw * dh);

  if (subsampling === "422") {
    for (let y = 0; y < dh; y++) {
      const sRow = Math.min(sh - 1, y) * sw;
      const dRow = y * dw;
      for (let x = 0; x < dw; x++) {
        out[dRow + x] = readF32(src, sRow + Math.min(sw - 1, x >> 1));
      }
    }
    return out;
  }

  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, y >> 1);
    const sRow = sy * sw;
    const dRow = y * dw;
    for (let x = 0; x < dw; x++) {
      out[dRow + x] = readF32(src, sRow + Math.min(sw - 1, x >> 1));
    }
  }
  return out;
};

const deblockPlane = (plane: Float32Array, w: number, h: number, strength: number) => {
  if (strength <= 0) return;

  const blend = clamp(strength, 0, 1) * 0.5;

  for (let x = BLOCK; x < w; x += BLOCK) {
    for (let y = 0; y < h; y++) {
      const left = y * w + x - 1;
      const right = y * w + x;
      const a = readF32(plane, left);
      const b = readF32(plane, right);
      if (Math.abs(a - b) < 48) {
        const mid = (a + b) * 0.5;
        plane[left] = a + (mid - a) * blend;
        plane[right] = b + (mid - b) * blend;
      }
    }
  }

  for (let y = BLOCK; y < h; y += BLOCK) {
    for (let x = 0; x < w; x++) {
      const top = (y - 1) * w + x;
      const bot = y * w + x;
      const a = readF32(plane, top);
      const b = readF32(plane, bot);
      if (Math.abs(a - b) < 48) {
        const mid = (a + b) * 0.5;
        plane[top] = a + (mid - a) * blend;
        plane[bot] = b + (mid - b) * blend;
      }
    }
  }
};

const addRinging = (yPlane: Float32Array, w: number, h: number, amount: number) => {
  if (amount <= 0) return;
  const src = new Float32Array(yPlane);
  const gain = amount * 0.35;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const center = readF32(src, i);
      const lap = readF32(src, i - 1) + readF32(src, i + 1) + readF32(src, i - w) + readF32(src, i + w) - 4 * center;
      yPlane[i] = clamp(center + lap * gain, 0, 255);
    }
  }
};

const addMosquito = (
  yPlane: Float32Array,
  cbPlane: Float32Array,
  crPlane: Float32Array,
  w: number,
  h: number,
  amount: number,
  rng: () => number
) => {
  if (amount <= 0) return;
  const ySrc = new Float32Array(yPlane);
  const amp = amount * 20;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const y0 = readF32(ySrc, i);
      const g = Math.abs(y0 - readF32(ySrc, i + 1)) + Math.abs(y0 - readF32(ySrc, i + w));
      if (g > 30) {
        const n = (rng() - 0.5) * amp;
        yPlane[i] = clamp(readF32(yPlane, i) + n, 0, 255);
        cbPlane[i] = clamp(readF32(cbPlane, i) + n * 0.8, 0, 255);
        crPlane[i] = clamp(readF32(crPlane, i) - n * 0.6, 0, 255);
      }
    }
  }
};

const processPlane = (
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  qTable: number[],
  qScale: number,
  blockSize: number,
  gridJitter: number,
  corruptBurstChance: number,
  rng: () => number
) => {
  const macroW = Math.max(1, Math.ceil(w / blockSize));
  const macroH = Math.max(1, Math.ceil(h / blockSize));
  const macroCount = macroW * macroH;
  const burstMap = new Float32Array(macroCount);
  const jitterMap = new Float32Array(macroCount);

  for (let i = 0; i < macroCount; i++) {
    burstMap[i] = rng() < corruptBurstChance ? 1.8 + rng() * 4.5 : 1;
    jitterMap[i] = clamp(1 + (rng() - 0.5) * 2 * gridJitter, 0.25, 3);
  }

  const blockIn = new Float32Array(BLOCK * BLOCK);
  const coeff = new Float32Array(BLOCK * BLOCK);
  const blockOut = new Float32Array(BLOCK * BLOCK);
  const tmp = new Float32Array(BLOCK * BLOCK);

  for (let by = 0; by < h; by += BLOCK) {
    for (let bx = 0; bx < w; bx += BLOCK) {
      const mx = Math.min(macroW - 1, Math.floor(bx / blockSize));
      const my = Math.min(macroH - 1, Math.floor(by / blockSize));
      const m = my * macroW + mx;
      const burst = burstMap[m];
      const jitter = jitterMap[m];

      for (let y = 0; y < BLOCK; y++) {
        const sy = Math.min(h - 1, by + y);
        const sRow = sy * w;
        const bRow = y * BLOCK;
        for (let x = 0; x < BLOCK; x++) {
          const sx = Math.min(w - 1, bx + x);
          blockIn[bRow + x] = readF32(src, sRow + sx) - 128;
        }
      }

      forwardDct8(blockIn, coeff, tmp);

      for (let i = 0; i < coeff.length; i++) {
        const highFreqPenalty = i > 10 && (burst ?? 0) > 1 ? 1 + ((burst ?? 0) - 1) * 0.3 : 1;
        const q = Math.max(1, readQ(qTable, i) * qScale * (burst ?? 1) * (jitter ?? 1) * highFreqPenalty);
        coeff[i] = Math.round(readF32(coeff, i) / q) * q;
        if (i > 14 && (burst ?? 0) > 3 && rng() < 0.15) coeff[i] = 0;
      }

      inverseDct8(coeff, blockOut, tmp);

      for (let y = 0; y < BLOCK; y++) {
        const dy = by + y;
        if (dy >= h) break;
        const dRow = dy * w;
        const bRow = y * BLOCK;
        for (let x = 0; x < BLOCK; x++) {
          const dx = bx + x;
          if (dx >= w) break;
          dst[dRow + dx] = clamp(readF32(blockOut, bRow + x) + 128, 0, 255);
        }
      }
    }
  }
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
  qualityLuma: { type: RANGE, range: [1, 100], step: 1, default: 28, desc: "Luma quantization quality — lower values produce harsher block loss" },
  qualityChroma: { type: RANGE, range: [1, 100], step: 1, default: 16, desc: "Chroma quantization quality — lower values cause color bleed and smearing" },
  quality: { type: RANGE, range: [1, 100], step: 1, default: 30, desc: "Legacy master quality fallback for old presets and saved states" },
  subsampling: {
    type: ENUM,
    default: "420",
    options: [
      { name: "4:4:4 (none)", value: "444" },
      { name: "4:2:2", value: "422" },
      { name: "4:2:0", value: "420" },
    ],
    desc: "Chroma subsampling mode used before quantization"
  },
  blockSize: { type: RANGE, range: [8, 64], step: 8, default: 16, desc: "Macroblock size controlling burst grouping and temporal hold regions" },
  ringing: { type: RANGE, range: [0, 1], step: 0.01, default: 0.25, desc: "Sharpened edge overshoot around blocks (ringing)" },
  mosquito: { type: RANGE, range: [0, 1], step: 0.01, default: 0.2, desc: "Edge-adjacent chroma/luma noise similar to mosquito artifacts" },
  gridJitter: { type: RANGE, range: [0, 1], step: 0.01, default: 0.15, desc: "Per-macroblock quantization jitter for unstable decode grid" },
  corruptBurstChance: { type: RANGE, range: [0, 1], step: 0.01, default: 0.12, desc: "Probability that a macroblock enters severe corruption" },
  deblock: { type: RANGE, range: [0, 1], step: 0.01, default: 0.08, desc: "Post-pass seam softening across 8x8 boundaries" },
  temporalHold: { type: RANGE, range: [0, 1], step: 0.01, default: 0.1, desc: "Hold previous corrupted macroblocks between keyframes (P-frame smear)" },
  keyframeInterval: { type: RANGE, range: [1, 60], step: 1, default: 12, desc: "Every Nth frame refreshes all macroblocks from current input" },
  preserveAlpha: { type: BOOL, default: true, desc: "Preserve source alpha channel" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  qualityLuma: optionTypes.qualityLuma.default,
  qualityChroma: optionTypes.qualityChroma.default,
  quality: optionTypes.quality.default,
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
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

export const applyJpegArtifactToCanvas = (
  input: any,
  options: JpegArtifactOptions = defaults
) => {
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

  const {
    qualityLuma,
    qualityChroma,
    quality,
    subsampling,
    blockSize,
    ringing,
    mosquito,
    gridJitter,
    corruptBurstChance,
    deblock,
    temporalHold,
    keyframeInterval,
    preserveAlpha,
  } = safeOptions;

  const prevOutput = options._prevOutput instanceof Uint8ClampedArray ? options._prevOutput : null;
  const frameIndex = typeof options._frameIndex === "number" ? options._frameIndex : 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const w = input.width;
  const h = input.height;
  const src = inputCtx.getImageData(0, 0, w, h).data;

  // GL fast path. Processes everything at 4:4:4 (full-res chroma) regardless
  // of the user's subsampling choice — the GL pipeline doesn't have a
  // separate sub-res chroma path. If the user explicitly picked 4:2:2 / 4:2:0
  // and cares about that visual, they can toggle WebGL off to get WASM's
  // subsampled path. Needs EXT_color_buffer_float for the RGBA32F
  // intermediates holding DCT coefficients.
  const hasTemporal = (temporalHold ?? 0) > 0;
  if (
    jpegArtifactGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const rendered = renderJpegArtifactGL(
      input, w, h,
      qualityScaleShared(qualityLuma ?? quality ?? 30),
      qualityScaleShared(qualityChroma ?? quality ?? 30),
      gridJitter ?? 0,
      corruptBurstChance ?? 0,
      deblock ?? 0,
      ringing ?? 0,
      mosquito ?? 0,
      frameIndex,
      preserveAlpha ?? true,
    );
    if (rendered && typeof (rendered as { getContext?: unknown }).getContext === "function") {
      // Read the GL output back once so we can apply both the palette pass
      // (for custom palettes) and the temporal-hold block composite (for
      // temporalHold > 0). The composite is identical to the WASM path's
      // CPU composite — same seed, same block size, same keyframe rule.
      const rCtx = (rendered as HTMLCanvasElement | OffscreenCanvas).getContext(
        "2d", { willReadFrequently: true }
      ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
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
            const kf = Math.max(1, Math.round(keyframeInterval ?? 12));
            const isKeyframe = frameIndex % kf === 0;
            if (!isKeyframe) {
              const holdRng = mulberry32(frameIndex * 10007 + 17);
              const bs = blockSize ?? 16;
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
                      if (preserveAlpha) pixels[idx + 3] = prevOutput![idx + 3] ?? 0;
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
      const subNote = subsampling === "444" ? "" : ` sub=${subsampling}-ignored`;
      const extras = `${appliedPalette ? "+palettePass" : ""}${appliedHold ? "+hold" : ""}`;
      logFilterBackend("JPEG Artifact", "WebGL2",
        `qL=${qualityLuma} qC=${qualityChroma} block=${blockSize}${subNote}${extras}`);
      return rendered as HTMLCanvasElement;
    }
  }

  // WASM fast path: identical semantics to the JS reference below (same
  // mulberry32 seed, same block-order RNG consumption, same post passes)
  // except palette and temporal hold still run on the JS side below.
  if (
    wasmIsLoaded()
    && (options as { _wasmAcceleration?: boolean })._wasmAcceleration !== false
  ) {
    const subIdx = subsampling === "444" ? JPEG_SUBSAMPLING.YUV444
      : subsampling === "422" ? JPEG_SUBSAMPLING.YUV422
      : JPEG_SUBSAMPLING.YUV420;
    const outBufWasm = new Uint8ClampedArray(src.length);
    wasmJpegArtifactBuffer(
      src, outBufWasm, w, h,
      qualityLuma ?? quality ?? 30,
      qualityChroma ?? quality ?? 30,
      subIdx,
      blockSize ?? 16,
      ringing ?? 0,
      mosquito ?? 0,
      gridJitter ?? 0,
      corruptBurstChance ?? 0,
      deblock ?? 0,
      preserveAlpha ?? true,
      frameIndex,
    );
    // Palette post-pass (identity → no-op) and temporal hold (JS, needs
    // prevOutput buffer that we already have here).
    if (!paletteIsIdentity(safePalette)) {
      applyPaletteToBuffer(outBufWasm, outBufWasm, w, h, safePalette, true);
    }
    if ((temporalHold ?? 0) > 0 && prevOutput && prevOutput.length === outBufWasm.length) {
      const kf = Math.max(1, Math.round(keyframeInterval ?? 12));
      const isKeyframe = frameIndex % kf === 0;
      if (!isKeyframe) {
        // Mirror the JS block-level copy. Use a local mulberry RNG with a
        // distinct seed so the rng() consumption doesn't collide with the
        // WASM path's internal RNG.
        const holdRng = mulberry32(frameIndex * 10007 + 17);
        const bs = blockSize ?? 16;
        for (let by = 0; by < h; by += bs) {
          const yEnd = Math.min(h, by + bs);
          for (let bx = 0; bx < w; bx += bs) {
            if (holdRng() >= (temporalHold ?? 0)) continue;
            const xEnd = Math.min(w, bx + bs);
            for (let y = by; y < yEnd; y++) {
              let idx = (y * w + bx) * 4;
              for (let x = bx; x < xEnd; x++, idx += 4) {
                outBufWasm[idx] = prevOutput[idx] ?? 0;
                outBufWasm[idx + 1] = prevOutput[idx + 1] ?? 0;
                outBufWasm[idx + 2] = prevOutput[idx + 2] ?? 0;
                if (preserveAlpha) outBufWasm[idx + 3] = prevOutput[idx + 3] ?? 0;
              }
            }
          }
        }
      }
    }
    logFilterBackend("JPEG Artifact", "WASM", `sub=${subsampling} qL=${qualityLuma} qC=${qualityChroma} block=${blockSize}`);
    outputCtx.putImageData(new ImageData(outBufWasm, w, h), 0, 0);
    return output;
  }
  logFilterWasmStatus("JPEG Artifact", false, (options as { _wasmAcceleration?: boolean })._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

  const yPlane = new Float32Array(w * h);
  const cbFull = new Float32Array(w * h);
  const crFull = new Float32Array(w * h);

  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    yPlane[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    cbFull[p] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    crFull[p] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }

  const { plane: cbSub, w: cW, h: cH } = downsampleChroma(cbFull, w, h, subsampling);
  const { plane: crSub } = downsampleChroma(crFull, w, h, subsampling);

  const yOut = new Float32Array(w * h);
  const cbOutSub = new Float32Array(cW * cH);
  const crOutSub = new Float32Array(cW * cH);

  const rng = mulberry32(frameIndex * 7919 + 31337);

  const effectiveLuma = qualityLuma ?? quality;
  const effectiveChroma = qualityChroma ?? quality;

  processPlane(
    yPlane,
    yOut,
    w,
    h,
    LUMA_Q,
    qualityScale(effectiveLuma),
    blockSize,
    gridJitter,
    corruptBurstChance,
    rng
  );

  processPlane(
    cbSub,
    cbOutSub,
    cW,
    cH,
    CHROMA_Q,
    qualityScale(effectiveChroma),
    blockSize,
    gridJitter,
    corruptBurstChance,
    rng
  );

  processPlane(
    crSub,
    crOutSub,
    cW,
    cH,
    CHROMA_Q,
    qualityScale(effectiveChroma),
    blockSize,
    gridJitter,
    corruptBurstChance,
    rng
  );

  const cbOut = upsampleChroma(cbOutSub, cW, cH, w, h, subsampling);
  const crOut = upsampleChroma(crOutSub, cW, cH, w, h, subsampling);

  deblockPlane(yOut, w, h, deblock);
  deblockPlane(cbOut, w, h, deblock * 0.8);
  deblockPlane(crOut, w, h, deblock * 0.8);
  addRinging(yOut, w, h, ringing);
  addMosquito(yOut, cbOut, crOut, w, h, mosquito, rng);

  const outBuf = new Uint8ClampedArray(src.length);

  for (let p = 0, i = 0; p < yOut.length; p++, i += 4) {
    const y = readF32(yOut, p);
    const cb = readF32(cbOut, p) - 128;
    const cr = readF32(crOut, p) - 128;

    const r = clamp(y + 1.402 * cr, 0, 255);
    const g = clamp(y - 0.344136 * cb - 0.714136 * cr, 0, 255);
    const b = clamp(y + 1.772 * cb, 0, 255);

    const a = preserveAlpha ? readU8(src, i + 3) : 255;
    const color = paletteGetColor(safePalette, rgba(r, g, b, a), safePalette.options, false);
    fillBufferPixel(outBuf, i, color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, a);
  }

  if (temporalHold > 0 && prevOutput && prevOutput.length === outBuf.length) {
    const kf = Math.max(1, Math.round(keyframeInterval));
    const isKeyframe = frameIndex % kf === 0;
    if (!isKeyframe) {
      for (let by = 0; by < h; by += blockSize) {
        const yEnd = Math.min(h, by + blockSize);
        for (let bx = 0; bx < w; bx += blockSize) {
          if (rng() >= temporalHold) continue;
          const xEnd = Math.min(w, bx + blockSize);
          for (let y = by; y < yEnd; y++) {
            let idx = (y * w + bx) * 4;
            for (let x = bx; x < xEnd; x++, idx += 4) {
              outBuf[idx] = readU8(prevOutput, idx);
              outBuf[idx + 1] = readU8(prevOutput, idx + 1);
              outBuf[idx + 2] = readU8(prevOutput, idx + 2);
              if (preserveAlpha) outBuf[idx + 3] = readU8(prevOutput, idx + 3);
            }
          }
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, w, h), 0, 0);
  return output;
};

const jpegArtifact = (input: any, options: JpegArtifactOptions = defaults) =>
  applyJpegArtifactToCanvas(input, options);

export default defineFilter({
  name: "JPEG Artifact",
  func: jpegArtifact,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Codec-style JPEG degradation with DCT quantization, chroma subsampling, and optional temporal hold corruption"
});
