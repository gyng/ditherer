import { RANGE, ENUM } from "../constants/controlTypes";
import {
  cloneCanvas,
  clamp,
  getBufferIndex,
  logFilterBackend,
  logFilterWasmStatus,
  sampleBilinear,
} from "../utils/index";
import { computeLuminance, sobelEdges } from "../utils/edges";
import { defineFilter } from "./types";
import { anaglyphDisparity, duboisRedCyanLinear } from "./captureSamplingQualityContracts";
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

const MODE = {
  RED_CYAN: "RED_CYAN",
  RED_GREEN: "RED_GREEN",
  MAGENTA_GREEN: "MAGENTA_GREEN",
  YELLOW_BLUE: "YELLOW_BLUE",
};

const DEPTH = {
  LUMINANCE: "LUMINANCE",
  EDGE: "EDGE",
  CONSTANT: "CONSTANT",
};

export const optionTypes = {
  strength: {
    type: RANGE,
    range: [0, 40],
    step: 0.5,
    default: 12,
    desc: "Maximum total horizontal disparity between the synthetic eye views",
  },
  convergence: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.5,
    desc: "Depth proxy placed at zero disparity; lower and higher values cross in opposite directions",
  },
  mode: {
    type: ENUM,
    options: [
      { name: "Optimized red / cyan", value: MODE.RED_CYAN },
      { name: "Grayscale red / green", value: MODE.RED_GREEN },
      { name: "Grayscale magenta / green", value: MODE.MAGENTA_GREEN },
      { name: "Grayscale yellow / blue", value: MODE.YELLOW_BLUE },
    ],
    default: MODE.RED_CYAN,
    desc: "Glasses color pair; red/cyan uses the Dubois least-squares projection",
  },
  depthSource: {
    type: ENUM,
    options: [
      { name: "Luminance relief", value: DEPTH.LUMINANCE },
      { name: "Edge relief", value: DEPTH.EDGE },
      { name: "Flat plane", value: DEPTH.CONSTANT },
    ],
    default: DEPTH.LUMINANCE,
    desc: "Single-image proxy used to synthesize disparity; it is not true scene depth",
  },
};

export const defaults = {
  strength: optionTypes.strength.default,
  convergence: optionTypes.convergence.default,
  mode: optionTypes.mode.default,
  depthSource: optionTypes.depthSource.default,
};

const MODE_ID: Record<string, number> = {
  RED_CYAN: 0,
  RED_GREEN: 1,
  MAGENTA_GREEN: 2,
  YELLOW_BLUE: 3,
};
const DEPTH_ID: Record<string, number> = { LUMINANCE: 0, EDGE: 1, CONSTANT: 2 };

const ANA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_strength;
uniform float u_convergence;
uniform int   u_mode;       // 0 RED_CYAN .. 3 YELLOW_BLUE
uniform int   u_depthSource; // 0 LUMINANCE, 1 EDGE, 2 CONSTANT

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec4 samplePoint(float sx, float sy) {
  float cx = clamp(floor(sx + 0.5), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy + 0.5), 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y));
}

vec4 sampleBilinearPx(float sx, float sy) {
  vec2 p = clamp(vec2(sx, sy), vec2(0.0), u_res - vec2(1.0));
  vec2 p0 = floor(p);
  vec2 f = p - p0;
  vec4 a = samplePoint(p0.x, p0.y);
  vec4 b = samplePoint(p0.x + 1.0, p0.y);
  vec4 c = samplePoint(p0.x, p0.y + 1.0);
  vec4 d = samplePoint(p0.x + 1.0, p0.y + 1.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 srgbToLinear(vec3 c) {
  vec3 low = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  vec3 v = max(c, vec3(0.0));
  vec3 low = v * 12.92;
  vec3 high = 1.055 * pow(v, vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), v));
}

