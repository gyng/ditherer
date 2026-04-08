import { RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  fanAngle:  { type: RANGE, range: [30, 150], step: 1, default: 70 },
  speckle:   { type: RANGE, range: [0, 1], step: 0.01, default: 0.4 },
  brightness: { type: RANGE, range: [0, 3], step: 0.05, default: 1.5 },
  scanLines: { type: BOOL, default: true },
  palette:   { type: PALETTE, default: nearest }
};

export const defaults = {
  fanAngle: optionTypes.fanAngle.default,
  speckle: optionTypes.speckle.default,
  brightness: optionTypes.brightness.default,
  scanLines: optionTypes.scanLines.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Simple seeded pseudo-random for deterministic per-frame noise
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ultrasound = (input, options = defaults) => {
  const {
    fanAngle,
    speckle,
    brightness,
    scanLines,
    palette
  } = options;

  const frameIndex = (options as any)._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rng = mulberry32(frameIndex * 7919 + 31337);

  // Fan geometry: apex at top-center
  const apexX = W / 2;
  const apexY = 0;
  const halfAngleRad = ((fanAngle / 2) * Math.PI) / 180;

  // --- Step 1: Compute source luminance ---
  const lumRaw = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lumRaw[y * W + x] =
        buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
    }
  }

  // --- Step 2: Simulate beam-by-beam pulse-echo scanning ---
  // Each beam is a radial line from the transducer apex.
  // We trace each beam outward, sampling the source image, accumulating
  // signal attenuation (acoustic shadows) and adding coherent speckle.

  const minRadius = H * 0.08;
  const maxRenderedRadius = H * 0.95;
  const numBeams = 128;

  // Per-beam scan results stored in polar grid: [beam][depthSample]
  const depthSteps = Math.ceil(maxRenderedRadius - minRadius);
  const beamData = new Float32Array(numBeams * depthSteps);

  for (let bi = 0; bi < numBeams; bi++) {
    // Beam angle: evenly distributed across the fan
    const t = bi / (numBeams - 1); // 0..1
    // Seeded RNG per beam for coherent speckle along the beam
    const beamRng = mulberry32(frameIndex * 7919 + bi * 6961 + 31337);

    // Signal strength starts at 1.0, attenuated by dense structures
    let signal = 1.0;

    for (let di = 0; di < depthSteps; di++) {
      // Map beam position to source image coords
      const srcX = t * (W - 1);
      const srcY = (di / depthSteps) * (H - 1);

      // Bilinear sample from source luminance
      let sample = 0;
      if (srcX >= 0 && srcX < W && srcY >= 0 && srcY < H) {
        const sx0 = Math.floor(srcX);
        const sy0 = Math.floor(srcY);
        const sx1 = Math.min(sx0 + 1, W - 1);
        const sy1 = Math.min(sy0 + 1, H - 1);
        const fx = srcX - sx0;
        const fy = srcY - sy0;
        sample =
          lumRaw[sy0 * W + sx0] * (1 - fx) * (1 - fy) +
          lumRaw[sy0 * W + sx1] * fx * (1 - fy) +
          lumRaw[sy1 * W + sx0] * (1 - fx) * fy +
          lumRaw[sy1 * W + sx1] * fx * fy;
      }

      const reflectivity = sample / 255;

      // Base echo: soft tissue returns some signal, denser tissue returns more
      let echo = (0.25 + reflectivity * 0.75) * signal * brightness;

      // Acoustic shadowing: only very dense structures attenuate significantly
      const attenuation = reflectivity > 0.8 ? reflectivity * 0.08 : reflectivity * 0.02;
      signal *= 1 - attenuation;
      signal = Math.max(signal, 0.15);

      // Gentle depth attenuation
      const depthT = di / depthSteps;
      echo *= 1 - depthT * 0.25;

      // Coherent speckle: interference pattern along beam direction
      // Speckle is correlated along each beam (streaky, not random dots)
      if (speckle > 0) {
        const noise = 1 + (beamRng() * 2 - 1) * speckle;
        echo *= Math.max(0, noise);
      }

      beamData[bi * depthSteps + di] = Math.max(0, Math.min(1, echo));
    }
  }

  // --- Step 3: Render fan from beam data ---
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      const dx = x - apexX;
      const dy = y - apexY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dx, dy);

      // Outside the fan sector
      if (Math.abs(angle) > halfAngleRad || dist < minRadius || dist > maxRenderedRadius) {
        fillBufferPixel(outBuf, i, 0, 0, 0, 255);
        continue;
      }

      // Map to beam index and depth index (with interpolation between beams)
      const beamT = (angle + halfAngleRad) / (2 * halfAngleRad);
      const beamF = beamT * (numBeams - 1);
      const b0 = Math.floor(beamF);
      const b1 = Math.min(b0 + 1, numBeams - 1);
      const bf = beamF - b0;

      const di = Math.floor(dist - minRadius);
      const di1 = Math.min(di + 1, depthSteps - 1);
      const df = (dist - minRadius) - di;

      // Bilinear interpolation in (beam, depth) space
      const v00 = beamData[b0 * depthSteps + di];
      const v10 = beamData[b1 * depthSteps + di];
      const v01 = beamData[b0 * depthSteps + di1];
      const v11 = beamData[b1 * depthSteps + di1];
      let lum = v00 * (1 - bf) * (1 - df) + v10 * bf * (1 - df) +
                v01 * (1 - bf) * df + v11 * bf * df;

      // Beam line visibility: subtle bright lines along each beam
      if (scanLines) {
        const beamDist = Math.abs(beamF - Math.round(beamF));
        const beamLine = 1 + 0.12 * Math.exp(-beamDist * beamDist * 120);
        lum *= beamLine;
      }

      // Per-pixel speckle for additional grain (uncorrelated, finer than beam speckle)
      if (speckle > 0) {
        const fineNoise = 1 + (rng() * 2 - 1) * speckle * 0.3;
        lum *= Math.max(0, fineNoise);
      }

      lum = Math.max(0, Math.min(1, lum));

      // Gamma lift: ultrasound displays boost midtones significantly
      lum = Math.pow(lum, 0.7);

      // Grayscale with warm amber tint on brighter areas
      const amberMix = lum * lum;
      const r = Math.round(lum * (200 + 55 * amberMix));
      const g = Math.round(lum * (180 + 40 * amberMix));
      const b2 = Math.round(lum * (120 - 40 * amberMix));

      const color = paletteGetColor(
        palette,
        rgba(r, g, b2, 255),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  // --- Step 3: Measurement marker crosses ---
  const markerColor = [220, 220, 100]; // yellowish
  const markerSize = Math.max(3, Math.floor(Math.min(W, H) * 0.015));
  const markers = [
    [Math.floor(W * 0.35), Math.floor(H * 0.4)],
    [Math.floor(W * 0.65), Math.floor(H * 0.4)],
    [Math.floor(W * 0.5), Math.floor(H * 0.7)]
  ];

  for (const [mx, my] of markers) {
    // Only draw if inside the fan
    const mdx = mx - apexX;
    const mdy = my - apexY;
    const mAngle = Math.atan2(Math.abs(mdx), mdy);
    if (mAngle > halfAngleRad) continue;

    // Horizontal arm
    for (let kx = -markerSize; kx <= markerSize; kx++) {
      const px = mx + kx;
      if (px < 0 || px >= W) continue;
      const idx = getBufferIndex(px, my, W);
      fillBufferPixel(outBuf, idx, markerColor[0], markerColor[1], markerColor[2], 255);
    }
    // Vertical arm
    for (let ky = -markerSize; ky <= markerSize; ky++) {
      const py = my + ky;
      if (py < 0 || py >= H) continue;
      const idx = getBufferIndex(mx, py, W);
      fillBufferPixel(outBuf, idx, markerColor[0], markerColor[1], markerColor[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Ultrasound",
  func: ultrasound,
  options: defaults,
  optionTypes,
  defaults
};
