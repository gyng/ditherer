import { RANGE, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  logFilterBackend,
  logFilterWasmStatus,
} from "../utils/index";
import { normalizeColorOption, normalizeRangeOption } from "../utils/filterOptions";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import {
  engravingShadowStructure,
  gradientTangent,
  lineCoverage,
  luminance01,
  PRINTMAKING_TONE_GLSL,
} from "./printmakingToneContracts";
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

// Copperplate / steel line engraving. Tone builds through a ladder of burin
// structures: the primary ruled lines swell with darkness, a crossing set
// enters the mid-shadows, and a lozenge/dot texture fills the deepest shadows
// — so a shadow no longer collapses into a single thick bar. The lines follow
// the subject's form gently (structure-tensor tangent) around the ruled base
// angle. The inked fraction rises monotonically with darkness.

const FOLLOW = 0.5;

export const optionTypes = {
  lineSpacing: { type: RANGE, range: [2, 12], step: 1, default: 4, desc: "Distance between engraved lines" },
  angle: { type: RANGE, range: [0, 180], step: 5, default: 45, desc: "Base burin line angle in degrees" },
  inkColor: { type: COLOR, default: [10, 10, 20], desc: "Engraved line color" },
  paperColor: { type: COLOR, default: [250, 245, 235], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  lineSpacing: optionTypes.lineSpacing.default,
  angle: optionTypes.angle.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const ENGRAVE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2  u_res;
uniform float u_lineSpacing;
uniform float u_baseAngle;    // radians
uniform vec3  u_inkColor;     // 0..1
uniform vec3  u_paperColor;
uniform float u_levels;

${PRINTMAKING_TONE_GLSL}

float lumaAt(float jsX, float jsY) {
  float sx = clamp(jsX, 0.0, u_res.x - 1.0);
  float sy = clamp(jsY, 0.0, u_res.y - 1.0);
  return pm_luma(texture(u_source, vec2((sx + 0.5) / u_res.x, 1.0 - (sy + 0.5) / u_res.y)).rgb);
}

float ruledCoverage(vec2 pos, vec2 across, float spacing, float coverage) {
  float proj = dot(pos, across);
  float m = mod(proj, spacing);
  float dist = min(m, spacing - m);
  float hw = 0.5 * clamp(coverage, 0.0, 0.95) * spacing;
  return pm_lineCoverage(dist, hw, 0.75);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);
  vec2 suv = vec2((x + 0.5) / u_res.x, 1.0 - (y + 0.5) / u_res.y);
  vec4 src = texture(u_source, suv);
  float darkness = 1.0 - pm_luma(src.rgb);

  // Copperplate tone ladder.
  float primaryFill = clamp(darkness / 0.55, 0.0, 1.0);
  float secondaryFill = clamp((darkness - 0.4) / 0.4, 0.0, 1.0);
  float lozengeFill = clamp((darkness - 0.72) / 0.28, 0.0, 1.0);

  // Gentle form following around the ruled base angle.
  vec2 grad = vec2(lumaAt(x + 1.0, y) - lumaAt(x - 1.0, y),
                   lumaAt(x, y + 1.0) - lumaAt(x, y - 1.0));
  vec2 baseDir = vec2(cos(u_baseAngle), sin(u_baseAngle));
  vec2 dir = baseDir;
  if (length(grad) > 0.02) {
    vec2 tan = pm_gradientTangent(grad.x, grad.y);
    if (dot(tan, baseDir) < 0.0) tan = -tan;
    dir = normalize(mix(baseDir, tan, ${FOLLOW.toFixed(2)}));
  }
  vec2 acrossPrimary = vec2(-dir.y, dir.x);
  vec2 acrossSecondary = dir;

  vec2 pos = vec2(x, y);
  float c1 = ruledCoverage(pos, acrossPrimary, u_lineSpacing, 0.5 * primaryFill);
  float c2 = ruledCoverage(pos, acrossSecondary, u_lineSpacing, 0.5 * secondaryFill);

  // Lozenge / dot texture on a lattice aligned to the line grid.
  float cellX = mod(dot(pos, acrossPrimary), u_lineSpacing) - u_lineSpacing * 0.5;
  float cellY = mod(dot(pos, acrossSecondary), u_lineSpacing) - u_lineSpacing * 0.5;
  float dotDist = length(vec2(cellX, cellY));
  float dotR = lozengeFill * u_lineSpacing * 0.32;
  float c3 = pm_lineCoverage(dotDist, dotR, 0.75);

  float ink = 1.0 - (1.0 - c1) * (1.0 - c2) * (1.0 - c3);
  vec3 rgb = mix(u_paperColor, u_inkColor, ink);
  if (u_levels > 1.5) {
    float q = u_levels - 1.0;
    rgb = floor(rgb * q + 0.5) / q;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), src.a);
}
`;

type Cache = { eng: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    eng: linkProgram(gl, ENGRAVE_FS, [
      "u_source", "u_res", "u_lineSpacing", "u_baseAngle",
      "u_inkColor", "u_paperColor", "u_levels",
    ] as const),
  };
  return _cache;
};

const engraving = (input: any, options: Partial<typeof defaults> = defaults) => {
  const lineSpacing = normalizeRangeOption(options.lineSpacing, defaults.lineSpacing, 2, 12);
  const angle = normalizeRangeOption(options.angle, defaults.angle, 0, 180);
  const inkColor = normalizeColorOption(options.inkColor, defaults.inkColor);
  const paperColor = normalizeColorOption(options.paperColor, defaults.paperColor);
  const palette = options.palette ?? defaults.palette;
  const W = input.width, H = input.height;
  const baseAngle = (angle * Math.PI) / 180;

  if (glAvailable() && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false) {
    const ctx = getGLCtx();
    if (ctx) {
      const { gl, canvas } = ctx;
      const cache = initCache(gl);
      const vao = getQuadVAO(gl);
      resizeGLCanvas(canvas, W, H);
      const sourceTex = ensureTexture(gl, "engraving:source", W, H);
      uploadSourceTexture(gl, sourceTex, input);

      drawPass(gl, null, W, H, cache.eng, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
        gl.uniform1i(cache.eng.uniforms.u_source, 0);
        gl.uniform2f(cache.eng.uniforms.u_res, W, H);
        gl.uniform1f(cache.eng.uniforms.u_lineSpacing, lineSpacing);
        gl.uniform1f(cache.eng.uniforms.u_baseAngle, baseAngle);
        gl.uniform3f(cache.eng.uniforms.u_inkColor, inkColor[0] / 255, inkColor[1] / 255, inkColor[2] / 255);
        gl.uniform3f(cache.eng.uniforms.u_paperColor, paperColor[0] / 255, paperColor[1] / 255, paperColor[2] / 255);
        const identity = paletteIsIdentity(palette);
        const pOpts = (palette as { options?: { levels?: number } }).options;
        gl.uniform1f(cache.eng.uniforms.u_levels, identity ? (pOpts?.levels ?? 256) : 256);
      }, vao);

      const rendered = readoutToCanvas(canvas, W, H);
      if (rendered) {
        const identity = paletteIsIdentity(palette);
        const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
        if (out) {
          logFilterBackend("Engraving", "WebGL2",
            `spacing=${lineSpacing}${identity ? "" : "+palettePass"}`);
          return out;
        }
      }
    }
  }

  logFilterWasmStatus("Engraving", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const identity = paletteIsIdentity(palette);
  const baseDir: [number, number] = [Math.cos(baseAngle), Math.sin(baseAngle)];

  const lumaAt = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(W - 1, x));
    const cy = Math.max(0, Math.min(H - 1, y));
    const i = getBufferIndex(cx, cy, W);
    return luminance01(buf[i], buf[i + 1], buf[i + 2]);
  };
  const ruled = (px: number, py: number, ax: number, ay: number, coverage: number): number => {
    const proj = px * ax + py * ay;
    const m = ((proj % lineSpacing) + lineSpacing) % lineSpacing;
    const dist = Math.min(m, lineSpacing - m);
    const hw = 0.5 * Math.max(0, Math.min(0.95, coverage)) * lineSpacing;
    return lineCoverage(dist, hw, 0.75);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const darkness = 1 - luminance01(buf[i], buf[i + 1], buf[i + 2]);
      const { primaryFill, secondaryFill, lozengeFill } = engravingShadowStructure(darkness);

      const gx = lumaAt(x + 1, y) - lumaAt(x - 1, y);
      const gy = lumaAt(x, y + 1) - lumaAt(x, y - 1);
      let dir = baseDir;
      if (Math.hypot(gx, gy) > 0.02) {
        let [tx, ty] = gradientTangent(gx, gy);
        if (tx * baseDir[0] + ty * baseDir[1] < 0) { tx = -tx; ty = -ty; }
        const mx = baseDir[0] + (tx - baseDir[0]) * FOLLOW;
        const my = baseDir[1] + (ty - baseDir[1]) * FOLLOW;
        const mlen = Math.hypot(mx, my) || 1;
        dir = [mx / mlen, my / mlen];
      }
      const apX = -dir[1], apY = dir[0];
      const asX = dir[0], asY = dir[1];

      const c1 = ruled(x, y, apX, apY, 0.5 * primaryFill);
      const c2 = ruled(x, y, asX, asY, 0.5 * secondaryFill);
      const cellX = (((x * apX + y * apY) % lineSpacing) + lineSpacing) % lineSpacing - lineSpacing / 2;
      const cellY = (((x * asX + y * asY) % lineSpacing) + lineSpacing) % lineSpacing - lineSpacing / 2;
      const dotR = lozengeFill * lineSpacing * 0.32;
      const c3 = lineCoverage(Math.hypot(cellX, cellY), dotR, 0.75);

      const ink = 1 - (1 - c1) * (1 - c2) * (1 - c3);
      const r = paperColor[0] + (inkColor[0] - paperColor[0]) * ink;
      const g = paperColor[1] + (inkColor[1] - paperColor[1]) * ink;
      const b = paperColor[2] + (inkColor[2] - paperColor[2]) * ink;
      fillBufferPixel(outBuf, i, r, g, b, buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return identity ? output : (applyPalettePassToCanvas(output, W, H, palette) ?? output);
};

export default defineFilter({
  name: "Engraving",
  func: engraving,
  optionTypes,
  options: defaults,
  defaults,
  description: "Copperplate line engraving — swelling burin lines with a crossing set and dot-and-lozenge shadow texture that follow the subject's form",
});
