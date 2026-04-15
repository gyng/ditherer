// WebGL2 renderer for the rgbStripe (CRT emulation) filter.
//
// Why: the CPU pipeline runs ~480ms at 1280x720 because the per-pixel work
// is heavy (Newton barrel inversion, 3-channel misconvergence sample, full
// brightness/contrast/gamma chain, palette quantize, separable bloom).
// Every per-pixel operation maps cleanly to a fragment shader, and the GPU
// chews through 1M pixels in <1ms per pass. With ~5 passes we expect total
// render time in the 10-15ms range including upload and readback.
//
// Rendering strategy: ping-pong between two RGBA8 textures bound to FBOs,
// then drawImage the GL canvas onto the returned 2D canvas. We always
// upload with UNPACK_FLIP_Y_WEBGL so input texture orientation matches the
// source canvas; the final drawImage handles the framebuffer flip.
//
// Bit-parity with the JS path is NOT a goal — float vs double precision and
// shader transcendentals will drift by ±1-2 per channel. Visual parity is.

import nearestPalette from "palettes/nearest";

type RenderOpts = {
  width: number;
  height: number;
  // mask + size
  mask: Float32Array; // flat row-major RGB, length = maskW * maskH * 3
  maskW: number;
  maskH: number;
  // main loop
  brightness: number;
  contrast: number;
  exposure: number;
  gamma: number;
  phosphorScale: number;
  scanlineGap: number;
  scanlineStrength: number;
  includeScanline: boolean;
  misconvergence: number;
  curvature: number;
  vignette: number;
  interlace: boolean;
  interlaceField: number;
  flicker: number;
  frameIndex: number;
  isDegaussing: boolean;
  degaussAge: number;
  degaussT: number;
  degaussWobbleX: number;
  degaussWobbleY: number;
  // post passes
  beamSpread: number;
  bloom: boolean;
  bloomThreshold: number;
  bloomRadius: number;
  bloomStrength: number;
  persistence: number;
  // palette: only nearest is supported here; non-nearest forces JS fallback.
  paletteLevels: number;
  // optional prev-frame data for interlace + persistence (length must match)
  prevOutput: Uint8ClampedArray | null;
};

let _gl: WebGL2RenderingContext | null = null;
let _glCanvas: HTMLCanvasElement | null = null;
let _supportChecked = false;
let _supported = false;

