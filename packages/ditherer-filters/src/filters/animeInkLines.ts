import { COLOR, ENUM, PALETTE, RANGE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
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
  type TexEntry,
} from "../gl/index";
import {
  clamp,
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  logFilterBackend,
  logFilterWasmStatus,
  rgba,
  srgbPaletteGetColor,
} from "../utils/index";
import { computeLuminance, sobelEdges } from "../utils/edges";
import { defineFilter } from "./types";

const EDGE_SOURCE = { XDOG: "XDOG", SOBEL: "SOBEL", LAPLACIAN: "LAPLACIAN" } as const;
const RENDER_MODE = { SOLID: "SOLID", OVERLAY: "OVERLAY" } as const;

const laplacianEdges = (lum: Float32Array, W: number, H: number) => {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const index = y * W + x;
      out[index] = Math.abs(
        lum[index - 1]! + lum[index + 1]! + lum[index - W]! + lum[index + W]! - lum[index]! * 4,
      );
    }
  }
  return out;
};

const thresholdMap = (magnitude: Float32Array, threshold: number) => {
  const out = new Uint8Array(magnitude.length);
  for (let index = 0; index < magnitude.length; index += 1) {
    out[index] = magnitude[index]! >= threshold ? 1 : 0;
  }
  return out;
};

const dilate = (edgeMap: Uint8Array, W: number, H: number, lineWidth: number) => {
  const out = new Uint8Array(W * H);
  const radius = Math.max(0, (lineWidth - 1) / 2);
  const extent = Math.ceil(radius);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (edgeMap[y * W + x] === 0) continue;
      for (let dy = -extent; dy <= extent; dy += 1) {
        for (let dx = -extent; dx <= extent; dx += 1) {
          if (Math.hypot(dx, dy) > radius + 0.35) continue;
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) out[ny * W + nx] = 1;
        }
      }
    }
  }
  return out;
};

