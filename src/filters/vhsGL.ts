import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Row-wise state is pre-computed on CPU and uploaded as RGBA32F:
// shift, brightness multiplier, static-bar flag, packed dropout geometry.
// That keeps artifact placement consistent with the CPU fallback.
const VHS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_rowState;   // per row: (shift, rowNoise, staticBar, packedDropout)
uniform sampler2D u_prev;       // previous frame (optional, same-size)
uniform vec2  u_res;
uniform float u_vJitter;
uniform float u_chromaOffX;
uniform float u_chromaOffY;
uniform float u_chromaBandwidth; // horizontal low-pass radius on chroma
uniform float u_saturation;
uniform float u_brightness;     // -100..100
uniform float u_ghosting;       // 0..1
uniform int   u_hasPrev;        // 1 if prev provided
uniform float u_tapeNoise;
uniform float u_frameIndex;     // per-frame hash seed

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 rgbToYiq(vec3 c) {
  return vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(0.5959, -0.2746, -0.3213)),
    dot(c, vec3(0.2115, -0.5227, 0.3112))
  );
}

vec3 yiqToRgb(vec3 c) {
  return vec3(
    c.x + 0.956 * c.y + 0.619 * c.z,
    c.x - 0.272 * c.y - 0.647 * c.z,
    c.x - 1.106 * c.y + 1.703 * c.z
  );
}

vec4 sampleJS(float sx, float sy) {
  float cx = clamp(sx, 0.0, u_res.x - 1.0);
  float cy = clamp(sy, 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y));
}

