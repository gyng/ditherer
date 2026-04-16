import {
  drawPass, ensureTexture, getGLCtx, getQuadVAO, glAvailable,
  linkProgram, readoutToCanvas, resizeGLCanvas, uploadSourceTexture,
  type Program,
} from "gl";

// Row-wise state (tracking/noise/dropouts) is pre-computed on CPU with
// the same mulberry32 seeds as the JS reference and uploaded as an RG16F
// texture: .r = horizontal shift in pixels, .g = brightness multiplier.
// Dropouts and noise bars become an RGBA32F "overlay" texture: .r > 0
// marks static bars (value = row-noise brightness so the bar is visible),
// .g > 0 marks dropouts with their x-extent packed in .b/.a.
const VHS_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;
uniform sampler2D u_rowState;   // per row: (shift, rowNoise, barBrightness, dropoutHash)
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
uniform float u_dropoutProb;
uniform float u_tapeNoise;
uniform float u_frameIndex;     // per-frame hash seed

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float luma3(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

vec4 sampleJS(float sx, float sy) {
  float cx = clamp(sx, 0.0, u_res.x - 1.0);
  float cy = clamp(sy, 0.0, u_res.y - 1.0);
  return texture(u_source, vec2((cx + 0.5) / u_res.x, 1.0 - (cy + 0.5) / u_res.y));
}

void main() {
  vec2 px = v_uv * u_res;
  float x = floor(px.x);
  float y = u_res.y - 1.0 - floor(px.y);

  vec4 rs = texture(u_rowState, vec2(0.5, 1.0 - (y + 0.5) / u_res.y));
  float shift = rs.r;
  float rowNoise = rs.g;
  float barBri = rs.b;

  // Static bar: the whole row is random grey.
  if (barBri > 0.5) {
    float n = hash(vec2(x, y + u_frameIndex));
    fragColor = vec4(vec3(n), 1.0);
    return;
  }

  // Dropout streaks — hashed start/length per row. A row either has one
  // or none in GL (approximates the multi-streak CPU behaviour visibly).
  if (u_dropoutProb > 0.0) {
    float dh = hash(vec2(y + 3.0, u_frameIndex));
    if (dh < clamp(u_dropoutProb, 0.0, 1.0)) {
      float dropStart = hash(vec2(y + 11.0, u_frameIndex)) * u_res.x;
      float dropW = 20.0 + hash(vec2(y + 23.0, u_frameIndex)) * u_res.x * 0.4;
      if (x >= dropStart && x < dropStart + dropW) {
        float n = 180.0 + hash(vec2(x + 7.0, y + u_frameIndex)) * 75.0;
        fragColor = vec4(vec3(n / 255.0), 1.0);
        return;
      }
    }
  }

  // Tape-noise bars — hashed per-row at low probability.
  if (u_tapeNoise > 0.0 && hash(vec2(y + 97.0, u_frameIndex)) < u_tapeNoise * 0.02) {
    float n = hash(vec2(x, y + u_frameIndex));
    fragColor = vec4(vec3(n), 1.0);
    return;
  }

  // Luma tap at the row's tracking-shifted position + frame vertical jitter.
  float srcY = clamp(y + u_vJitter, 0.0, u_res.y - 1.0);
  float lumaX = clamp(x + shift, 0.0, u_res.x - 1.0);
  vec4 ls = sampleJS(lumaX, srcY);
  float lumaV = luma3(ls.rgb) * 255.0;

  // Chroma tap at the delayed position, optionally low-pass filtered
  // horizontally to reproduce VHS 3.58 MHz chroma bandwidth (~250-line
  // colour vs ~330-line luma).
  vec3 chromaSum = vec3(0.0);
  float wsum = 0.0;
  int band = int(clamp(u_chromaBandwidth, 0.0, 16.0));
  for (int k = -16; k <= 16; k++) {
    if (k < -band || k > band) continue;
    float cx = clamp(x + shift + u_chromaOffX + float(k), 0.0, u_res.x - 1.0);
    float cy = clamp(srcY + u_chromaOffY, 0.0, u_res.y - 1.0);
    vec4 cs = sampleJS(cx, cy);
    chromaSum += cs.rgb * 255.0;
    wsum += 1.0;
  }
  vec3 chromaMean = chromaSum / wsum;
  float chromaLuma = luma3(chromaMean / 255.0) * 255.0;
  vec3 chroma = chromaMean - vec3(chromaLuma);

  // Recombine: luma + chroma * saturation + brightness offset, then
  // multiply by per-row tape noise.
  vec3 rgb = (vec3(lumaV) + chroma * u_saturation + vec3(u_brightness)) * rowNoise;
  rgb = clamp(rgb, vec3(0.0), vec3(255.0)) / 255.0;

  if (u_hasPrev == 1 && u_ghosting > 0.0) {
    vec3 prev = texture(u_prev, v_uv).rgb;
    rgb = mix(rgb, prev, u_ghosting);
  }

  fragColor = vec4(rgb, ls.a);
}
`;

// Optional 3x3 blur reproduces the "blur" checkbox's GAUSSIAN_3X3_WEAK.
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_input;
uniform vec2  u_res;
void main() {
  vec2 texel = 1.0 / u_res;
  // Matches convolve's GAUSSIAN_3X3_WEAK: [1 2 1; 2 4 2; 1 2 1] / 16.
  vec4 acc = vec4(0.0);
  acc += texture(u_input, v_uv + texel * vec2(-1.0, -1.0)) * 1.0;
  acc += texture(u_input, v_uv + texel * vec2( 0.0, -1.0)) * 2.0;
  acc += texture(u_input, v_uv + texel * vec2( 1.0, -1.0)) * 1.0;
  acc += texture(u_input, v_uv + texel * vec2(-1.0,  0.0)) * 2.0;
  acc += texture(u_input, v_uv + texel * vec2( 0.0,  0.0)) * 4.0;
  acc += texture(u_input, v_uv + texel * vec2( 1.0,  0.0)) * 2.0;
  acc += texture(u_input, v_uv + texel * vec2(-1.0,  1.0)) * 1.0;
  acc += texture(u_input, v_uv + texel * vec2( 0.0,  1.0)) * 2.0;
  acc += texture(u_input, v_uv + texel * vec2( 1.0,  1.0)) * 1.0;
  fragColor = acc / 16.0;
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
      "u_ghosting", "u_hasPrev", "u_dropoutProb", "u_tapeNoise", "u_frameIndex",
    ] as const),
    blur: linkProgram(gl, BLUR_FS, ["u_input", "u_res"] as const),
  };
  return _cache;
};

// Row-state texture: one row per scanline, RGBA channels = (shift,
// rowNoise, isStaticBar, _unused).
const uploadRowState = (
  gl: WebGL2RenderingContext,
  rowShift: Int32Array,
  rowNoise: Float32Array,
  staticBar: Uint8Array,
  height: number,
) => {
  const data = new Float32Array(height * 4);
  for (let y = 0; y < height; y++) {
    data[y * 4] = rowShift[y];
    data[y * 4 + 1] = rowNoise[y];
    data[y * 4 + 2] = staticBar[y];
    data[y * 4 + 3] = 0;
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
    gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(prevOutput.buffer),
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
  vJitter: number;
  chromaOffX: number;
  chromaOffY: number;
  chromaBandwidth: number;
  saturation: number;
  brightness: number;
  ghosting: number;
  dropoutProb: number;
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

  const rowStateTex = uploadRowState(gl, params.rowShift, params.rowNoise, params.staticBar, height);
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
    gl.uniform1f(cache.vhs.uniforms.u_dropoutProb, params.dropoutProb);
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