export const optionTypes = {
  source: {
    type: ENUM,
    options: [
      { name: "XDoG clean lines", value: EDGE_SOURCE.XDOG },
      { name: "Sobel", value: EDGE_SOURCE.SOBEL },
      { name: "Laplacian", value: EDGE_SOURCE.LAPLACIAN },
    ],
    default: EDGE_SOURCE.XDOG,
    desc: "Line extractor: multi-scale XDoG suppresses texture; legacy modes retain saved-chain compatibility",
  },
  threshold: {
    type: RANGE,
    range: [5, 180],
    step: 1,
    default: 74,
    desc: "Minimum structural edge strength that becomes an ink line",
  },
  sigma: {
    type: RANGE,
    range: [0.5, 4],
    step: 0.1,
    default: 1.15,
    desc: "Fine Gaussian scale used by XDoG line extraction",
  },
  scaleRatio: {
    type: RANGE,
    range: [1.2, 4],
    step: 0.1,
    default: 2.2,
    desc: "Ratio between XDoG fine and coarse Gaussian scales",
  },
  lineSoftness: {
    type: RANGE,
    range: [4, 80],
    step: 1,
    default: 34,
    desc: "Soft-threshold slope of XDoG ink edges",
  },
  textureSuppression: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.62,
    desc: "Reject weak scale-space responses caused by photographic texture",
  },
  lineWidth: {
    type: RANGE,
    range: [0.1, 4],
    step: 0.1,
    default: 1,
    desc: "Thickness of the final ink contour",
  },
  lineColor: { type: COLOR, default: [34, 25, 31], desc: "Ink line color" },
  renderMode: {
    type: ENUM,
    options: [
      { name: "Overlay", value: RENDER_MODE.OVERLAY },
      { name: "Solid", value: RENDER_MODE.SOLID },
    ],
    default: RENDER_MODE.OVERLAY,
    desc: "Composite lines over the source or render a standalone line drawing",
  },
  overlayMix: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.72,
    desc: "Opacity of ink over the source in Overlay mode",
  },
  bgColor: { type: COLOR, default: [255, 255, 255], desc: "Paper color used by Solid mode" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  source: optionTypes.source.default,
  threshold: optionTypes.threshold.default,
  sigma: optionTypes.sigma.default,
  scaleRatio: optionTypes.scaleRatio.default,
  lineSoftness: optionTypes.lineSoftness.default,
  textureSuppression: optionTypes.textureSuppression.default,
  lineWidth: optionTypes.lineWidth.default,
  lineColor: optionTypes.lineColor.default,
  renderMode: optionTypes.renderMode.default,
  overlayMix: optionTypes.overlayMix.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const MAX_RADIUS = 16;
const LUMA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
void main() {
  vec3 color = texture(u_source, v_uv).rgb;
  fragColor = vec4(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.0, 0.0, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2 u_res;
uniform vec2 u_axis;
uniform int u_radius;
uniform float u_weights[${MAX_RADIUS * 2 + 1}];
void main() {
  vec2 pixel = v_uv * u_res;
  float total = 0.0;
  for (int offset = -${MAX_RADIUS}; offset <= ${MAX_RADIUS}; offset++) {
    if (offset < -u_radius || offset > u_radius) continue;
    vec2 samplePixel = clamp(pixel + u_axis * float(offset), vec2(0.5), u_res - vec2(0.5));
    total += texture(u_input, samplePixel / u_res).r * u_weights[offset + ${MAX_RADIUS}];
  }
  fragColor = vec4(total, 0.0, 0.0, 1.0);
}`;

const RENDER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_fine;
uniform sampler2D u_coarse;
uniform vec2 u_res;
uniform int u_mode;
uniform float u_threshold;
uniform float u_softness;
uniform float u_textureSuppression;
uniform int u_radius;
uniform float u_reach;
uniform vec3 u_lineColor;
uniform vec3 u_bgColor;
uniform int u_overlay;
uniform float u_overlayMix;

float lumAt(vec2 uv) { return dot(texture(u_source, clamp(uv, 0.0, 1.0)).rgb, vec3(0.2126, 0.7152, 0.0722)); }

float legacyInk(vec2 uv) {
  vec2 p = 1.0 / u_res;
  float center = lumAt(uv) * 255.0;
  if (u_mode == 2) {
    float laplacian = abs(lumAt(uv - vec2(p.x, 0.0)) * 255.0
      + lumAt(uv + vec2(p.x, 0.0)) * 255.0
      + lumAt(uv - vec2(0.0, p.y)) * 255.0
      + lumAt(uv + vec2(0.0, p.y)) * 255.0 - center * 4.0);
    return smoothstep(u_threshold, u_threshold + 8.0, laplacian);
  }
  float a=lumAt(uv+p*vec2(-1,-1))*255.0, b=lumAt(uv+p*vec2(0,-1))*255.0;
  float c=lumAt(uv+p*vec2(1,-1))*255.0, d=lumAt(uv+p*vec2(-1,0))*255.0;
  float f=lumAt(uv+p*vec2(1,0))*255.0, g=lumAt(uv+p*vec2(-1,1))*255.0;
  float h=lumAt(uv+p*vec2(0,1))*255.0, i=lumAt(uv+p*vec2(1,1))*255.0;
  float gx=(c+2.0*f+i)-(a+2.0*d+g), gy=(g+2.0*h+i)-(a+2.0*b+c);
  return smoothstep(u_threshold, u_threshold + 12.0, length(vec2(gx, gy)));
}

float xdogInk(vec2 uv) {
  float fine = texture(u_fine, uv).r;
  float coarse = texture(u_coarse, uv).r;
  float difference = fine - coarse;
  float epsilon = (70.0 - u_threshold) / 1024.0;
  float ink = difference >= epsilon ? 0.0 : clamp(-tanh(u_softness * (difference - epsilon)), 0.0, 1.0);
  float structural = smoothstep(0.006, 0.055, abs(difference));
  return ink * mix(1.0, structural, u_textureSuppression);
}

float inkAt(vec2 uv) { return u_mode == 0 ? xdogInk(uv) : legacyInk(uv); }

void main() {
  float ink = 0.0;
  vec2 texel = 1.0 / u_res;
  for (int y = -4; y <= 4; y++) {
    if (y < -u_radius || y > u_radius) continue;
    for (int x = -4; x <= 4; x++) {
      if (x < -u_radius || x > u_radius) continue;
      if (length(vec2(float(x), float(y))) > u_reach) continue;
      ink = max(ink, inkAt(v_uv + texel * vec2(float(x), float(y))));
    }
  }
  vec4 source = texture(u_source, v_uv);
  vec3 base = u_overlay == 1 ? source.rgb : u_bgColor;
  float opacity = ink * (u_overlay == 1 ? u_overlayMix : 1.0);
  fragColor = vec4(mix(base, u_lineColor, opacity), u_overlay == 1 ? source.a : 1.0);
}`;

type Cache = { luma: Program; blur: Program; render: Program };
let cache: Cache | null = null;
const getCache = (gl: WebGL2RenderingContext): Cache => {
  if (cache) return cache;
  cache = {
    luma: linkProgram(gl, LUMA_FS, ["u_source"] as const),
    blur: linkProgram(gl, BLUR_FS, [
      "u_input",
      "u_res",
      "u_axis",
      "u_radius",
      "u_weights",
    ] as const),
    render: linkProgram(gl, RENDER_FS, [
      "u_source",
      "u_fine",
      "u_coarse",
      "u_res",
      "u_mode",
      "u_threshold",
      "u_softness",
      "u_textureSuppression",
      "u_radius",
      "u_reach",
      "u_lineColor",
      "u_bgColor",
      "u_overlay",
      "u_overlayMix",
    ] as const),
  };
  return cache;
};

const kernel = (sigma: number): { radius: number; weights: Float32Array } => {
  const safeSigma = Math.max(0.2, sigma);
  const radius = Math.min(MAX_RADIUS, Math.max(1, Math.ceil(safeSigma * 3)));
  const weights = new Float32Array(MAX_RADIUS * 2 + 1);
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * safeSigma * safeSigma));
    weights[offset + MAX_RADIUS] = weight;
    total += weight;
  }
  for (let offset = -radius; offset <= radius; offset += 1) weights[offset + MAX_RADIUS] /= total;
  return { radius, weights };
};