vec3 sampleYiq(float sx, float sy) {
  return rgbToYiq(sampleJS(sx, sy).rgb);
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec4 rs = texture(u_rowState, vec2(0.5, 1.0 - (y + 0.5) / u_res.y));
  float shift = rs.r;
  float rowNoise = rs.g;
  float barBri = rs.b;
  float dropoutPacked = rs.a;
  bool inDropout = false;
  if (dropoutPacked > 0.0) {
    float dropStart = floor(dropoutPacked) - 1.0;
    float dropW = fract(dropoutPacked) * (u_res.x + 1.0);
    inDropout = x >= dropStart && x < dropStart + dropW;
  }

  vec3 rgb;
  float alpha = 1.0;

  if (barBri > 0.5) {
    float n = hash(vec2(x, y + u_frameIndex * 19.0));
    rgb = vec3(n);
  } else if (inDropout) {
    float n = (180.0 + hash(vec2(x + 7.0, y + u_frameIndex * 13.0)) * 75.0) / 255.0;
    rgb = vec3(n);
  } else {

  // Luma tap at the row's tracking-shifted position + frame vertical jitter.
  float srcY = clamp(y + u_vJitter, 0.0, u_res.y - 1.0);
  float lumaX = clamp(x + shift, 0.0, u_res.x - 1.0);
    vec4 ls = sampleJS(lumaX, srcY);
    vec3 lumaTap = rgbToYiq(ls.rgb);
    float lumaV = lumaTap.x;
    alpha = ls.a;

  // Chroma tap at the delayed position, optionally low-pass filtered
  // horizontally to reproduce VHS 3.58 MHz chroma bandwidth (~250-line
  // colour vs ~330-line luma).
    vec2 chromaSum = vec2(0.0);
    float wsum = 0.0;
    int band = int(clamp(u_chromaBandwidth, 0.0, 16.0));
    for (int k = -16; k <= 16; k++) {
      if (k < -band || k > band) continue;
      float radius = max(float(band) + 1.0, 1.0);
      float weight = 1.0 - abs(float(k)) / radius;
      float cx = x + shift + u_chromaOffX + float(k);
      float cy = srcY + u_chromaOffY;
      vec3 centerYiq = sampleYiq(cx, cy);
      vec3 aboveYiq = sampleYiq(cx, cy - 1.0);
      chromaSum += mix(centerYiq.yz, aboveYiq.yz, 0.22) * weight;
      wsum += weight;
    }
    vec2 chroma = chromaSum / max(wsum, 0.0001);

    // Time-base error rotates the chroma vector by a small, scanline-specific
    // amount. This produces tape-like hue flutter instead of RGB splitting.
    float phaseNoise = (hash(vec2(y * 0.17, floor(u_frameIndex * 0.5))) - 0.5)
      * u_tapeNoise * 0.42;
    float cp = cos(phaseNoise);
    float sp = sin(phaseNoise);
    chroma = mat2(cp, sp, -sp, cp) * chroma;

    // A short delayed luma echo approximates RF reflections/head crosstalk.
    float echoOffset = 5.0 + floor(hash(vec2(y, 71.0)) * 5.0);
    float echoY = sampleYiq(lumaX - echoOffset, srcY).x;
    lumaV = mix(lumaV, lumaV * 0.88 + echoY * 0.12, u_ghosting);

  // Recombine: luma + chroma * saturation + brightness offset, then
  // multiply by per-row tape noise.
    vec3 yiq = vec3(lumaV + u_brightness / 255.0, chroma * u_saturation);
    rgb = clamp(yiqToRgb(yiq) * rowNoise, 0.0, 1.0);
  }

  if (u_hasPrev == 1 && u_ghosting > 0.0) {
    vec3 prev = texture(u_prev, v_uv).rgb;
    rgb = mix(rgb, prev, u_ghosting * 0.72);
  }

  fragColor = vec4(rgb, alpha);
}
`;

// Optional tape-softness pass. Luma trails asymmetrically while chroma also
// blends vertically, closer to helical-scan playback than a generic Gaussian.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
vec3 rgbToYiq(vec3 c) {
  return vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(0.5959, -0.2746, -0.3213)),
    dot(c, vec3(0.2115, -0.5227, 0.3112))
  );
}
vec3 yiqToRgb(vec3 c) {
  return vec3(
    c.x + 0.956 * c.y + 0.619 * c.z,
    c.x - 0.272 * c.y - 0.647 * c.z,
    c.x - 1.106 * c.y + 1.703 * c.z
  );
}
void main() {
  vec2 texel = 1.0 / u_res;
  vec4 c = texture(u_input, v_uv);
  vec3 yc = rgbToYiq(c.rgb);
  vec3 yl1 = rgbToYiq(texture(u_input, v_uv - texel * vec2(1.0, 0.0)).rgb);
  vec3 yl2 = rgbToYiq(texture(u_input, v_uv - texel * vec2(2.0, 0.0)).rgb);
  vec3 yr1 = rgbToYiq(texture(u_input, v_uv + texel * vec2(1.0, 0.0)).rgb);
  vec3 ya = rgbToYiq(texture(u_input, v_uv + texel * vec2(0.0, 1.0)).rgb);
  float y = yc.x * 0.55 + yl1.x * 0.25 + yl2.x * 0.12 + yr1.x * 0.08;
  vec2 iq = yc.yz * 0.40 + yl1.yz * 0.22 + yr1.yz * 0.18 + ya.yz * 0.20;
  fragColor = vec4(clamp(yiqToRgb(vec3(y, iq)), 0.0, 1.0), c.a);
}
`;

type Cache = { vhs: Program; blur: Program };
let _cache: Cache | null = null;
const initCache = (gl: WebGL2RenderingContext): Cache => {
  if (_cache) return _cache;
  _cache = {
    vhs: linkProgram(gl, VHS_FS, [
      "u_source", "u_rowState", "u_prev", "u_res",
      "u_vJitter", "u_chromaOffX", "u_chromaOffY",
      "u_chromaBandwidth", "u_saturation", "u_brightness",
      "u_ghosting", "u_hasPrev", "u_tapeNoise", "u_frameIndex",
    ] as const),
    blur: linkProgram(gl, BLUR_FS, ["u_input", "u_res"] as const),
  };
  return _cache;
};

// Row-state texture: one row per scanline, RGBA channels = (shift,
// rowNoise, isStaticBar, packed dropout geometry).
const uploadRowState = (
  gl: WebGL2RenderingContext,
  rowShift: Int32Array,
  rowNoise: Float32Array,
  staticBar: Uint8Array,
  dropoutPacked: Float32Array,
  height: number,
) => {
  const data = new Float32Array(height * 4);
  for (let y = 0; y < height; y++) {
    data[y * 4] = rowShift[y];
    data[y * 4 + 1] = rowNoise[y];
    data[y * 4 + 2] = staticBar[y];
    data[y * 4 + 3] = dropoutPacked[y];
  }
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, height, 0, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
};

