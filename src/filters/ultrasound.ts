import { ACTION, RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  glAvailable,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";

export const optionTypes = {
  fanAngle:  { type: RANGE, range: [30, 150], step: 1, default: 70, desc: "Ultrasound scan sector angle" },
  speckle:   { type: RANGE, range: [0, 1], step: 0.01, default: 0.4, desc: "Speckle noise characteristic of ultrasound" },
  brightness: { type: RANGE, range: [0, 3], step: 0.05, default: 1.5, desc: "Overall image brightness" },
  scanLines: { type: BOOL, default: true, desc: "Show radial scan lines" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
    }
  },
  palette:   { type: PALETTE, default: nearest }
};

export const defaults = {
  fanAngle: optionTypes.fanAngle.default,
  speckle: optionTypes.speckle.default,
  brightness: optionTypes.brightness.default,
  scanLines: optionTypes.scanLines.default,
  animSpeed: optionTypes.animSpeed.default,
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

const US_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_halfAngleRad;
uniform float u_speckle;
uniform float u_brightness;
uniform int   u_scanLines;
uniform int   u_numBeams;
uniform float u_minRadius;
uniform float u_maxRadius;
uniform float u_depthSteps;
uniform float u_seed;
uniform vec2  u_markers[3];
uniform float u_markerSize;

float hash2(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  // Yellow measurement crosses drawn on top — inside fan or not.
  for (int m = 0; m < 3; m++) {
    vec2 mp = u_markers[m];
    if (mp.x < 0.0) continue;
    // Sector check: skip if marker is outside the fan.
    vec2 md = mp - vec2(u_res.x * 0.5, 0.0);
    float mAngle = atan(abs(md.x), md.y);
    if (mAngle > u_halfAngleRad) continue;
    if ((abs(x - mp.x) <= u_markerSize && y == mp.y) ||
        (abs(y - mp.y) <= u_markerSize && x == mp.x)) {
      fragColor = vec4(220.0/255.0, 220.0/255.0, 100.0/255.0, 1.0);
      return;
    }
  }

  float apexX = u_res.x * 0.5;
  float dx = x - apexX;
  float dy = y;
  float dist = sqrt(dx * dx + dy * dy);
  float angle = atan(dx, dy);

  if (abs(angle) > u_halfAngleRad || dist < u_minRadius || dist > u_maxRadius) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Which beam index does this angle map to, with interpolation fraction.
  float beamT = (angle + u_halfAngleRad) / (2.0 * u_halfAngleRad);
  float beamF = beamT * (float(u_numBeams) - 1.0);
  float depthF = dist - u_minRadius;
  int depthI = int(clamp(floor(depthF), 0.0, u_depthSteps - 1.0));

  // March the two nearest beams to this pixel's depth, accumulating
  // attenuation down each. Bilinear blend between beams.
  float values[2];
  int beamsToSample[2];
  beamsToSample[0] = int(clamp(floor(beamF), 0.0, float(u_numBeams - 1)));
  beamsToSample[1] = int(clamp(floor(beamF) + 1.0, 0.0, float(u_numBeams - 1)));

  for (int bj = 0; bj < 2; bj++) {
    int bi = beamsToSample[bj];
    float t = float(bi) / max(float(u_numBeams - 1), 1.0);
    float signal = 1.0;
    float echo = 0.0;
    // March from depth 0 to depthI (inclusive).
    for (int d = 0; d < 1024; d++) {
      if (d > depthI) break;
      float srcX = t * (u_res.x - 1.0);
      float srcY = (float(d) / u_depthSteps) * (u_res.y - 1.0);
      vec2 suv = vec2((srcX + 0.5) / u_res.x, 1.0 - (srcY + 0.5) / u_res.y);
      float srcLum = lum(texture(u_source, suv).rgb);
      float reflectivity = srcLum;
      echo = (0.25 + reflectivity * 0.75) * signal * u_brightness;
      float attenuation = reflectivity > 0.8 ? reflectivity * 0.08 : reflectivity * 0.02;
      signal *= 1.0 - attenuation;
      signal = max(signal, 0.15);
      float depthT = float(d) / u_depthSteps;
      echo *= 1.0 - depthT * 0.25;
      if (u_speckle > 0.0) {
        float n = 1.0 + (hash2(vec2(float(bi), float(d)) + u_seed) * 2.0 - 1.0) * u_speckle;
        echo *= max(0.0, n);
      }
    }
    values[bj] = clamp(echo, 0.0, 1.0);
  }
  float bf = fract(beamF);
  float L = mix(values[0], values[1], bf);

  if (u_scanLines == 1) {
    float beamDist = abs(beamF - floor(beamF + 0.5));
    float beamLine = 1.0 + 0.12 * exp(-beamDist * beamDist * 120.0);
    L *= beamLine;
  }
  if (u_speckle > 0.0) {
    float fineN = 1.0 + (hash2(vec2(x + 53.0, y + 17.0) + u_seed * 3.0) * 2.0 - 1.0) * u_speckle * 0.3;
    L *= max(0.0, fineN);
  }
  L = clamp(L, 0.0, 1.0);
  L = pow(L, 0.7);

  float amberMix = L * L;
  vec3 rgb = vec3(
    L * (200.0 + 55.0 * amberMix),
    L * (180.0 + 40.0 * amberMix),
    L * (120.0 - 40.0 * amberMix)
  ) / 255.0;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

type Cache = { us: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    us: linkProgram(gl, US_FS, [
      "u_source", "u_res", "u_halfAngleRad", "u_speckle", "u_brightness",
      "u_scanLines", "u_numBeams", "u_minRadius", "u_maxRadius",
      "u_depthSteps", "u_seed", "u_markers", "u_markerSize",
    ] as const),
  };
  return _cache;
};

const ultrasound = (input: any, options = defaults) => {
  const {
    fanAngle,
    speckle,
    brightness,
    scanLines,
    palette
  } = options;

  const frameIndex = (options as { _frameIndex?: number })._frameIndex || 0;
  const W = input.width, H = input.height;
  const halfAngleRad = ((fanAngle / 2) * Math.PI) / 180;
  const minRadius = H * 0.08;
  const maxRenderedRadius = H * 0.95;
  const numBeams = 128;
  const depthSteps = Math.ceil(maxRenderedRadius - minRadius);
  const markerSize = Math.max(3, Math.floor(Math.min(W, H) * 0.015));
  const markers = [
    [Math.floor(W * 0.35), Math.floor(H * 0.4)],
    [Math.floor(W * 0.65), Math.floor(H * 0.4)],
    [Math.floor(W * 0.5), Math.floor(H * 0.7)]
  ];

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "ultrasound:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      const markerArr = new Float32Array(6);
      for (let i = 0; i < 3; i++) {
        markerArr[i * 2] = markers[i][0];
        markerArr[i * 2 + 1] = H - 1 - markers[i][1];
      }

      drawPass(gl, null, W, H, cache.us, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.us.uniforms.u_source, 0);
        gl.uniform2f(cache.us.uniforms.u_res, W, H);
        gl.uniform1f(cache.us.uniforms.u_halfAngleRad, halfAngleRad);
        gl.uniform1f(cache.us.uniforms.u_speckle, speckle);
        gl.uniform1f(cache.us.uniforms.u_brightness, brightness);
        gl.uniform1i(cache.us.uniforms.u_scanLines, scanLines ? 1 : 0);
        gl.uniform1i(cache.us.uniforms.u_numBeams, numBeams);
        gl.uniform1f(cache.us.uniforms.u_minRadius, minRadius);
        gl.uniform1f(cache.us.uniforms.u_maxRadius, maxRenderedRadius);
        gl.uniform1f(cache.us.uniforms.u_depthSteps, depthSteps);
        gl.uniform1f(cache.us.uniforms.u_seed, ((frameIndex * 7919 + 31337) % 1000000) * 0.001);
        gl.uniform2fv(cache.us.uniforms.u_markers, markerArr);
        gl.uniform1f(cache.us.uniforms.u_markerSize, markerSize);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Ultrasound", "WebGL2",
            `fanAngle=${fanAngle}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Ultrasound", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rng = mulberry32(frameIndex * 7919 + 31337);

  // Fan geometry: apex at top-center
  const apexX = W / 2;
  const apexY = 0;

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

  // Per-beam scan results stored in polar grid: [beam][depthSample]
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

export default defineFilter({
  name: "Ultrasound",
  func: ultrasound,
  options: defaults,
  optionTypes,
  defaults
});
