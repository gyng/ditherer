import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { photocopierGenerationTone } from "./substrateCopyQualityContracts";
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

export const optionTypes = {
  contrast: {
    type: RANGE,
    range: [0.75, 3],
    step: 0.05,
    default: 1.55,
    desc: "Xerographic density contrast without discrete posterization",
  },
  edgeDarken: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.3,
    desc: "Toner buildup along high-contrast detail edges",
  },
  speckle: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.08,
    desc: "Fixed toner deposits in light areas and transfer voids in dense areas",
  },
  generationLoss: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.25,
    desc: "Copy-of-a-copy detail loss and progressive density buildup",
  },
  palette: { type: PALETTE, default: nearest, desc: "Output toner and paper palette" },
};

export const defaults = {
  contrast: optionTypes.contrast.default,
  edgeDarken: optionTypes.edgeDarken.default,
  speckle: optionTypes.speckle.default,
  generationLoss: optionTypes.generationLoss.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const PC_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_contrast;
uniform float u_edgeDarken;
uniform float u_speckle;
uniform float u_generationLoss;
uniform float u_levels;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float lum(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec3 samplePx(float sx, float sy) {
  float cx = clamp(floor(sx), 0.0, u_res.x - 1.0);
  float cy = clamp(floor(sy), 0.0, u_res.y - 1.0);
  vec2 uv = vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y);
  return texture(u_source, uv).rgb;
}

float generationTone(float source, float localMean) {
  float softened = mix(source, localMean, u_generationLoss * 0.72);
  float denser = clamp(softened + (softened - 0.5) * u_generationLoss * 0.18, 0.0, 1.0);
  float distance = min(1.0, abs(denser * 2.0 - 1.0));
  return clamp(0.5 + sign(denser - 0.5) * 0.5 * pow(distance, 1.0 / max(0.25, u_contrast)), 0.0, 1.0);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 self = texture(u_source, suv);

  float sourceLuma = lum(self.rgb);
  float radius = 1.0 + floor(u_generationLoss * 2.0 + 0.5);
  float localMean = (sourceLuma
    + lum(samplePx(x - radius, y))
    + lum(samplePx(x + radius, y))
    + lum(samplePx(x, y - radius))
    + lum(samplePx(x, y + radius))) * 0.2;
  float l = generationTone(sourceLuma, localMean);

  if (u_edgeDarken > 0.0 && x > 0.0 && x < u_res.x - 1.0 && y > 0.0 && y < u_res.y - 1.0) {
    float a = lum(samplePx(x - 1.0, y - 1.0));
    float b = lum(samplePx(x,       y - 1.0));
    float c = lum(samplePx(x + 1.0, y - 1.0));
    float d = lum(samplePx(x - 1.0, y      ));
    float f = lum(samplePx(x + 1.0, y      ));
    float g = lum(samplePx(x - 1.0, y + 1.0));
    float h = lum(samplePx(x,       y + 1.0));
    float iv = lum(samplePx(x + 1.0, y + 1.0));
    float gx = -a - 2.0 * d - g + c + 2.0 * f + iv;
    float gy = -a - 2.0 * b - c + g + 2.0 * h + iv;
    float edge = sqrt(gx * gx + gy * gy) / 5.66;
    l = max(0.0, l - edge * u_edgeDarken);
  }

  float artifact = clamp(u_speckle, 0.0, 1.0);
  float depositGate = hash(vec2(x + 17.0, y + 31.0));
  float voidGate = hash(vec2(x + 73.0, y + 11.0));
  float density = 1.0 - l;
  if (depositGate < artifact * 0.16 * (0.25 + 0.75 * l)) {
    l -= artifact * (0.08 + 0.34 * hash(vec2(x + 5.0, y + 97.0)));
  }
  if (voidGate < artifact * 0.12 * (0.2 + 0.8 * density)) {
    l += artifact * (0.06 + 0.3 * hash(vec2(x + 109.0, y + 43.0)));
  }
  l = clamp(l, 0.0, 1.0);

  vec3 rgb = vec3(l);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), self.a);
}
`;

type Cache = { pc: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    pc: linkProgram(gl, PC_FS, [
      "u_source",
      "u_res",
      "u_contrast",
      "u_edgeDarken",
      "u_speckle",
      "u_generationLoss",
      "u_levels",
    ] as const),
  };
  return _cache;
};

const coordinateHash = (x: number, y: number, offset = 0): number => {
  let value = Math.imul(x + offset, 0x1f123bb5) ^ Math.imul(y - offset, 0x5f356495);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

const photocopier = (input: any, options: Partial<typeof defaults> = defaults) => {
  const { contrast, edgeDarken, speckle, generationLoss, palette } = { ...defaults, ...options };
  const W = input.width,
    H = input.height;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "photocopier:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(
        gl,
        null,
        W,
        H,
        cache.pc,
        () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
          gl.uniform1i(cache.pc.uniforms.u_source, 0);
          gl.uniform2f(cache.pc.uniforms.u_res, W, H);
          gl.uniform1f(cache.pc.uniforms.u_contrast, contrast);
          gl.uniform1f(cache.pc.uniforms.u_edgeDarken, edgeDarken);
          gl.uniform1f(cache.pc.uniforms.u_speckle, speckle);
          gl.uniform1f(cache.pc.uniforms.u_generationLoss, generationLoss);
          const identity = paletteIsIdentity(palette);
          const pOpts = (palette as { options?: { levels?: number } }).options;
          gl.uniform1f(cache.pc.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
        },
        vao,
      );

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend(
            "Photocopier",
            "WebGL2",
            `contrast=${contrast}${identity ? "" : "+palettePass"}`,
          );
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Photocopier", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const sourceLuma = lum[y * W + x] / 255;
      const radius = 1 + Math.round(generationLoss * 2);
      const left = lum[y * W + Math.max(0, x - radius)] / 255;
      const right = lum[y * W + Math.min(W - 1, x + radius)] / 255;
      const top = lum[Math.max(0, y - radius) * W + x] / 255;
      const bottom = lum[Math.min(H - 1, y + radius) * W + x] / 255;
      let l = photocopierGenerationTone(
        sourceLuma,
        (sourceLuma + left + right + top + bottom) / 5,
        contrast,
        generationLoss,
      );

      if (edgeDarken > 0 && x > 0 && x < W - 1 && y > 0 && y < H - 1) {
        const gx =
          -lum[(y - 1) * W + (x - 1)] -
          2 * lum[y * W + (x - 1)] -
          lum[(y + 1) * W + (x - 1)] +
          lum[(y - 1) * W + (x + 1)] +
          2 * lum[y * W + (x + 1)] +
          lum[(y + 1) * W + (x + 1)];
        const gy =
          -lum[(y - 1) * W + (x - 1)] -
          2 * lum[(y - 1) * W + x] -
          lum[(y - 1) * W + (x + 1)] +
          lum[(y + 1) * W + (x - 1)] +
          2 * lum[(y + 1) * W + x] +
          lum[(y + 1) * W + (x + 1)];
        const edge = Math.sqrt(gx * gx + gy * gy) / 1440;
        l -= edge * edgeDarken;
        l = Math.max(0, l);
      }

      const artifact = Math.min(1, speckle);
      const density = 1 - l;
      if (coordinateHash(x, y, 17) < artifact * 0.16 * (0.25 + 0.75 * l)) {
        l -= artifact * (0.08 + 0.34 * coordinateHash(x, y, 5));
      }
      if (coordinateHash(x, y, 73) < artifact * 0.12 * (0.2 + 0.8 * density)) {
        l += artifact * (0.06 + 0.3 * coordinateHash(x, y, 109));
      }
      l = Math.max(0, Math.min(1, l));

      const v = Math.round(l * 255);
      const color = paletteGetColor(palette, rgba(v, v, v, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Photocopier",
  func: photocopier,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Fixed-sheet xerographic copy with continuous density transfer, edge toner, background scatter, and transfer voids",
});
