import { ENUM, BOOL } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex, clamp } from "utils";

const QUALITY_FINE     = "FINE";
const QUALITY_STANDARD = "STANDARD";

const LIGHTING_DAYLIGHT    = "DAYLIGHT";
const LIGHTING_TUNGSTEN    = "TUNGSTEN";
const LIGHTING_FLUORESCENT = "FLUORESCENT";

// Max working resolution — the FD7 CCD is 640x480.
const MAX_W = 640;
const MAX_H = 480;

export const optionTypes = {
  quality: {
    type: ENUM,
    options: [
      { name: "Fine (~40 KB/frame)",    value: QUALITY_FINE },
      { name: "Standard (~25 KB/frame)", value: QUALITY_STANDARD },
    ],
    default: QUALITY_FINE,
  },
  lighting: {
    type: ENUM,
    options: [
      { name: "Daylight (warm bias)",         value: LIGHTING_DAYLIGHT },
      { name: "Tungsten (strong warm cast)",  value: LIGHTING_TUNGSTEN },
      { name: "Fluorescent (green cast)",     value: LIGHTING_FLUORESCENT },
    ],
    default: LIGHTING_DAYLIGHT,
  },
  smear: { type: BOOL, default: false },
};

export const defaults = {
  quality:  optionTypes.quality.default,
  lighting: optionTypes.lighting.default,
  smear:    optionTypes.smear.default,
};

// AWB colour multipliers — measured from real FD7 output.
// Daylight already has warm bias: R ~+6%, B ~-6% relative to neutral.
const AWB = {
  [LIGHTING_DAYLIGHT]:    [1.03, 1.00, 0.90],
  [LIGHTING_TUNGSTEN]:    [1.10, 0.97, 0.72],
  [LIGHTING_FLUORESCENT]: [0.96, 1.06, 0.92],
};

// JPEG block params calibrated from measured 1.56x boundary ratio (5 FD7 JPEGs).
const BLOCK_PARAMS = {
  [QUALITY_FINE]:     { strength: 0.35, noise: 3, chromaBlend: 0.70 },
  [QUALITY_STANDARD]: { strength: 0.60, noise: 7, chromaBlend: 0.85 },
};

// Shadow noise sigma — measured: R/B ~8, G ~6.
const NOISE_PARAMS = {
  [QUALITY_FINE]:     { rb: 8,  g: 6 },
  [QUALITY_STANDARD]: { rb: 11, g: 8 },
};

// Deterministic-looking noise from pixel coordinates.
// Uses a simple hash to avoid Math.random() producing different output per run
// while still appearing random spatially.
const pixelNoise = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = ((h ^ (h >> 13)) * 1103515245) | 0;
  return ((h >> 16) & 0xFFFF) / 65535;  // 0..1
};

