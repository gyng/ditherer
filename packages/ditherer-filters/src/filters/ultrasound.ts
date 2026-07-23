import { ACTION, RANGE, BOOL, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
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
} from "../gl/index";
import {
  ultrasoundBackscatter,
  ultrasoundDepthTransmission,
  ultrasoundRayleighEnvelope,
} from "./imagingSimulationContracts";
import {
  normalizeBooleanOption,
  normalizePaletteOption,
  normalizeRangeOption,
} from "../utils/filterOptions";

export const optionTypes = {
  fanAngle:  { type: RANGE, range: [30, 150], step: 1, default: 70, desc: "Convex-probe sector angle" },
  speckle:   { type: RANGE, range: [0, 1], step: 0.01, default: 0.4, desc: "Correlated Rayleigh-envelope speckle strength" },
  brightness: { type: RANGE, range: [0, 3], step: 0.05, default: 1.5, desc: "B-mode receive gain after depth attenuation" },
  scanLines: { type: BOOL, default: true, desc: "Reveal subtle radial beam sampling lines" },
  markers: { type: BOOL, default: false, desc: "Show illustrative measurement crosses" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12, desc: "Speckle refresh rate in frames per second" },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    desc: "Start or stop the changing speckle realization",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
    }
  },
  palette:   { type: PALETTE, default: nearest, desc: "Optional palette mapping after B-mode display compression" }
};

export const defaults = {
  fanAngle: optionTypes.fanAngle.default,
  speckle: optionTypes.speckle.default,
  brightness: optionTypes.brightness.default,
  scanLines: optionTypes.scanLines.default,
  markers: optionTypes.markers.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type UltrasoundOptions = Partial<typeof defaults> & {
  _frameIndex?: number;
  _webglAcceleration?: boolean;
};

const hash01 = (x: number, y: number, seed: number): number => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
};

const valueNoise = (x: number, y: number, seed: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash01(x0, y0, seed) * (1 - sx) + hash01(x0 + 1, y0, seed) * sx;
  const bottom = hash01(x0, y0 + 1, seed) * (1 - sx) + hash01(x0 + 1, y0 + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
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
uniform float u_seed;
uniform vec2  u_markers[3];
uniform float u_markerSize;
uniform int u_showMarkers;

float hash2(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

float valueNoise(vec2 p, float seed) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash2(cell + vec2(seed, seed * 0.37));
  float b = hash2(cell + vec2(1.0, 0.0) + vec2(seed, seed * 0.37));
  float c = hash2(cell + vec2(0.0, 1.0) + vec2(seed, seed * 0.37));
  float d = hash2(cell + vec2(1.0, 1.0) + vec2(seed, seed * 0.37));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float sourceLuma(vec2 sourcePx) {
  vec2 bounded = clamp(sourcePx, vec2(0.0), u_res - vec2(1.0));
  vec2 uv = vec2((bounded.x + 0.5) / u_res.x, 1.0 - (bounded.y + 0.5) / u_res.y);
  vec4 sampleValue = texture(u_source, uv);
  return lum(sampleValue.rgb) * sampleValue.a;
}

float backscatter(vec2 sourcePx) {
  float center = sourceLuma(sourcePx);
  float axial = abs(sourceLuma(sourcePx + vec2(0.0, 1.5)) - sourceLuma(sourcePx - vec2(0.0, 1.5)));
  float lateral = abs(sourceLuma(sourcePx + vec2(1.5, 0.0)) - sourceLuma(sourcePx - vec2(1.5, 0.0)));
  float neighborhood = 0.25 * (
    sourceLuma(sourcePx + vec2(0.0, 1.5)) + sourceLuma(sourcePx - vec2(0.0, 1.5)) +
    sourceLuma(sourcePx + vec2(1.5, 0.0)) + sourceLuma(sourcePx - vec2(1.5, 0.0))
  );
  float mismatch = abs(center - neighborhood);
  return clamp(0.025 + axial * 0.72 + lateral * 0.18 + mismatch * 0.2, 0.0, 1.0);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float outputAlpha = texture(u_source, v_uv).a;

  if (u_showMarkers == 1) {
    for (int m = 0; m < 3; m++) {
      vec2 mp = u_markers[m];
      vec2 md = mp - vec2(u_res.x * 0.5, 0.0);
      float mAngle = atan(abs(md.x), md.y);
      if (mAngle <= u_halfAngleRad &&
          ((abs(x - mp.x) <= u_markerSize && abs(y - mp.y) < 0.5) ||
           (abs(y - mp.y) <= u_markerSize && abs(x - mp.x) < 0.5))) {
        fragColor = vec4(220.0/255.0, 220.0/255.0, 100.0/255.0, outputAlpha);
        return;
      }
    }
  }

  float apexX = u_res.x * 0.5;
  float dx = x - apexX;
  float dy = y;
  float dist = sqrt(dx * dx + dy * dy);
  float angle = atan(dx, dy);

  if (abs(angle) > u_halfAngleRad || dist < u_minRadius || dist > u_maxRadius) {
    fragColor = vec4(0.0, 0.0, 0.0, outputAlpha);
    return;
  }

  float beamT = (angle + u_halfAngleRad) / (2.0 * u_halfAngleRad);
  float beamF = beamT * (float(u_numBeams) - 1.0);
  float depthT = clamp((dist - u_minRadius) / max(1.0, u_maxRadius - u_minRadius), 0.0, 1.0);
  vec2 sourcePx = vec2(beamT * (u_res.x - 1.0), depthT * (u_res.y - 1.0));
  float echo = backscatter(sourcePx) * exp(-1.15 * depthT) * u_brightness;
  float uniformValue = valueNoise(vec2(beamF * 0.42, depthT * u_res.y * 0.24), u_seed);
  float rayleigh = min(3.0, sqrt(-2.0 * log(max(1e-6, 1.0 - uniformValue))) / sqrt(3.14159265 / 2.0));
  float L = echo * mix(1.0, rayleigh, u_speckle);

  if (u_scanLines == 1) {
    float beamDist = abs(beamF - floor(beamF + 0.5));
    float beamLine = 1.0 + 0.12 * exp(-beamDist * beamDist * 120.0);
    L *= beamLine;
  }
  L = clamp(L, 0.0, 1.0);
  L = log(1.0 + 18.0 * L) / log(19.0);

  float amberMix = L * L;
  vec3 rgb = vec3(
    L * (200.0 + 55.0 * amberMix),
    L * (180.0 + 40.0 * amberMix),
    L * (120.0 - 40.0 * amberMix)
  ) / 255.0;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), outputAlpha);
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
      "u_seed", "u_markers", "u_markerSize", "u_showMarkers",
    ] as const),
  };
  return _cache;
};

