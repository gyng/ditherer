import { BOOL, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, paletteGetColor } from "utils";

export const optionTypes = {
  sigmaSpatial: { type: RANGE, range: [1, 20], step: 1, default: 5, desc: "Spatial kernel size — larger blurs over a wider area" },
  sigmaRange: { type: RANGE, range: [5, 100], step: 5, default: 30, desc: "Color similarity threshold — higher preserves fewer edges" },
  useSeparableApproximation: { type: BOOL, default: true, desc: "Approximate the bilateral blur with horizontal and vertical passes for much faster processing" },
  useDownsample: { type: BOOL, default: true, desc: "Blur a smaller working image first, then scale back up for a large speed boost on bigger radii" },
  downsampleFactor: { type: RANGE, range: [1, 4], step: 1, default: 2, desc: "Working resolution reduction when downsample is enabled" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  sigmaSpatial: optionTypes.sigmaSpatial.default,
  sigmaRange: optionTypes.sigmaRange.default,
  useSeparableApproximation: optionTypes.useSeparableApproximation.default,
  useDownsample: optionTypes.useDownsample.default,
  downsampleFactor: optionTypes.downsampleFactor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const MAX_COLOR_DISTANCE_SQ = 3 * 255 * 255;
const spatialKernelCache = new Map<string, { radius: number; kernel: Float32Array }>();
const spatialLineKernelCache = new Map<string, { radius: number; kernel: Float32Array }>();
const rangeKernelCache = new Map<number, Float32Array>();

const getSpatialKernel = (sigmaSpatial: number) => {
  const radius = Math.ceil(sigmaSpatial * 2);
  const cacheKey = `${sigmaSpatial}:${radius}`;
  const cached = spatialKernelCache.get(cacheKey);
  if (cached) return cached;

  const size = radius * 2 + 1;
  const kernel = new Float32Array(size * size);
  const spatialDenom = 2 * sigmaSpatial * sigmaSpatial;
  let offset = 0;
  for (let ky = -radius; ky <= radius; ky += 1) {
    for (let kx = -radius; kx <= radius; kx += 1) {
      kernel[offset] = Math.exp(-(kx * kx + ky * ky) / spatialDenom);
      offset += 1;
    }
  }

  const result = { radius, kernel };
  spatialKernelCache.set(cacheKey, result);
  return result;
};

const getSpatialLineKernel = (sigmaSpatial: number) => {
  const radius = Math.ceil(sigmaSpatial * 2);
  const cacheKey = `${sigmaSpatial}:${radius}`;
  const cached = spatialLineKernelCache.get(cacheKey);
  if (cached) return cached;

  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  const spatialDenom = 2 * sigmaSpatial * sigmaSpatial;
  for (let k = -radius; k <= radius; k += 1) {
    kernel[k + radius] = Math.exp(-(k * k) / spatialDenom);
  }

  const result = { radius, kernel };
  spatialLineKernelCache.set(cacheKey, result);
  return result;
};

const getRangeKernel = (sigmaRange: number) => {
  const cacheKey = sigmaRange;
  const cached = rangeKernelCache.get(cacheKey);
  if (cached) return cached;

  const rangeDenom = 2 * sigmaRange * sigmaRange;
  const kernel = new Float32Array(MAX_COLOR_DISTANCE_SQ + 1);
  for (let distanceSq = 0; distanceSq <= MAX_COLOR_DISTANCE_SQ; distanceSq += 1) {
    kernel[distanceSq] = Math.exp(-distanceSq / rangeDenom);
  }

  rangeKernelCache.set(cacheKey, kernel);
  return kernel;
};

const runFullBilateral = (
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  spatialKernel: Float32Array,
  rangeKernel: Float32Array
) => {
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const ci = rowOffset + x * 4;
      const cr = buf[ci];
      const cg = buf[ci + 1];
      const cb = buf[ci + 2];
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let sw = 0;
      let kernelIndex = 0;

      for (let ky = -radius; ky <= radius; ky += 1) {
        const ny = Math.max(0, Math.min(height - 1, y + ky));
        const neighborRowOffset = ny * width * 4;
        for (let kx = -radius; kx <= radius; kx += 1) {
          const nx = Math.max(0, Math.min(width - 1, x + kx));
          const ni = neighborRowOffset + nx * 4;
          const nr = buf[ni];
          const ng = buf[ni + 1];
          const nb = buf[ni + 2];
          const dr = cr - nr;
          const dg = cg - ng;
          const db = cb - nb;
          const distanceSq = dr * dr + dg * dg + db * db;
          const weight = spatialKernel[kernelIndex] * rangeKernel[distanceSq];
          kernelIndex += 1;

          sr += nr * weight;
          sg += ng * weight;
          sb += nb * weight;
          sa += buf[ni + 3] * weight;
          sw += weight;
        }
      }

      outBuf[ci] = Math.round(sr / sw);
      outBuf[ci + 1] = Math.round(sg / sw);
      outBuf[ci + 2] = Math.round(sb / sw);
      outBuf[ci + 3] = Math.round(sa / sw);
    }
  }

  return outBuf;
};

