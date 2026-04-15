// Shared WebGL2 pipeline for filters. Everything that every GL-ported
// filter needs lives here; filter-specific code owns only shader source
// and the per-frame render orchestration.
//
// Conventions:
// - One process-wide WebGL2 context on one hidden canvas. Resized per call.
// - Input textures are uploaded with UNPACK_FLIP_Y_WEBGL=true so the output
//   orientation round-trips correctly through drawImage. The `readClamped`
//   GLSL helper in `READ_CLAMPED` flips y back to JS-y space.
// - Texture pool is keyed by caller-provided names. Namespace with a filter
//   prefix (e.g., "gaussian:temp") to avoid collisions.

type GLCanvas = HTMLCanvasElement | OffscreenCanvas;

let _gl: WebGL2RenderingContext | null = null;
let _glCanvas: GLCanvas | null = null;
let _supportChecked = false;
let _supported = false;

export type GLCtx = {
  gl: WebGL2RenderingContext;
  canvas: GLCanvas;
};

// Allocate a drawing canvas that works on both main thread (HTMLCanvasElement)
// and Web Workers (OffscreenCanvas). Filters run inside the filter worker
// for throughput; limiting GL to the main thread would starve most of the
// pipeline.
const createGLCanvas = (w = 1, h = 1): GLCanvas | null => {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  return null;
};

export const getGLCtx = (): GLCtx | null => {
  if (_gl && _glCanvas) return { gl: _gl, canvas: _glCanvas };
  if (_supportChecked && !_supported) return null;
  _supportChecked = true;
  const c = createGLCanvas();
  if (!c) return null;
  const gl = (c.getContext("webgl2", {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  }) as WebGL2RenderingContext | null);
  if (!gl) return null;
  _supported = true;
  _gl = gl;
  _glCanvas = c;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return { gl, canvas: c };
};

export const glAvailable = (): boolean => getGLCtx() !== null;

// Standard full-screen-quad vertex shader. No flip — shaders compute JS-y
// explicitly (y = u_res.y - 1.0 - floor(v_uv.y * u_res.y)).
export const STD_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// GLSL snippet for JS-oriented pixel sampling of textures uploaded via
// UNPACK_FLIP_Y_WEBGL=true (which stores the source's last row at texture
// row 0). Drop this in the fragment shader and it exposes `readClamped`.
export const READ_CLAMPED = `
vec4 readClamped(sampler2D s, vec2 px, vec2 res) {
  vec2 cp = clamp(px, vec2(0.0), res - vec2(1.0));
  return texture(s, vec2(cp.x + 0.5, res.y - 0.5 - cp.y) / res);
}
`;

export type Program = {
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

// Compile a fragment shader against STD_VS, link a program, and look up
// the listed uniforms. Throws on compile/link errors.
export const linkProgram = (
  gl: WebGL2RenderingContext,
  fsSrc: string,
  uniformNames: readonly string[],
): Program => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, STD_VS);
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

// Cached full-screen quad VAO.
let _quadVao: WebGLVertexArrayObject | null = null;

export const getQuadVAO = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => {
  if (_quadVao) return _quadVao;
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
  _quadVao = vao;
  return vao;
};

export type TexEntry = {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
};

// Shared texture pool. Keys should be namespaced (e.g., "rgbstripe:A") so
// different filters don't collide. Textures resize on size change and keep
// an FBO attachment for render-to-texture.
const _texPool: Record<string, TexEntry> = {};

export const ensureTexture = (
  gl: WebGL2RenderingContext,
  name: string,
  w: number,
  h: number,
): TexEntry => {
  const existing = _texPool[name];
  if (existing && existing.w === w && existing.h === h) return existing;
  if (existing) {
    gl.deleteTexture(existing.tex);
    gl.deleteFramebuffer(existing.fbo);
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
  const entry = { tex, fbo, w, h };
  _texPool[name] = entry;
  return entry;
};

// Upload a source canvas/image as texture data. UNPACK_FLIP_Y_WEBGL is
// left in the pipeline-global `true` state so orientation is consistent
// with the shader's JS-y math + readClamped helper.
export const uploadSourceTexture = (
  gl: WebGL2RenderingContext,
  entry: TexEntry,
  source: HTMLCanvasElement | OffscreenCanvas | ImageBitmap | ImageData,
): void => {
  gl.bindTexture(gl.TEXTURE_2D, entry.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
};

// Run one pass: bind target FBO (null = default framebuffer / GL canvas),
// set viewport, use program, let caller set uniforms, draw the quad.
export const drawPass = (
  gl: WebGL2RenderingContext,
  target: TexEntry | null,
  w: number,
  h: number,
  prog: Program,
  setUniforms: () => void,
  vao: WebGLVertexArrayObject,
): void => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  gl.viewport(0, 0, w, h);
  gl.useProgram(prog.prog);
  setUniforms();
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
};

// Copy the GL canvas's current framebuffer to a fresh canvas and return it.
// drawImage handles the WebGL-y-up → 2D-y-down flip so the filter caller
// gets a right-side-up image (assuming input was uploaded with
// UNPACK_FLIP_Y=true and shaders use JS-y conventions). Returns
// OffscreenCanvas when running in a Web Worker, HTMLCanvasElement on the
// main thread — both satisfy the FilterCanvas contract.
export const readoutToCanvas = (
  glCanvas: GLCanvas,
  w: number,
  h: number,
): GLCanvas | null => {
  const out = createGLCanvas(w, h);
  if (!out) return null;
  const ctx = out.getContext("2d") as (
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  );
  if (!ctx) return null;
  // TS can't narrow the drawImage overloads across the union.
  (ctx as CanvasRenderingContext2D).drawImage(glCanvas as CanvasImageSource, 0, 0);
  return out;
};

// Resize the GL canvas to match the current render target. Cheap — only
// assigns on size change. Must be called before rendering to the default
// framebuffer (the GL canvas) so the viewport and readout match.
export const resizeGLCanvas = (canvas: GLCanvas, w: number, h: number): void => {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
};