const ultrasound = (input: any, options: UltrasoundOptions = defaults) => {
  const supplied = { ...defaults, ...options };
  const resolved = {
    ...supplied,
    fanAngle: normalizeRangeOption(supplied.fanAngle, defaults.fanAngle, 30, 150),
    speckle: normalizeRangeOption(supplied.speckle, defaults.speckle, 0, 1),
    brightness: normalizeRangeOption(supplied.brightness, defaults.brightness, 0, 3),
    scanLines: normalizeBooleanOption(supplied.scanLines, defaults.scanLines),
    markers: normalizeBooleanOption(supplied.markers, defaults.markers),
    animSpeed: normalizeRangeOption(supplied.animSpeed, defaults.animSpeed, 1, 30, true),
    palette: normalizePaletteOption(supplied.palette, defaults.palette),
  };
  const {
    fanAngle,
    speckle,
    brightness,
    scanLines,
    markers: showMarkers,
    palette
  } = resolved;

  const frameIndex = resolved._frameIndex || 0;
  const W = input.width, H = input.height;
  const halfAngleRad = ((fanAngle / 2) * Math.PI) / 180;
  const minRadius = H * 0.08;
  const maxRenderedRadius = H * 0.95;
  const numBeams = 128;
  const markerSize = Math.max(3, Math.floor(Math.min(W, H) * 0.015));
  const markers = [
    [Math.floor(W * 0.35), Math.floor(H * 0.4)],
    [Math.floor(W * 0.65), Math.floor(H * 0.4)],
    [Math.floor(W * 0.5), Math.floor(H * 0.7)]
  ];

  if (glAvailable() && resolved._webglAcceleration !== false) {
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
        markerArr[i * 2 + 1] = markers[i][1];
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
        gl.uniform1f(cache.us.uniforms.u_seed, ((frameIndex * 7919 + 31337) % 1000000) * 0.001);
        gl.uniform2fv(cache.us.uniforms.u_markers, markerArr);
        gl.uniform1f(cache.us.uniforms.u_markerSize, markerSize);
        gl.uniform1i(cache.us.uniforms.u_showMarkers, showMarkers ? 1 : 0);
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

  // Fan geometry: apex at top-center
  const apexX = W / 2;
  const apexY = 0;

  // --- Step 1: Compute source luminance ---
  const lumRaw = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lumRaw[y * W + x] = (
        buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722
      ) / 255 * (buf[i + 3] / 255);
    }
  }

  const sampleLuma = (sampleX: number, sampleY: number): number => {
    const boundedX = Math.max(0, Math.min(W - 1, sampleX));
    const boundedY = Math.max(0, Math.min(H - 1, sampleY));
    const x0 = Math.floor(boundedX);
    const y0 = Math.floor(boundedY);
    const x1 = Math.min(W - 1, x0 + 1);
    const y1 = Math.min(H - 1, y0 + 1);
    const fx = boundedX - x0;
    const fy = boundedY - y0;
    return lumRaw[y0 * W + x0] * (1 - fx) * (1 - fy)
      + lumRaw[y0 * W + x1] * fx * (1 - fy)
      + lumRaw[y1 * W + x0] * (1 - fx) * fy
      + lumRaw[y1 * W + x1] * fx * fy;
  };

  // Render a convex-probe sector. The source luminance is an explicitly
  // artistic impedance proxy; local changes generate specular echoes while a
  // small diffuse floor represents unresolved tissue scatterers.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      const dx = x - apexX;
      const dy = y - apexY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dx, dy);

      // Outside the fan sector
      if (Math.abs(angle) > halfAngleRad || dist < minRadius || dist > maxRenderedRadius) {
        fillBufferPixel(outBuf, i, 0, 0, 0, buf[i + 3]);
        continue;
      }

      const beamT = (angle + halfAngleRad) / (2 * halfAngleRad);
      const beamF = beamT * (numBeams - 1);
      const depthT = Math.max(0, Math.min(1,
        (dist - minRadius) / Math.max(1, maxRenderedRadius - minRadius)));
      const srcX = beamT * (W - 1);
      const srcY = depthT * (H - 1);
      let lum = ultrasoundBackscatter(
        sampleLuma(srcX, srcY),
        sampleLuma(srcX, srcY - 1.5),
        sampleLuma(srcX, srcY + 1.5),
        sampleLuma(srcX - 1.5, srcY),
        sampleLuma(srcX + 1.5, srcY),
      ) * ultrasoundDepthTransmission(depthT) * brightness;

      const uniformValue = valueNoise(
        beamF * 0.42,
        depthT * H * 0.24,
        frameIndex * 7919 + 31337,
      );
      lum *= ultrasoundRayleighEnvelope(uniformValue, speckle);

      // Beam line visibility: subtle bright lines along each beam
      if (scanLines) {
        const beamDist = Math.abs(beamF - Math.round(beamF));
        const beamLine = 1 + 0.12 * Math.exp(-beamDist * beamDist * 120);
        lum *= beamLine;
      }

      lum = Math.max(0, Math.min(1, lum));
      lum = Math.log(1 + 18 * lum) / Math.log(19);

      // Grayscale with warm amber tint on brighter areas
      const amberMix = lum * lum;
      const r = Math.round(lum * (200 + 55 * amberMix));
      const g = Math.round(lum * (180 + 40 * amberMix));
      const b2 = Math.round(lum * (120 - 40 * amberMix));

      const color = paletteGetColor(
        palette,
        rgba(r, g, b2, buf[i + 3]),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  // --- Step 3: Measurement marker crosses ---
  const markerColor = [220, 220, 100]; // yellowish

  if (showMarkers) for (const [mx, my] of markers) {
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
      fillBufferPixel(outBuf, idx, markerColor[0], markerColor[1], markerColor[2], buf[idx + 3]);
    }
    // Vertical arm
    for (let ky = -markerSize; ky <= markerSize; ky++) {
      const py = my + ky;
      if (py < 0 || py >= H) continue;
      const idx = getBufferIndex(mx, py, W);
      fillBufferPixel(outBuf, idx, markerColor[0], markerColor[1], markerColor[2], buf[idx + 3]);
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
  defaults,
  description: "Source-derived acoustic-impedance proxy rendered as a convex B-mode sector with boundary echoes, depth attenuation, and correlated speckle",
  temporal: true,
});