const getCtx = (): WebGL2RenderingContext | null => {
  if (_gl) return _gl;
  if (_supportChecked && !_supported) return null;
  _supportChecked = true;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  // Premultiplied-alpha off so we can pass straight 0-255 byte data round trip.
  const gl = c.getContext("webgl2", {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;
  _supported = true;
  _gl = gl;
  _glCanvas = c;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return gl;
};

// Detection-only wrapper used by callers that want to choose between paths
// before spending time setting up render data.
export const rgbStripeGLAvailable = (): boolean => getCtx() !== null;

// ── shader plumbing ────────────────────────────────────────────────────────

// Standard no-flip vertex shader. v_uv is in framebuffer space:
// (0,0) bottom-left, (1,1) top-right. With UNPACK_FLIP_Y_WEBGL=true on
// input upload, texture row 0 = source row 0 (top). drawImage from the GL
// canvas to the 2D canvas flips the framebuffer, so 2D-canvas row N ends
// up at framebuffer y=H-1-N. Main shader converts px.y → JS-y explicitly.
const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Main pass: curvature + degauss warp + misconvergence + degauss hue + mask
// + brightness/contrast/gamma + scanline + flicker + vignette + nearest
// palette quantize. Matches the JS reference math at f32 precision.
const FS_MAIN = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform sampler2D u_mask;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform vec2 u_maskSize;     // (maskW, maskH)

uniform float u_brightness;  // 0-255 add
uniform float u_contrast;
uniform float u_exposure;
uniform float u_invGamma;    // 1 / gamma

uniform float u_phosphorScale;
uniform int   u_scanlineGap;
uniform float u_scanlineStrength;
uniform int   u_includeScanline;

uniform float u_misconvergence;
uniform float u_curvature;
uniform float u_vignette;

uniform int   u_interlace;
uniform int   u_interlaceField;
uniform int   u_hasPrev;

uniform float u_flicker;
uniform float u_flickerAmount;

uniform int   u_isDegaussing;
uniform float u_degaussAge;
uniform float u_degaussT;
uniform float u_degaussWobbleX;
uniform float u_degaussWobbleY;
uniform float u_degaussMiscBoost;  // misconvergence + degauss extra

uniform int   u_paletteLevels;     // 0 = identity (skip palette pass)

float invertRadius(float rDst, float k) {
  if (rDst == 0.0) return 0.0;
  float r = rDst;
  for (int i = 0; i < 8; i++) {
    float r2 = r * r;
    float f = r * (1.0 + k * r2) - rDst;
    float fp = 1.0 + 3.0 * k * r2;
    if (fp != 0.0) r -= f / fp;
  }
  return r;
}

// Takes a JS-oriented pixel position (y=0 at top). UNPACK_FLIP_Y_WEBGL=true
// stores the texture upside-down relative to the source (row 0 = source
// bottom), so we flip y when sampling.
vec4 readClamped(sampler2D s, vec2 px) {
  vec2 cp = clamp(px, vec2(0.0), u_res - vec2(1.0));
  return texture(s, vec2(cp.x + 0.5, u_res.y - 0.5 - cp.y) / u_res);
}

void main() {
  // Framebuffer-space pixel coord (y=0 at bottom).
  vec2 px_fb = floor(v_uv * u_res);
  float x = px_fb.x;
  // JS-space y (0 at top) — matches the reference loop's y. drawImage flips
  // the framebuffer on copy to the 2D canvas so fb-bottom ends up at
  // 2D-canvas bottom; rewriting y here makes the shader's per-pixel math
  // identical to the JS path without rewiring sampling helpers.
  float y = u_res.y - 1.0 - px_fb.y;

  // Interlace early-out: copy prev frame on inactive scanlines.
  if (u_interlace == 1 && int(mod(y, 2.0)) != u_interlaceField) {
    if (u_hasPrev == 1) {
      fragColor = texture(u_prev, v_uv);
    } else {
      vec4 src = readClamped(u_input, vec2(x, y));
      fragColor = vec4(0.0, 0.0, 0.0, src.a);
    }
    return;
  }

  // Curvature.
  float srcX = x;
  float srcY = y;
  float cx = u_res.x * 0.5;
  float cy = u_res.y * 0.5;
  float rNorm = sqrt(cx * cx + cy * cy);
  if (u_curvature > 0.0) {
    float nx = (x - cx) / rNorm;
    float ny = (y - cy) / rNorm;
    float rDst = sqrt(nx * nx + ny * ny);
    float k = u_curvature * 2.0;
    float rSrc = invertRadius(rDst, k);
    float s = rDst > 0.0 ? rSrc / rDst : 1.0;
    srcX = floor(cx + nx * s * rNorm + 0.5);
    srcY = floor(cy + ny * s * rNorm + 0.5);
  }

  // Degauss raster warp.
  if (u_isDegaussing == 1) {
    float warpFreqX = 3.5 + u_degaussAge * 0.15;
    float warpFreqY = 2.8 + u_degaussAge * 0.12;
    float warpAmp = u_degaussT * u_degaussT * 40.0;
    srcX += floor(sin(y / u_res.y * 3.1415926535 * warpFreqY + u_degaussAge * 1.9) * warpAmp + 0.5);
    srcY += floor(sin(x / u_res.x * 3.1415926535 * warpFreqX + u_degaussAge * 2.7) * warpAmp * 0.5 + 0.5);
  }

  // Out of bounds → black.
  if (srcX < 0.0 || srcX >= u_res.x || srcY < 0.0 || srcY >= u_res.y) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Misconvergence + degauss wobble: 3 channel taps with per-channel offsets.
  float effMisc = u_misconvergence + u_degaussMiscBoost;
  vec3 src;
  float srcA;
  if (effMisc > 0.0) {
    float halfW = u_res.x * 0.5;
    float halfH = u_res.y * 0.5;
    float ddx = (x - halfW) / halfW;
    float ddy = (y - halfH) / halfH;
    float dist = sqrt(ddx * ddx + ddy * ddy);
    float offset = floor(effMisc * dist + 0.5);
    float rOffX = floor(ddx * offset + u_degaussWobbleX + 0.5);
    float rOffY = floor(ddy * offset * 0.3 + u_degaussWobbleY + 0.5);
    float bOffX = floor(-ddx * offset - u_degaussWobbleX * 0.7 + 0.5);
    float bOffY = floor(-ddy * offset * 0.3 - u_degaussWobbleY * 0.7 + 0.5);
    float gOffX = floor(u_degaussWobbleX * 0.3 + 0.5);
    float gOffY = floor(u_degaussWobbleY * 0.5 + 0.5);
    vec4 r = readClamped(u_input, vec2(srcX + rOffX, srcY + rOffY));
    vec4 g = readClamped(u_input, vec2(srcX + gOffX, srcY + gOffY));
    vec4 b = readClamped(u_input, vec2(srcX + bOffX, srcY + bOffY));
    src = vec3(r.r, g.g, b.b);
    srcA = readClamped(u_input, vec2(srcX, srcY)).a;
  } else {
    vec4 sample0 = readClamped(u_input, vec2(srcX, srcY));
    src = sample0.rgb;
    srcA = sample0.a;
  }

  // Degauss hue rotation.
  if (u_isDegaussing == 1) {
    float ddx = (x - cx) / cx;
    float ddy = (y - cy) / cy;
    float hueAngle = u_degaussT * u_degaussT * 3.1415926535 * 1.5
      * sin(ddx * 2.5 + u_degaussAge * 1.3)
      * cos(ddy * 2.0 + u_degaussAge * 0.9);
    float c = cos(hueAngle);
    float sn = sin(hueAngle);
    float r1 = src.r * (0.213 + 0.787 * c - 0.213 * sn)
             + src.g * (0.715 - 0.715 * c - 0.715 * sn)
             + src.b * (0.072 - 0.072 * c + 0.928 * sn);
    float g1 = src.r * (0.213 - 0.213 * c + 0.143 * sn)
             + src.g * (0.715 + 0.285 * c + 0.140 * sn)
             + src.b * (0.072 - 0.072 * c - 0.283 * sn);
    float b1 = src.r * (0.213 - 0.213 * c - 0.787 * sn)
             + src.g * (0.715 - 0.715 * c + 0.715 * sn)
             + src.b * (0.072 + 0.928 * c + 0.072 * sn);
    src = clamp(vec3(r1, g1, b1), 0.0, 1.0);
  }

  // Mask multiply (mask cell selected by floor(px / phosphorScale) mod size).
  vec2 maskCoord = mod(floor(vec2(x, y) / u_phosphorScale), u_maskSize);
  vec3 m = texture(u_mask, (maskCoord + 0.5) / u_maskSize).rgb;
  src *= m;

  // Brightness / contrast / gamma — translated from 0-255 JS math to 0-1.
  // brightness255 = src255 * exposure + brightness; n = src01 - 0.5 + brightness/255 * 0?
  // Easier: keep multiplier-then-add-in-0-255:
  vec3 v = src * 255.0 * u_exposure + vec3(u_brightness);
  // contrast: nC = v/255 - 0.5; out = (nC + factor*(nC-1)*nC*(nC-0.5) + 0.5) * 255
  vec3 nC = v / 255.0 - 0.5;
  v = (nC + u_contrast * (nC - 1.0) * nC * (nC - 0.5) + 0.5) * 255.0;
  // gamma: 255 * pow(v/255, invGamma). pow on negatives -> NaN; we clamp to 0
  // by multiplying with step(0, v/255) so the channel turns black instead of
  // returning NaN that would propagate into bloom.
  vec3 vNorm = v / 255.0;
  vec3 valid = step(0.0, vNorm);
  v = 255.0 * pow(max(vNorm, vec3(0.0)), vec3(u_invGamma)) * valid;

  // Scanline darken.
  float scanlineRow = floor(y / u_phosphorScale);
  float ss = (u_includeScanline == 1 && int(mod(scanlineRow, float(u_scanlineGap))) == 0)
    ? u_scanlineStrength : 1.0;
  v *= ss;

  // Degauss flash.
  if (u_isDegaussing == 1) {
    float flash = 1.0 + u_degaussT * 1.2 * abs(sin(u_degaussAge * 0.8));
    v *= flash;
  }

  // Flicker.
  if (u_flicker > 0.0) v *= u_flickerAmount;

  // Vignette.
  if (u_vignette > 0.0) {
    float ddx = x - cx;
    float ddy = y - cy;
    float dist = sqrt(ddx * ddx + ddy * ddy) / rNorm;
    float vFactor = max(0.0, 1.0 - u_vignette * dist * dist);
    v *= vFactor;
  }

  // Nearest palette quantize (skip if levels >= 256 == identity).
  if (u_paletteLevels >= 2 && u_paletteLevels < 256) {
    float step_v = 255.0 / float(u_paletteLevels - 1);
    v = floor(floor(v / step_v + 0.5) * step_v + 0.5);
  }

  fragColor = vec4(clamp(v / 255.0, 0.0, 1.0), srcA);
}
`;

// Beam spread: horizontal weighted blur (triangular weights).
const FS_BEAM = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform vec2 u_res;
uniform int u_radius;

void main() {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float invStep = 1.0 / u_res.x;
  float r = float(u_radius);
  float rPlus1 = r + 1.0;
  for (int kx = -16; kx <= 16; kx++) {
    if (kx < -u_radius || kx > u_radius) continue;
    float fkx = float(kx);
    float w = 1.0 - abs(fkx) / rPlus1;
    vec2 uv = clamp(v_uv + vec2(fkx * invStep, 0.0),
                    vec2(0.5 / u_res.x, 0.5 / u_res.y),
                    vec2(1.0 - 0.5 / u_res.x, 1.0 - 0.5 / u_res.y));
    acc += texture(u_input, uv).rgb * w;
    wsum += w;
  }
  vec4 center = texture(u_input, v_uv);
  fragColor = vec4(acc / wsum, center.a);
}
`;

// Bloom step 1: bright-pass extract (subtract threshold, clamp to 0).
const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform float u_threshold;

void main() {
  vec4 c = texture(u_input, v_uv);
  vec3 bright = max(c.rgb * 255.0 - vec3(u_threshold), vec3(0.0));
  fragColor = vec4(bright / 255.0, c.a);
}
`;

// Bloom step 2/3: separable box blur (horizontal then vertical).
const FS_BLUR = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2 u_res;
uniform vec2 u_dir;     // (1/W, 0) for H, (0, 1/H) for V
uniform int u_radius;

void main() {
  vec3 acc = vec3(0.0);
  float n = 0.0;
  for (int k = -32; k <= 32; k++) {
    if (k < -u_radius || k > u_radius) continue;
    vec2 uv = clamp(v_uv + u_dir * float(k),
                    vec2(0.5 / u_res.x, 0.5 / u_res.y),
                    vec2(1.0 - 0.5 / u_res.x, 1.0 - 0.5 / u_res.y));
    acc += texture(u_input, uv).rgb;
    n += 1.0;
  }
  fragColor = vec4(acc / n, 1.0);
}
`;

// Bloom composite: main + bloom*strength.
const FS_BLOOM_COMP = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_main;
uniform sampler2D u_bloom;
uniform float u_strength;

void main() {
  vec4 m = texture(u_main, v_uv);
  vec3 b = texture(u_bloom, v_uv).rgb;
  fragColor = vec4(min(vec3(1.0), m.rgb + b * u_strength), m.a);
}
`;

// Persistence blend.
const FS_PERSIST = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_main;
uniform sampler2D u_prev;
uniform float u_keep;

void main() {
  vec4 m = texture(u_main, v_uv);
  vec4 p = texture(u_prev, v_uv);
  float fresh = 1.0 - u_keep;
  fragColor = vec4(min(vec3(1.0), m.rgb * fresh + p.rgb * u_keep), m.a);
}
`;

type Program = {
  prog: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

const compileShader = (gl: WebGL2RenderingContext, type: number, src: string): WebGLShader => {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || "(no log)";
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}\n--- src ---\n${src}`);
  }
  return sh;
};

const linkProgram = (gl: WebGL2RenderingContext, fsSrc: string, uniformNames: string[]): Program => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error("createProgram failed");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "a_pos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || "(no log)";
    throw new Error(`program link failed: ${log}`);
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const n of uniformNames) uniforms[n] = gl.getUniformLocation(prog, n);
  return { prog, uniforms };
};

// Cached programs and quad VAO.
type Cache = {
  main: Program;
  beam: Program;
  bright: Program;
  blur: Program;
  bloomComp: Program;
  persist: Program;
  vao: WebGLVertexArrayObject;
};
let _cache: Cache | null = null;

const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  const mainUniforms = [
    "u_input","u_mask","u_prev","u_res","u_maskSize",
    "u_brightness","u_contrast","u_exposure","u_invGamma",
    "u_phosphorScale","u_scanlineGap","u_scanlineStrength","u_includeScanline",
    "u_misconvergence","u_curvature","u_vignette",
    "u_interlace","u_interlaceField","u_hasPrev",
    "u_flicker","u_flickerAmount",
    "u_isDegaussing","u_degaussAge","u_degaussT",
    "u_degaussWobbleX","u_degaussWobbleY","u_degaussMiscBoost",
    "u_paletteLevels",
  ];
  const main = linkProgram(gl, FS_MAIN, mainUniforms);
  const beam = linkProgram(gl, FS_BEAM, ["u_input","u_res","u_radius"]);
  const bright = linkProgram(gl, FS_BRIGHT, ["u_input","u_threshold"]);
  const blur = linkProgram(gl, FS_BLUR, ["u_input","u_res","u_dir","u_radius"]);
  const bloomComp = linkProgram(gl, FS_BLOOM_COMP, ["u_main","u_bloom","u_strength"]);
  const persist = linkProgram(gl, FS_PERSIST, ["u_main","u_prev","u_keep"]);

  // Full-screen quad in clip space.
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("createVertexArray failed");
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1, 1,1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  _cache = { main, beam, bright, blur, bloomComp, persist, vao };
  return _cache;
};

// Texture pool: keep input + 4 ping-pong textures + mask + prev.
type TexEntry = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };
const _texPool: Record<string, TexEntry> = {};

const ensureTexture = (gl: WebGL2RenderingContext, name: string, w: number, h: number): TexEntry => {
  let e = _texPool[name];
  if (e && e.w === w && e.h === h) return e;
  if (e) {
    gl.deleteTexture(e.tex);
    gl.deleteFramebuffer(e.fbo);
  }
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error("createTexture/Framebuffer failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  e = { tex, fbo, w, h };
  _texPool[name] = e;
  return e;
};

const drawTo = (
  gl: WebGL2RenderingContext,
  target: TexEntry | null, // null means default framebuffer (gl canvas)
  w: number, h: number,
  prog: Program,
  setUniforms: () => void,
  vao: WebGLVertexArrayObject,
) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  gl.viewport(0, 0, w, h);
  gl.useProgram(prog.prog);
  setUniforms();
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
};

// Render. Returns a fresh HTMLCanvasElement holding the result. Caller is
// responsible for null-checking via rgbStripeGLAvailable() first.
export const renderRgbStripeGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  o: RenderOpts,
): HTMLCanvasElement | null => {
  const gl = getCtx();
  if (!gl || !_glCanvas) return null;
  const cache = initCache(gl);
  const W = o.width, H = o.height;

  // Resize the GL canvas (drives default framebuffer size).
  if (_glCanvas.width !== W) _glCanvas.width = W;
  if (_glCanvas.height !== H) _glCanvas.height = H;

  // Upload the input image to a texture. Recreate each call because the
  // source canvas content changes; using texImage2D from a canvas pulls the
  // current pixels.
  const inputEntry = ensureTexture(gl, "input", W, H);
  gl.bindTexture(gl.TEXTURE_2D, inputEntry.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);

  // Mask texture: small (≤6x4 typically) RGBA8 with alpha=255.
  const maskEntry = ensureTexture(gl, "mask", o.maskW, o.maskH);
  gl.bindTexture(gl.TEXTURE_2D, maskEntry.tex);
  // Convert RGB f32 to RGBA u8 for upload.
  const maskBytes = new Uint8Array(o.maskW * o.maskH * 4);
  for (let i = 0; i < o.maskW * o.maskH; i++) {
    maskBytes[i * 4]     = Math.round(o.mask[i * 3]     * 255);
    maskBytes[i * 4 + 1] = Math.round(o.mask[i * 3 + 1] * 255);
    maskBytes[i * 4 + 2] = Math.round(o.mask[i * 3 + 2] * 255);
    maskBytes[i * 4 + 3] = 255;
  }
  // Mask values can exceed 1.0 (e.g. STAGGERED uses 0.9, 0.8 so they're <=1).
  // Looking at masks: VERTICAL has 1, e where e=1-strength (0..1), STAGGERED
  // has 0.8, 0.9 max — all ≤1, safe to encode as u8.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, o.maskW, o.maskH, 0, gl.RGBA, gl.UNSIGNED_BYTE, maskBytes);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  // Previous-frame texture (for interlace + persistence). Uploaded with
  // UNPACK_FLIP_Y_WEBGL=true so its orientation matches the input texture —
  // sampling at v_uv gives the same canvas pixel for both, and the shader's
  // JS-y readClamped helper handles both identically.
  const hasPrev = !!(o.prevOutput && o.prevOutput.length === W * H * 4);
  const prevEntry = ensureTexture(gl, "prev", W, H);
  if (hasPrev) {
    gl.bindTexture(gl.TEXTURE_2D, prevEntry.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, o.prevOutput as Uint8ClampedArray);
  }

  // Pass 1: main → texA.
  const texA = ensureTexture(gl, "A", W, H);
  drawTo(gl, texA, W, H, cache.main, () => {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inputEntry.tex);
    gl.uniform1i(cache.main.uniforms.u_input, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskEntry.tex);
    gl.uniform1i(cache.main.uniforms.u_mask, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, prevEntry.tex);
    gl.uniform1i(cache.main.uniforms.u_prev, 2);
    gl.uniform2f(cache.main.uniforms.u_res, W, H);
    gl.uniform2f(cache.main.uniforms.u_maskSize, o.maskW, o.maskH);
    gl.uniform1f(cache.main.uniforms.u_brightness, o.brightness);
    gl.uniform1f(cache.main.uniforms.u_contrast, o.contrast);
    gl.uniform1f(cache.main.uniforms.u_exposure, o.exposure);
    gl.uniform1f(cache.main.uniforms.u_invGamma, o.gamma !== 0 ? 1 / o.gamma : 0);
    gl.uniform1f(cache.main.uniforms.u_phosphorScale, o.phosphorScale);
    gl.uniform1i(cache.main.uniforms.u_scanlineGap, o.scanlineGap);
    gl.uniform1f(cache.main.uniforms.u_scanlineStrength, o.scanlineStrength);
    gl.uniform1i(cache.main.uniforms.u_includeScanline, o.includeScanline ? 1 : 0);
    gl.uniform1f(cache.main.uniforms.u_misconvergence, o.misconvergence);
    gl.uniform1f(cache.main.uniforms.u_curvature, o.curvature);
    gl.uniform1f(cache.main.uniforms.u_vignette, o.vignette);
    gl.uniform1i(cache.main.uniforms.u_interlace, o.interlace ? 1 : 0);
    gl.uniform1i(cache.main.uniforms.u_interlaceField, o.interlaceField);
    gl.uniform1i(cache.main.uniforms.u_hasPrev, hasPrev ? 1 : 0);
    gl.uniform1f(cache.main.uniforms.u_flicker, o.flicker);
    gl.uniform1f(cache.main.uniforms.u_flickerAmount, computeFlickerAmount(o));
    gl.uniform1i(cache.main.uniforms.u_isDegaussing, o.isDegaussing ? 1 : 0);
    gl.uniform1f(cache.main.uniforms.u_degaussAge, o.degaussAge);
    gl.uniform1f(cache.main.uniforms.u_degaussT, o.degaussT);
    gl.uniform1f(cache.main.uniforms.u_degaussWobbleX, o.degaussWobbleX);
    gl.uniform1f(cache.main.uniforms.u_degaussWobbleY, o.degaussWobbleY);
    const miscBoost = o.isDegaussing ? o.degaussT * o.degaussT * 50 : 0;
    gl.uniform1f(cache.main.uniforms.u_degaussMiscBoost, miscBoost);
    gl.uniform1i(cache.main.uniforms.u_paletteLevels, o.paletteLevels);
  }, cache.vao);

  // Pass 2: beam spread (optional) → texB. If skipped, just keep texA.
  let mainTex = texA;
  if (o.beamSpread > 0) {
    const texB = ensureTexture(gl, "B", W, H);
    drawTo(gl, texB, W, H, cache.beam, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mainTex.tex);
      gl.uniform1i(cache.beam.uniforms.u_input, 0);
      gl.uniform2f(cache.beam.uniforms.u_res, W, H);
      gl.uniform1i(cache.beam.uniforms.u_radius, Math.min(16, Math.round(o.beamSpread)));
    }, cache.vao);
    mainTex = texB;
  }

  // Pass 3-5: bloom (optional). Bright extract → blurH → blurV → composite.
  if (o.bloom) {
    const texBright = ensureTexture(gl, "bright", W, H);
    drawTo(gl, texBright, W, H, cache.bright, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mainTex.tex);
      gl.uniform1i(cache.bright.uniforms.u_input, 0);
      gl.uniform1f(cache.bright.uniforms.u_threshold, o.bloomThreshold);
    }, cache.vao);

    const texBlurH = ensureTexture(gl, "blurH", W, H);
    drawTo(gl, texBlurH, W, H, cache.blur, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texBright.tex);
      gl.uniform1i(cache.blur.uniforms.u_input, 0);
      gl.uniform2f(cache.blur.uniforms.u_res, W, H);
      gl.uniform2f(cache.blur.uniforms.u_dir, 1 / W, 0);
      gl.uniform1i(cache.blur.uniforms.u_radius, Math.min(32, o.bloomRadius));
    }, cache.vao);

    const texBlurV = ensureTexture(gl, "blurV", W, H);
    drawTo(gl, texBlurV, W, H, cache.blur, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texBlurH.tex);
      gl.uniform1i(cache.blur.uniforms.u_input, 0);
      gl.uniform2f(cache.blur.uniforms.u_res, W, H);
      gl.uniform2f(cache.blur.uniforms.u_dir, 0, 1 / H);
      gl.uniform1i(cache.blur.uniforms.u_radius, Math.min(32, o.bloomRadius));
    }, cache.vao);

    const texBloomed = ensureTexture(gl, "bloomed", W, H);
    drawTo(gl, texBloomed, W, H, cache.bloomComp, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mainTex.tex);
      gl.uniform1i(cache.bloomComp.uniforms.u_main, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texBlurV.tex);
      gl.uniform1i(cache.bloomComp.uniforms.u_bloom, 1);
      gl.uniform1f(cache.bloomComp.uniforms.u_strength, o.bloomStrength);
    }, cache.vao);
    mainTex = texBloomed;
  }

  // Pass N: persistence (optional) → render to gl canvas directly.
  if (o.persistence > 0 && hasPrev) {
    drawTo(gl, null, W, H, cache.persist, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mainTex.tex);
      gl.uniform1i(cache.persist.uniforms.u_main, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prevEntry.tex);
      gl.uniform1i(cache.persist.uniforms.u_prev, 1);
      gl.uniform1f(cache.persist.uniforms.u_keep, o.persistence);
    }, cache.vao);
  } else {
    // Final blit to gl canvas via a no-op shader. Simplest: reuse blur with
    // radius=0 would still average the center pixel; instead use bloomComp
    // with strength=0 (just copies main).
    drawTo(gl, null, W, H, cache.bloomComp, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mainTex.tex);
      gl.uniform1i(cache.bloomComp.uniforms.u_main, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mainTex.tex);
      gl.uniform1i(cache.bloomComp.uniforms.u_bloom, 1);
      gl.uniform1f(cache.bloomComp.uniforms.u_strength, 0);
    }, cache.vao);
  }

  // Build the output 2D canvas via drawImage — the browser handles the
  // framebuffer flip so the result is correctly oriented relative to the
  // input source canvas.
  const outCanvas = document.createElement("canvas");
  outCanvas.width = W;
  outCanvas.height = H;
  const ctx = outCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(_glCanvas, 0, 0);
  return outCanvas;
};

// Mirror the JS computation of flickerAmount so the shader doesn't need to
// recompute it (it's a per-frame scalar, not per-pixel).
const computeFlickerAmount = (o: RenderOpts): number => {
  if (o.flicker <= 0) return 1;
  const fi = o.frameIndex;
  return 1 - o.flicker + o.flicker * (Math.sin(fi * 7.3 + Math.cos(fi * 3.1)) * 0.5 + 0.5);
};

// Identify whether the supplied palette is the default `nearest` palette
// (the only one supported by the shader path). For anything else, the
// caller should fall back to the JS pipeline.
export const paletteShaderLevels = (palette: { name?: string; options?: { levels?: number; colors?: number[][] } } | undefined): number | null => {
  if (!palette) return 256;
  if (palette.name !== nearestPalette.name) return null;
  if (palette.options?.colors) return null;
  const lv = palette.options?.levels ?? 256;
  if (lv < 1 || lv > 256) return null;
  return lv;
};