const mavicaFd7 = (input, options = defaults) => {
  const { quality, lighting, smear } = options;
  const inputCtx = input.getContext("2d");
  if (!inputCtx) return input;

  const origW = input.width;
  const origH = input.height;

  // Step 1 — Downscale to 640x480 ceiling
  const needsScale = origW > MAX_W || origH > MAX_H;
  const workW = needsScale ? MAX_W : origW;
  const workH = needsScale ? MAX_H : origH;

  const workCanvas = cloneCanvas(input, false);
  workCanvas.width = workW;
  workCanvas.height = workH;
  const workCtx = workCanvas.getContext("2d");
  if (!workCtx) return input;

  if (needsScale) {
    workCtx.imageSmoothingEnabled = true;
    workCtx.drawImage(input, 0, 0, workW, workH);
  } else {
    workCtx.drawImage(input, 0, 0);
  }

  const imgData = workCtx.getImageData(0, 0, workW, workH);
  const buf = imgData.data;

  // Step 2 — AWB colour temperature
  const [rMul, gMul, bMul] = AWB[lighting] || AWB[LIGHTING_DAYLIGHT];
  const fluorescentFlutter = lighting === LIGHTING_FLUORESCENT;

  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      let gFlutter = 0;
      if (fluorescentFlutter) {
        gFlutter = (pixelNoise(x, y, 7) - 0.5) * 8;  // +/-4
      }
      buf[i]     = clamp(0, 255, Math.round(buf[i]     * rMul));
      buf[i + 1] = clamp(0, 255, Math.round(buf[i + 1] * gMul + gFlutter));
      buf[i + 2] = clamp(0, 255, Math.round(buf[i + 2] * bMul));
    }
  }

  // Step 3 — Saturation boost (x1.12, inline)
  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      const grey = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      buf[i]     = clamp(0, 255, Math.round(grey + (buf[i]     - grey) * 1.12));
      buf[i + 1] = clamp(0, 255, Math.round(grey + (buf[i + 1] - grey) * 1.12));
      buf[i + 2] = clamp(0, 255, Math.round(grey + (buf[i + 2] - grey) * 1.12));
    }
  }

  // Step 4 — JPEG 8x8 block artifact simulation
  const { strength, noise, chromaBlend } = BLOCK_PARAMS[quality] || BLOCK_PARAMS[QUALITY_FINE];

  // 4a: 8x8 block averaging (lerp toward block mean)
  const blocksX = Math.ceil(workW / 8);
  const blocksY = Math.ceil(workH / 8);

  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const x0 = bx * 8;
      const y0 = by * 8;
      const x1 = Math.min(x0 + 8, workW);
      const y1 = Math.min(y0 + 8, workH);
      const n = (x1 - x0) * (y1 - y0);

      // Compute block mean
      let sumR = 0, sumG = 0, sumB = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = getBufferIndex(xx, yy, workW);
          sumR += buf[i];
          sumG += buf[i + 1];
          sumB += buf[i + 2];
        }
      }
      const meanR = sumR / n;
      const meanG = sumG / n;
      const meanB = sumB / n;

      // Lerp each pixel toward mean + quantisation noise
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = getBufferIndex(xx, yy, workW);
          const nr = (pixelNoise(xx, yy, 31) - 0.5) * 2 * noise;
          const ng = (pixelNoise(xx, yy, 47) - 0.5) * 2 * noise;
          const nb = (pixelNoise(xx, yy, 59) - 0.5) * 2 * noise;
          buf[i]     = clamp(0, 255, Math.round(buf[i]     + (meanR - buf[i])     * strength + nr));
          buf[i + 1] = clamp(0, 255, Math.round(buf[i + 1] + (meanG - buf[i + 1]) * strength + ng));
          buf[i + 2] = clamp(0, 255, Math.round(buf[i + 2] + (meanB - buf[i + 2]) * strength + nb));
        }
      }
    }
  }

  // 4b: 4:2:0 chroma subsampling — average chroma in 2x2 blocks
  const chBlocks_x = Math.ceil(workW / 2);
  const chBlocks_y = Math.ceil(workH / 2);

  for (let cy = 0; cy < chBlocks_y; cy += 1) {
    for (let cx = 0; cx < chBlocks_x; cx += 1) {
      const px0 = cx * 2;
      const py0 = cy * 2;
      const px1 = Math.min(px0 + 2, workW);
      const py1 = Math.min(py0 + 2, workH);
      const cn = (px1 - px0) * (py1 - py0);

      let sR = 0, sB = 0;
      for (let yy = py0; yy < py1; yy += 1) {
        for (let xx = px0; xx < px1; xx += 1) {
          const i = getBufferIndex(xx, yy, workW);
          sR += buf[i];
          sB += buf[i + 2];
        }
      }
      const avgR = sR / cn;
      const avgB = sB / cn;

      for (let yy = py0; yy < py1; yy += 1) {
        for (let xx = px0; xx < px1; xx += 1) {
          const i = getBufferIndex(xx, yy, workW);
          const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
          const newR = Math.round(buf[i]     + (avgR - buf[i])     * chromaBlend);
          const newB = Math.round(buf[i + 2] + (avgB - buf[i + 2]) * chromaBlend);
          // Adjust G to preserve original luminance
          const newG = Math.round((luma - 0.299 * newR - 0.114 * newB) / 0.587);
          buf[i]     = clamp(0, 255, newR);
          buf[i + 1] = clamp(0, 255, newG);
          buf[i + 2] = clamp(0, 255, newB);
        }
      }
    }
  }

  // Step 5 — CCD vertical smear (optional)
  if (smear) {
    const smearLen = 25;
    // Work on a copy so smears don't cascade
    const smearBuf = new Uint8ClampedArray(buf);

    for (let y = 0; y < workH; y += 1) {
      for (let x = 0; x < workW; x += 1) {
        const i = getBufferIndex(x, y, workW);
        const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
        if (luma <= 235) continue;

        for (let d = 1; d <= smearLen; d += 1) {
          const decay = 1 - (d / smearLen) ** 1.5;
          const blend = decay * 0.85;
          const sr = Math.round(buf[i]     + (255 - buf[i])     * blend);
          const sg = Math.round(buf[i + 1] + (255 - buf[i + 1]) * blend);
          const sb = Math.round(buf[i + 2] + (255 - buf[i + 2]) * blend);

          // Smear upward
          if (y - d >= 0) {
            const ti = getBufferIndex(x, y - d, workW);
            smearBuf[ti]     = Math.max(smearBuf[ti],     sr);
            smearBuf[ti + 1] = Math.max(smearBuf[ti + 1], sg);
            smearBuf[ti + 2] = Math.max(smearBuf[ti + 2], sb);
          }
          // Smear downward
          if (y + d < workH) {
            const ti = getBufferIndex(x, y + d, workW);
            smearBuf[ti]     = Math.max(smearBuf[ti],     sr);
            smearBuf[ti + 1] = Math.max(smearBuf[ti + 1], sg);
            smearBuf[ti + 2] = Math.max(smearBuf[ti + 2], sb);
          }
        }
      }
    }

    // Copy smear results back
    for (let j = 0; j < buf.length; j += 1) buf[j] = smearBuf[j];
  }

  // Step 6 — Shadow noise (measured: R/B sigma ~8, G sigma ~6)
  const { rb: noiseRB, g: noiseG } = NOISE_PARAMS[quality] || NOISE_PARAMS[QUALITY_FINE];

  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      if (luma >= 50) continue;
      const t = (50 - luma) / 50;
      buf[i]     = clamp(0, 255, Math.round(buf[i]     + (pixelNoise(x, y, 73) - 0.5) * 2 * noiseRB * t));
      buf[i + 1] = clamp(0, 255, Math.round(buf[i + 1] + (pixelNoise(x, y, 89) - 0.5) * 2 * noiseG  * t));
      buf[i + 2] = clamp(0, 255, Math.round(buf[i + 2] + (pixelNoise(x, y, 97) - 0.5) * 2 * noiseRB * t));
    }
  }

  // Step 7 — Hard highlight clip + shadow crush (measured from real FD7 output)
  for (let y = 0; y < workH; y += 1) {
    for (let x = 0; x < workW; x += 1) {
      const i = getBufferIndex(x, y, workW);
      // Highlight: hard clip at 248
      if (buf[i]     > 248) buf[i]     = 255;
      if (buf[i + 1] > 248) buf[i + 1] = 255;
      if (buf[i + 2] > 248) buf[i + 2] = 255;
      // Shadow: crush to black
      const luma = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      if (luma < 8) {
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 0;
      }
    }
  }

  workCtx.putImageData(imgData, 0, 0);

  // Scale back to original dimensions with nearest-neighbour
  const output = cloneCanvas(input, false);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  if (needsScale) {
    outputCtx.imageSmoothingEnabled = false;
    outputCtx.drawImage(workCanvas, 0, 0, origW, origH);
  } else {
    outputCtx.drawImage(workCanvas, 0, 0);
  }

  return output;
};

export default {
  name: "Mavica FD7",
  func: mavicaFd7,
  options: defaults,
  optionTypes,
  defaults,
};
