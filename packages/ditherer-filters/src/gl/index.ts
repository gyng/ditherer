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

import { getCanvasPoolStats, releasePooledCanvas, takePooledCanvas } from "../utils/index";

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
    c.width = w;
    c.height = h;
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
  const gl = c.getContext("webgl2", {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  _supported = true;
  _gl = gl;
  _glCanvas = c;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return { gl, canvas: c };
};

// Read-only lifecycle probe: unlike getGLCtx(), this never creates a context.
// Resource disposal uses it so removing an unused GL filter cannot allocate a
// fresh context merely to discover there is nothing to release.
export const getExistingGLCtx = (): GLCtx | null =>
  _gl && _glCanvas ? { gl: _gl, canvas: _glCanvas } : null;

export const glAvailable = (): boolean => getGLCtx() !== null;

// Render a "WebGL2 required" placeholder canvas at the given size. Used by
// the filter dispatcher when a `requiresGL` filter runs on a device without
// WebGL2 so the pipeline output stays the expected shape. Returns an
// HTMLCanvasElement on the main thread and an OffscreenCanvas inside a
// worker — both satisfy the filter output contract.
export const glUnavailableStub = (w: number, h: number): GLCanvas => {
  const canvas = (
    typeof document !== "undefined"
      ? (() => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          return c;
        })()
      : new OffscreenCanvas(w, h)
  ) as GLCanvas;
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return canvas;
  // Dark plate, amber text — stays recognisable against most source images.
  (ctx as CanvasRenderingContext2D).fillStyle = "#1a1a1a";
  (ctx as CanvasRenderingContext2D).fillRect(0, 0, w, h);
  const fontPx = Math.max(10, Math.min(28, Math.round(Math.min(w, h) / 16)));
  (ctx as CanvasRenderingContext2D).fillStyle = "#ffb74d";
  (ctx as CanvasRenderingContext2D).font = `${fontPx}px monospace`;
  (ctx as CanvasRenderingContext2D).textAlign = "center";
  (ctx as CanvasRenderingContext2D).textBaseline = "middle";
  (ctx as CanvasRenderingContext2D).fillText("WebGL2 required", w / 2, h / 2);
  return canvas;
};

// ── GL resource diagnostics ─────────────────────────────────────────────
// Counters track cumulative allocations for autonomous leak detection.
// Call `getGLStats()` from devtools or a test harness; `resetGLStats()`
// zeros the counters. `getGLPoolSizes()` returns the current live count
// of pooled entries (not cumulative).
export type GLStats = {
  programs: number;
  textures: number;
  framebuffers: number;
  readoutCanvases: number;
  readoutCanvasReuses: number;
};
const _glStats: GLStats = {
  programs: 0,
  textures: 0,
  framebuffers: 0,
  readoutCanvases: 0,
  readoutCanvasReuses: 0,
};
export const getGLStats = (): Readonly<GLStats> => ({ ..._glStats });
export const resetGLStats = (): void => {
  _glStats.programs = 0;
  _glStats.textures = 0;
  _glStats.framebuffers = 0;
  _glStats.readoutCanvases = 0;
  _glStats.readoutCanvasReuses = 0;
};
export const getGLPoolSizes = (): { texPool: number; canvasPool: number } => ({
  texPool: Object.keys(_texPool).length,
  canvasPool: getCanvasPoolStats().pooled,
});

const acquireReadoutCanvas = (w: number, h: number): GLCanvas | null => {
  const before = getCanvasPoolStats();
  const canvas = takePooledCanvas(w, h) as GLCanvas;
  const after = getCanvasPoolStats();
  if (after.reuses > before.reuses) _glStats.readoutCanvasReuses++;
  else _glStats.readoutCanvases++;
  return canvas;
};

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
  try {
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || "(no log)";
      throw new Error(`shader compile failed: ${log}\n--- src ---\n${src}`);
    }
    return sh;
  } catch (error) {
    try {
      gl.deleteShader(sh);
    } catch {
      /* preserve the compile failure */
    }
    throw error;
  }
};

// Compile a fragment shader against STD_VS, link a program, and look up
// the listed uniforms. Throws on compile/link errors.
export const linkProgram = (
  gl: WebGL2RenderingContext,
  fsSrc: string,
  uniformNames: readonly string[],
): Program => {
  let vs: WebGLShader | null = null;
  let fs: WebGLShader | null = null;
  let prog: WebGLProgram | null = null;
  const cleanup = () => {
    if (prog && vs) {
      try {
        gl.detachShader(prog, vs);
      } catch {
        /* continue cleanup */
      }
    }
    if (prog && fs) {
      try {
        gl.detachShader(prog, fs);
      } catch {
        /* continue cleanup */
      }
    }
    if (vs) {
      try {
        gl.deleteShader(vs);
      } catch {
        /* context loss: nothing else can free it */
      }
    }
    if (fs) {
      try {
        gl.deleteShader(fs);
      } catch {
        /* context loss: nothing else can free it */
      }
    }
    if (prog) {
      try {
        gl.deleteProgram(prog);
      } catch {
        /* context loss: nothing else can free it */
      }
    }
  };
  try {
    vs = compileShader(gl, gl.VERTEX_SHADER, STD_VS);
    fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    prog = gl.createProgram();
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

    // Shaders can be detached+deleted after a successful link — the program
    // retains the compiled code. Program ownership transfers only after every
    // requested uniform has also been resolved.
    gl.detachShader(prog, vs);
    gl.detachShader(prog, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    vs = null;
    fs = null;
    _glStats.programs++;
    return { prog, uniforms };
  } catch (error) {
    cleanup();
    throw error;
  }
};

// Cached full-screen quad VAO.
let _quadVao: WebGLVertexArrayObject | null = null;

export const createQuadVAO = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("createVertexArray failed");
  let buffer: WebGLBuffer | null = null;
  try {
    buffer = gl.createBuffer();
    if (!buffer) throw new Error("createBuffer failed");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  } catch (error) {
    try {
      gl.bindVertexArray(null);
    } catch {
      /* continue cleanup */
    }
    if (buffer) {
      try {
        gl.deleteBuffer(buffer);
      } catch {
        /* context loss */
      }
    }
    try {
      gl.deleteVertexArray(vao);
    } catch {
      /* context loss */
    }
    throw error;
  }
};

