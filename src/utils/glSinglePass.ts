import {
  drawPass,
  ensureTexture,
  getGLCtx,
  getQuadVAO,
  linkProgram,
  readoutToCanvas,
  resizeGLCanvas,
  uploadSourceTexture,
  type Program,
} from "gl";
import type { FilterCanvas } from "filters/types";

type UniformSetter = (
  gl: WebGL2RenderingContext,
  uniforms: Record<string, WebGLUniformLocation | null>,
) => void;

type SinglePassOptions = {
  source: FilterCanvas;
  width: number;
  height: number;
  key: string;
  fragmentShader: string;
  uniformNames: readonly string[];
  setUniforms?: UniformSetter;
};

const programs = new Map<string, Program>();

/**
 * Render a source-backed, full-screen WebGL2 filter pass. The helper owns only
 * shared pipeline plumbing; filter modules continue to own shader source,
 * controls, and all effect-specific uniforms.
 */
export const renderGLSinglePass = ({
  source,
  width,
  height,
  key,
  fragmentShader,
  uniformNames,
  setUniforms,
}: SinglePassOptions): FilterCanvas | null => {
  const context = getGLCtx();
  if (!context) return null;
  const { gl, canvas } = context;
  let program = programs.get(key);
  if (!program) {
    program = linkProgram(gl, fragmentShader, ["u_source", "u_res", ...uniformNames]);
    programs.set(key, program);
  }

  const sourceTexture = ensureTexture(gl, `${key}:source`, width, height);
  uploadSourceTexture(gl, sourceTexture, source);
  resizeGLCanvas(canvas, width, height);
  const vao = getQuadVAO(gl);
  drawPass(gl, null, width, height, program, () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture.tex);
    gl.uniform1i(program?.uniforms.u_source ?? null, 0);
    gl.uniform2f(program?.uniforms.u_res ?? null, width, height);
    setUniforms?.(gl, program?.uniforms ?? {});
  }, vao);
  return readoutToCanvas(canvas, width, height);
};