const uploadPrevOutputTexture = (
  gl: WebGL2RenderingContext,
  prevOutput: Uint8ClampedArray | null,
  width: number,
  height: number,
) => {
  if (!prevOutput) return null;
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // JS stores top-to-bottom; UNPACK_FLIP_Y convention used elsewhere flips
  // on upload so the shader's sampling math stays consistent.
  const prevUpload = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array(prevOutput.buffer, prevOutput.byteOffset, prevOutput.byteLength),
  );
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevUpload);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
};

export const vhsGLAvailable = (): boolean => glAvailable();

export type VHSGLParams = {
  rowShift: Int32Array;
  rowNoise: Float32Array;
  staticBar: Uint8Array;      // 1 per row in a noise bar
  dropoutPacked: Float32Array;
  vJitter: number;
  chromaOffX: number;
  chromaOffY: number;
  chromaBandwidth: number;
  saturation: number;
  brightness: number;
  ghosting: number;
  tapeNoise: number;
  frameIndex: number;
  prevOutput: Uint8ClampedArray | null;
  doBlur: boolean;
};

export const renderVHSGL = (
  source: HTMLCanvasElement | OffscreenCanvas,
  width: number, height: number,
  params: VHSGLParams,
): HTMLCanvasElement | OffscreenCanvas | null => {
  const ctx = getGLCtx();
  if (!ctx) return null;
  const { gl, canvas } = ctx;
  // RGBA32F attachments need EXT_color_buffer_float; for our 1×H uniform
  // texture we only SAMPLE from it, don't render to it, so 32F textures
  // without that extension work — but the OES_texture_float_linear isn't
  // needed because we use NEAREST filtering.
  const cache = initCache(gl);
  const vao = getQuadVAO(gl);

  resizeGLCanvas(canvas, width, height);
  const sourceTex = ensureTexture(gl, "vhs:source", width, height);
  uploadSourceTexture(gl, sourceTex, source);

  const rowStateTex = uploadRowState(
    gl,
    params.rowShift,
    params.rowNoise,
    params.staticBar,
    params.dropoutPacked,
    height,
  );
  const prevTex = uploadPrevOutputTexture(gl, params.prevOutput, width, height);

  // When blur is enabled we render VHS into a scratch texture and then
  // apply the blur into the final GL canvas, otherwise straight to canvas.
  const intermediate = params.doBlur ? ensureTexture(gl, "vhs:intermediate", width, height) : null;

  drawPass(gl, intermediate, width, height, cache.vhs, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTex.tex);
    gl.uniform1i(cache.vhs.uniforms.u_source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rowStateTex);
    gl.uniform1i(cache.vhs.uniforms.u_rowState, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.uniform1i(cache.vhs.uniforms.u_prev, 2);
    gl.uniform2f(cache.vhs.uniforms.u_res, width, height);
    gl.uniform1f(cache.vhs.uniforms.u_vJitter, params.vJitter);
    gl.uniform1f(cache.vhs.uniforms.u_chromaOffX, params.chromaOffX);
    gl.uniform1f(cache.vhs.uniforms.u_chromaOffY, params.chromaOffY);
    gl.uniform1f(cache.vhs.uniforms.u_chromaBandwidth, params.chromaBandwidth);
    gl.uniform1f(cache.vhs.uniforms.u_saturation, params.saturation);
    gl.uniform1f(cache.vhs.uniforms.u_brightness, params.brightness);
    gl.uniform1f(cache.vhs.uniforms.u_ghosting, params.ghosting);
    gl.uniform1i(cache.vhs.uniforms.u_hasPrev, prevTex ? 1 : 0);
    gl.uniform1f(cache.vhs.uniforms.u_tapeNoise, params.tapeNoise);
    gl.uniform1f(cache.vhs.uniforms.u_frameIndex, params.frameIndex);
  }, vao);

  if (params.doBlur && intermediate) {
    drawPass(gl, null, width, height, cache.blur, () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, intermediate.tex);
      gl.uniform1i(cache.blur.uniforms.u_input, 0);
      gl.uniform2f(cache.blur.uniforms.u_res, width, height);
    }, vao);
  }

  const result = readoutToCanvas(canvas, width, height);
  // Row-state and prev textures are single-frame, so release rather than
  // pool — they'd require invalidation keyed on row-state content.
  gl.deleteTexture(rowStateTex);
  if (prevTex) gl.deleteTexture(prevTex);
  return result;
};