const runBlur = (
  gl: WebGL2RenderingContext,
  program: Program,
  vao: WebGLVertexArrayObject,
  input: TexEntry,
  horizontal: TexEntry,
  output: TexEntry,
  W: number,
  H: number,
  sigma: number,
) => {
  const { radius, weights } = kernel(sigma);
  const pass = (source: TexEntry, target: TexEntry, x: number, y: number) => {
    drawPass(
      gl,
      target,
      W,
      H,
      program,
      () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, source.tex);
        gl.uniform1i(program.uniforms.u_input, 0);
        gl.uniform2f(program.uniforms.u_res, W, H);
        gl.uniform2f(program.uniforms.u_axis, x, y);
        gl.uniform1i(program.uniforms.u_radius, radius);
        gl.uniform1fv(program.uniforms.u_weights, weights);
      },
      vao,
    );
  };
  pass(input, horizontal, 1, 0);
  pass(horizontal, output, 0, 1);
};

const edgeMode: Record<string, number> = { XDOG: 0, SOBEL: 1, LAPLACIAN: 2 };

const renderGL = (input: HTMLCanvasElement | OffscreenCanvas, options: typeof defaults) => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  const programs = getCache(gl),
    vao = getQuadVAO(gl);
  const W = input.width,
    H = input.height;
  resizeGLCanvas(canvas, W, H);
  const source = ensureTexture(gl, "animeInk:source", W, H);
  const luma = ensureTexture(gl, "animeInk:luma", W, H);
  const fineH = ensureTexture(gl, "animeInk:fineH", W, H);
  const fine = ensureTexture(gl, "animeInk:fine", W, H);
  const coarseH = ensureTexture(gl, "animeInk:coarseH", W, H);
  const coarse = ensureTexture(gl, "animeInk:coarse", W, H);
  uploadSourceTexture(gl, source, input);
  drawPass(
    gl,
    luma,
    W,
    H,
    programs.luma,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.tex);
      gl.uniform1i(programs.luma.uniforms.u_source, 0);
    },
    vao,
  );
  runBlur(gl, programs.blur, vao, luma, fineH, fine, W, H, options.sigma);
  runBlur(gl, programs.blur, vao, luma, coarseH, coarse, W, H, options.sigma * options.scaleRatio);
  const radius = Math.min(4, Math.max(0, Math.ceil(options.lineWidth - 1)));
  drawPass(
    gl,
    null,
    W,
    H,
    programs.render,
    () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.tex);
      gl.uniform1i(programs.render.uniforms.u_source, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fine.tex);
      gl.uniform1i(programs.render.uniforms.u_fine, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, coarse.tex);
      gl.uniform1i(programs.render.uniforms.u_coarse, 2);
      gl.uniform2f(programs.render.uniforms.u_res, W, H);
      gl.uniform1i(programs.render.uniforms.u_mode, edgeMode[String(options.source)] ?? 0);
      gl.uniform1f(programs.render.uniforms.u_threshold, options.threshold);
      gl.uniform1f(programs.render.uniforms.u_softness, options.lineSoftness);
      gl.uniform1f(programs.render.uniforms.u_textureSuppression, options.textureSuppression);
      gl.uniform1i(programs.render.uniforms.u_radius, radius);
      gl.uniform1f(programs.render.uniforms.u_reach, Math.max(0.35, options.lineWidth - 0.65));
      gl.uniform3f(
        programs.render.uniforms.u_lineColor,
        options.lineColor[0]! / 255,
        options.lineColor[1]! / 255,
        options.lineColor[2]! / 255,
      );
      gl.uniform3f(
        programs.render.uniforms.u_bgColor,
        options.bgColor[0]! / 255,
        options.bgColor[1]! / 255,
        options.bgColor[2]! / 255,
      );
      gl.uniform1i(
        programs.render.uniforms.u_overlay,
        options.renderMode === RENDER_MODE.OVERLAY ? 1 : 0,
      );
      gl.uniform1f(programs.render.uniforms.u_overlayMix, options.overlayMix);
    },
    vao,
  );
  return readoutToCanvas(canvas, W, H);
};