export const getQuadVAO = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => {
  if (_quadVao) return _quadVao;
  _quadVao = createQuadVAO(gl);
  return _quadVao;
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

const discardTextureTarget = (
  gl: WebGL2RenderingContext,
  texture: WebGLTexture | null,
  framebuffer: WebGLFramebuffer | null,
): void => {
  if (texture) {
    try {
      gl.deleteTexture(texture);
    } catch {
      /* continue cleanup */
    }
  }
  if (framebuffer) {
    try {
      gl.deleteFramebuffer(framebuffer);
    } catch {
      /* context loss */
    }
  }
};

export const ensureTexture = (
  gl: WebGL2RenderingContext,
  name: string,
  w: number,
  h: number,
): TexEntry => {
  const existing = _texPool[name];
  if (existing && existing.w === w && existing.h === h) return existing;
  if (existing) {
    delete _texPool[name];
    discardTextureTarget(gl, existing.tex, existing.fbo);
  }
  let tex: WebGLTexture | null = null;
  let fbo: WebGLFramebuffer | null = null;
  try {
    tex = gl.createTexture();
    fbo = gl.createFramebuffer();
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
    _glStats.textures++;
    _glStats.framebuffers++;
    return entry;
  } catch (error) {
    discardTextureTarget(gl, tex, fbo);
    throw error;
  }
};

// RGBA16F render target for signal-processing pipelines which must preserve
// signed/out-of-gamut intermediates. EXT_color_buffer_float is required by
// WebGL2 for rendering into the texture. A completeness check protects ANGLE
// implementations which expose the extension but reject the exact format.
export const ensureFloatTexture = (
  gl: WebGL2RenderingContext,
  name: string,
  w: number,
  h: number,
): TexEntry | null => {
  if (!gl.getExtension("EXT_color_buffer_float")) return null;
  const existing = _texPool[name];
  if (existing && existing.w === w && existing.h === h) return existing;
  if (existing) {
    delete _texPool[name];
    discardTextureTarget(gl, existing.tex, existing.fbo);
  }
  let tex: WebGLTexture | null = null;
  let fbo: WebGLFramebuffer | null = null;
  try {
    tex = gl.createTexture();
    fbo = gl.createFramebuffer();
    if (!tex || !fbo) {
      discardTextureTarget(gl, tex, fbo);
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      discardTextureTarget(gl, tex, fbo);
      return null;
    }
    const entry = { tex, fbo, w, h };
    _texPool[name] = entry;
    _glStats.textures++;
    _glStats.framebuffers++;
    return entry;
  } catch (error) {
    discardTextureTarget(gl, tex, fbo);
    throw error;
  }
};

export const uploadFloatTexture = (
  gl: WebGL2RenderingContext,
  entry: TexEntry,
  width: number,
  height: number,
  data: Float32Array,
): void => {
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.bindTexture(gl.TEXTURE_2D, entry.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
};

// Evict texture pool entries whose key starts with `prefix`. Call when a
// filter is removed from the chain or the chain is cleared. Pass no
// argument to flush the entire pool.
export const releasePooledTextures = (prefix?: string): number => {
  const ctx = getExistingGLCtx();
  if (!ctx) return 0;
  const { gl } = ctx;
  let freed = 0;
  for (const key of Object.keys(_texPool)) {
    if (prefix && !key.startsWith(prefix)) continue;
    const e = _texPool[key];
    gl.deleteTexture(e.tex);
    gl.deleteFramebuffer(e.fbo);
    delete _texPool[key];
    freed++;
  }
  return freed;
};

// Snapshot of all live pool entry keys — useful for diagnostics.
export const getTexPoolKeys = (): string[] => Object.keys(_texPool);

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

// Copy the GL canvas's current framebuffer to an owned 2D canvas and return it.
// drawImage handles the WebGL-y-up → 2D-y-down flip so the filter caller
// gets a right-side-up image (assuming input was uploaded with
// UNPACK_FLIP_Y=true and shaders use JS-y conventions). Returns
// OffscreenCanvas when running in a Web Worker, HTMLCanvasElement on the
// main thread — both satisfy the FilterCanvas contract.
export const readoutToCanvas = (glCanvas: GLCanvas, w: number, h: number): GLCanvas | null => {
  const out = acquireReadoutCanvas(w, h);
  if (!out) return null;
  // willReadFrequently so the next filter's getImageData on this canvas
  // doesn't pay a GPU readback cost. Sticky from the first getContext call.
  const ctx = out.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    releasePooledCanvas(out);
    return null;
  }
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

// Expose diagnostics on the global for console / Playwright / test harness
// access. Lazy-attached on first import so it doesn't break SSR or workers
// that lack `globalThis.window`.
if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).__glDiag = {
    getStats: getGLStats,
    resetStats: resetGLStats,
    getPoolSizes: getGLPoolSizes,
    getTexPoolKeys,
    releaseTextures: releasePooledTextures,
  };
}
