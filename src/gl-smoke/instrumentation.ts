export const glCalls = {
  shaderCompiles: 0,
  programLinks: 0,
  drawCalls: 0,
  shaderFailureLogs: [] as string[],
};

let installed = false;

/** Observe actual WebGL2 calls instead of trusting filter capability metadata. */
export const installGLCallTracking = (): void => {
  if (installed) return;
  installed = true;
  const prototype = WebGL2RenderingContext.prototype;
  const compileShader = prototype.compileShader;
  const linkProgram = prototype.linkProgram;
  const drawArrays = prototype.drawArrays;

  prototype.compileShader = function trackedCompileShader(shader: WebGLShader): void {
    glCalls.shaderCompiles += 1;
    compileShader.call(this, shader);
    if (!this.getShaderParameter(shader, this.COMPILE_STATUS)) {
      glCalls.shaderFailureLogs.push(
        `compile: ${this.getShaderInfoLog(shader) || "no driver log"}`,
      );
    }
  };
  prototype.linkProgram = function trackedLinkProgram(program: WebGLProgram): void {
    glCalls.programLinks += 1;
    linkProgram.call(this, program);
    if (!this.getProgramParameter(program, this.LINK_STATUS)) {
      glCalls.shaderFailureLogs.push(`link: ${this.getProgramInfoLog(program) || "no driver log"}`);
    }
  };
  prototype.drawArrays = function trackedDrawArrays(
    mode: number,
    first: number,
    count: number,
  ): void {
    glCalls.drawCalls += 1;
    drawArrays.call(this, mode, first, count);
  };
};