const animeInkLines = (input: any, options: Record<string, any> = defaults) => {
  const resolved: typeof defaults & Record<string, any> = { ...defaults, ...options };
  const W = input.width,
    H = input.height;
  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const rendered = renderGL(input, resolved);
    if (rendered) {
      const identity = paletteIsIdentity(resolved.palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, resolved.palette);
      if (out) {
        logFilterBackend(
          "Anime Ink Lines",
          "WebGL2",
          `${resolved.source}${identity ? "" : "+palettePass"}`,
        );
        return out;
      }
    }
  }

  logFilterWasmStatus("Anime Ink Lines", false, "legacy CPU line fallback");
  const output = cloneCanvas(input, false);
  const inputContext = input.getContext("2d"),
    outputContext = output.getContext("2d");
  if (!inputContext || !outputContext) return input;
  const source = inputContext.getImageData(0, 0, W, H).data;
  const luminance = computeLuminance(source, W, H);
  const magnitude =
    String(resolved.source) === EDGE_SOURCE.LAPLACIAN
      ? laplacianEdges(luminance, W, H)
      : sobelEdges(luminance, W, H).magnitude;
  const edges = dilate(thresholdMap(magnitude, resolved.threshold), W, H, resolved.lineWidth);
  const pixels = new Uint8ClampedArray(source.length);
  const overlay = resolved.renderMode === RENDER_MODE.OVERLAY;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const index = getBufferIndex(x, y, W),
        edge = edges[y * W + x] === 1;
      const base = overlay
        ? [source[index]!, source[index + 1]!, source[index + 2]!]
        : resolved.bgColor;
      const amount = edge ? (overlay ? clamp(0, 1, resolved.overlayMix) : 1) : 0;
      const color = srgbPaletteGetColor(
        resolved.palette,
        rgba(
          Math.round(base[0]! + (resolved.lineColor[0]! - base[0]!) * amount),
          Math.round(base[1]! + (resolved.lineColor[1]! - base[1]!) * amount),
          Math.round(base[2]! + (resolved.lineColor[2]! - base[2]!) * amount),
          255,
        ),
        resolved.palette.options,
      );
      fillBufferPixel(pixels, index, color[0], color[1], color[2], 255);
    }
  }
  outputContext.putImageData(new ImageData(pixels, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Anime Ink Lines",
  func: animeInkLines,
  optionTypes,
  options: defaults,
  defaults,
  description: "Texture-suppressed XDoG contours composited as clean colored anime ink",
});