// Sobel magnitude on the luminance channel.
float sobelLum(float x, float y) {
  float a = lum(samplePoint(x - 1.0, y - 1.0).rgb);
  float b = lum(samplePoint(x,       y - 1.0).rgb);
  float c = lum(samplePoint(x + 1.0, y - 1.0).rgb);
  float d = lum(samplePoint(x - 1.0, y      ).rgb);
  float f = lum(samplePoint(x + 1.0, y      ).rgb);
  float g = lum(samplePoint(x - 1.0, y + 1.0).rgb);
  float h = lum(samplePoint(x,       y + 1.0).rgb);
  float i = lum(samplePoint(x + 1.0, y + 1.0).rgb);
  float gx = (c + 2.0 * f + i) - (a + 2.0 * d + g);
  float gy = (g + 2.0 * h + i) - (a + 2.0 * b + c);
  return clamp(sqrt(gx * gx + gy * gy), 0.0, 1.0);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  float depth;
  if (u_depthSource == 2) depth = 1.0;
  else if (u_depthSource == 1) depth = sobelLum(x, y);
  else depth = lum(samplePoint(x, y).rgb);

  float disparity = (clamp(depth, 0.0, 1.0) - u_convergence) * u_strength;
  vec3 L = srgbToLinear(sampleBilinearPx(x - disparity * 0.5, y).rgb);
  vec3 R = srgbToLinear(sampleBilinearPx(x + disparity * 0.5, y).rgb);

  vec3 linearRgb;
  if (u_mode == 0) {
    linearRgb = vec3(
      dot(vec3( 0.4561,     0.500484,   0.176381),   L) + dot(vec3(-0.0434706, -0.0879388, -0.00155529), R),
      dot(vec3(-0.0400822, -0.0378246, -0.0157589),  L) + dot(vec3( 0.378476,   0.73364,   -0.0184503),  R),
      dot(vec3(-0.0152161, -0.0205971, -0.00546856), L) + dot(vec3(-0.0721527, -0.112961,   1.2264),      R)
    );
  } else {
    float leftY = lum(L);
    float rightY = lum(R);
    if (u_mode == 1) linearRgb = vec3(leftY, rightY, 0.0);
    else if (u_mode == 2) linearRgb = vec3(leftY, rightY, leftY);
    else linearRgb = vec3(leftY, leftY, rightY);
  }
  vec3 rgb = linearToSrgb(clamp(linearRgb, 0.0, 1.0));

  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  float a = texture(u_source, suv).a;
  fragColor = vec4(clamp(rgb, 0.0, 1.0), a);
}
`;

type Cache = { ana: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    ana: linkProgram(gl, ANA_FS, [
      "u_source",
      "u_res",
      "u_strength",
      "u_convergence",
      "u_mode",
      "u_depthSource",
    ] as const),
  };
  return _cache;
};

type AnaglyphOptions = Partial<typeof defaults> & { _webglAcceleration?: boolean };

const anaglyph = (input: any, options: AnaglyphOptions = defaults) => {
  const resolved = { ...defaults, ...options };
  const { strength, convergence, mode, depthSource } = resolved;
  const W = input.width;
  const H = input.height;

  if (glAvailable() && resolved._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "anaglyph:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(
        gl,
        null,
        W,
        H,
        cache.ana,
        () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.ana.uniforms.u_source, 0);
          gl.uniform2f(cache.ana.uniforms.u_res, W, H);
          gl.uniform1f(cache.ana.uniforms.u_strength, strength);
          gl.uniform1f(cache.ana.uniforms.u_convergence, convergence);
          gl.uniform1i(cache.ana.uniforms.u_mode, MODE_ID[mode] ?? 0);
          gl.uniform1i(cache.ana.uniforms.u_depthSource, DEPTH_ID[depthSource] ?? 0);
        },
        vao,
      );

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        logFilterBackend("Anaglyph", "WebGL2", `${mode} ${depthSource}`);
        return rendered;
      }
    }
  }

  logFilterWasmStatus("Anaglyph", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum =
    depthSource === DEPTH.LUMINANCE || depthSource === DEPTH.EDGE
      ? computeLuminance(buf, W, H)
      : null;
  const edge = depthSource === DEPTH.EDGE && lum ? sobelEdges(lum, W, H).magnitude : null;
  const left = [0, 0, 0, 0];
  const right = [0, 0, 0, 0];
  const srgbToLinear = (value: number) => {
    const normalized = clamp(0, 255, value) / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const linearToSrgb = (value: number) => {
    const normalized = clamp(0, 1, value);
    const encoded =
      normalized <= 0.0031308 ? normalized * 12.92 : 1.055 * normalized ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const depth =
        depthSource === DEPTH.CONSTANT
          ? 1
          : depthSource === DEPTH.EDGE
            ? Math.min(1, (edge![y * W + x] || 0) / 255)
            : (lum![y * W + x] || 0) / 255;

      const disparity = anaglyphDisparity(depth, strength, convergence);
      sampleBilinear(buf, W, H, x - disparity * 0.5, y, left);
      sampleBilinear(buf, W, H, x + disparity * 0.5, y, right);
      const L: [number, number, number] = [
        srgbToLinear(left[0]),
        srgbToLinear(left[1]),
        srgbToLinear(left[2]),
      ];
      const R: [number, number, number] = [
        srgbToLinear(right[0]),
        srgbToLinear(right[1]),
        srgbToLinear(right[2]),
      ];

      let linearRgb: [number, number, number];

      if (mode === MODE.RED_CYAN) {
        linearRgb = duboisRedCyanLinear(L, R);
      } else if (mode === MODE.RED_GREEN) {
        const leftY = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
        const rightY = 0.2126 * R[0] + 0.7152 * R[1] + 0.0722 * R[2];
        linearRgb = [leftY, rightY, 0];
      } else if (mode === MODE.MAGENTA_GREEN) {
        const leftY = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
        const rightY = 0.2126 * R[0] + 0.7152 * R[1] + 0.0722 * R[2];
        linearRgb = [leftY, rightY, leftY];
      } else {
        const leftY = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
        const rightY = 0.2126 * R[0] + 0.7152 * R[1] + 0.0722 * R[2];
        linearRgb = [leftY, leftY, rightY];
      }

      outBuf[i] = linearToSrgb(linearRgb[0]);
      outBuf[i + 1] = linearToSrgb(linearRgb[1]);
      outBuf[i + 2] = linearToSrgb(linearRgb[2]);
      outBuf[i + 3] = buf[i + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Anaglyph",
  func: anaglyph,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Single-image synthetic stereo anaglyph with convergence-centered disparity and a linear-light Dubois red/cyan projection",
});