const runSeparableBilateral = (
  buf: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  spatialLineKernel: Float32Array,
  rangeKernel: Float32Array
) => {
  const tempBuf = new Uint8ClampedArray(buf.length);
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const ci = rowOffset + x * 4;
      const cr = buf[ci];
      const cg = buf[ci + 1];
      const cb = buf[ci + 2];
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let sw = 0;

      for (let k = -radius; k <= radius; k += 1) {
        const nx = Math.max(0, Math.min(width - 1, x + k));
        const ni = rowOffset + nx * 4;
        const nr = buf[ni];
        const ng = buf[ni + 1];
        const nb = buf[ni + 2];
        const dr = cr - nr;
        const dg = cg - ng;
        const db = cb - nb;
        const weight = spatialLineKernel[k + radius] * rangeKernel[dr * dr + dg * dg + db * db];
        sr += nr * weight;
        sg += ng * weight;
        sb += nb * weight;
        sa += buf[ni + 3] * weight;
        sw += weight;
      }

      tempBuf[ci] = Math.round(sr / sw);
      tempBuf[ci + 1] = Math.round(sg / sw);
      tempBuf[ci + 2] = Math.round(sb / sw);
      tempBuf[ci + 3] = Math.round(sa / sw);
    }
  }

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const ci = rowOffset + x * 4;
      const cr = tempBuf[ci];
      const cg = tempBuf[ci + 1];
      const cb = tempBuf[ci + 2];
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let sw = 0;

      for (let k = -radius; k <= radius; k += 1) {
        const ny = Math.max(0, Math.min(height - 1, y + k));
        const ni = (ny * width + x) * 4;
        const nr = tempBuf[ni];
        const ng = tempBuf[ni + 1];
        const nb = tempBuf[ni + 2];
        const dr = cr - nr;
        const dg = cg - ng;
        const db = cb - nb;
        const weight = spatialLineKernel[k + radius] * rangeKernel[dr * dr + dg * dg + db * db];
        sr += nr * weight;
        sg += ng * weight;
        sb += nb * weight;
        sa += tempBuf[ni + 3] * weight;
        sw += weight;
      }

      outBuf[ci] = Math.round(sr / sw);
      outBuf[ci + 1] = Math.round(sg / sw);
      outBuf[ci + 2] = Math.round(sb / sw);
      outBuf[ci + 3] = Math.round(sa / sw);
    }
  }

  return outBuf;
};

const downsampleBuffer = (buf: Uint8ClampedArray, width: number, height: number, factor: number) => {
  const outWidth = Math.max(1, Math.ceil(width / factor));
  const outHeight = Math.max(1, Math.ceil(height / factor));
  const outBuf = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y += 1) {
    const srcY0 = y * factor;
    const srcY1 = Math.min(height, srcY0 + factor);
    for (let x = 0; x < outWidth; x += 1) {
      const srcX0 = x * factor;
      const srcX1 = Math.min(width, srcX0 + factor);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let count = 0;

      for (let sy = srcY0; sy < srcY1; sy += 1) {
        const rowOffset = sy * width * 4;
        for (let sx = srcX0; sx < srcX1; sx += 1) {
          const i = rowOffset + sx * 4;
          sr += buf[i];
          sg += buf[i + 1];
          sb += buf[i + 2];
          sa += buf[i + 3];
          count += 1;
        }
      }

      const oi = (y * outWidth + x) * 4;
      outBuf[oi] = Math.round(sr / count);
      outBuf[oi + 1] = Math.round(sg / count);
      outBuf[oi + 2] = Math.round(sb / count);
      outBuf[oi + 3] = Math.round(sa / count);
    }
  }

  return { width: outWidth, height: outHeight, buf: outBuf };
};

const upscaleBuffer = (buf: Uint8ClampedArray, width: number, height: number, outWidth: number, outHeight: number) => {
  if (width === outWidth && height === outHeight) return buf;

  const outBuf = new Uint8ClampedArray(outWidth * outHeight * 4);
  const xScale = width / outWidth;
  const yScale = height / outHeight;

  for (let y = 0; y < outHeight; y += 1) {
    const srcY = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(height - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, srcY - y0));

    for (let x = 0; x < outWidth; x += 1) {
      const srcX = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(width - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, srcX - x0));

      const i00 = (y0 * width + x0) * 4;
      const i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const oi = (y * outWidth + x) * 4;

      for (let c = 0; c < 4; c += 1) {
        const top = buf[i00 + c] * (1 - fx) + buf[i10 + c] * fx;
        const bottom = buf[i01 + c] * (1 - fx) + buf[i11 + c] * fx;
        outBuf[oi + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }

  return outBuf;
};

const bilateralBlur = (input, options: any = defaults) => {
  const {
    sigmaSpatial,
    sigmaRange,
    useSeparableApproximation,
    useDownsample,
    downsampleFactor,
    palette
  } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const factor = useDownsample ? Math.max(1, Math.round(downsampleFactor)) : 1;
  const downsampled = factor > 1 ? downsampleBuffer(buf, W, H, factor) : { width: W, height: H, buf };
  const { radius, kernel: spatialKernel } = getSpatialKernel(sigmaSpatial);
  const { kernel: spatialLineKernel } = getSpatialLineKernel(sigmaSpatial);
  const rangeKernel = getRangeKernel(sigmaRange);
  const blurredBuf = useSeparableApproximation
    ? runSeparableBilateral(downsampled.buf, downsampled.width, downsampled.height, radius, spatialLineKernel, rangeKernel)
    : runFullBilateral(downsampled.buf, downsampled.width, downsampled.height, radius, spatialKernel, rangeKernel);
  const scaledBuf = factor > 1
    ? upscaleBuffer(blurredBuf, downsampled.width, downsampled.height, W, H)
    : blurredBuf;
  const outBuf = new Uint8ClampedArray(scaledBuf.length);

  for (let i = 0; i < scaledBuf.length; i += 4) {
    const alpha = scaledBuf[i + 3];
    const color = paletteGetColor(palette, [
      scaledBuf[i],
      scaledBuf[i + 1],
      scaledBuf[i + 2],
      alpha
    ], palette.options, false);
    outBuf[i] = color[0];
    outBuf[i + 1] = color[1];
    outBuf[i + 2] = color[2];
    outBuf[i + 3] = alpha;
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Bilateral Blur", func: bilateralBlur, optionTypes, options: defaults, defaults };
