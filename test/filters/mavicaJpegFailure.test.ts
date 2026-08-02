import { describe, expect, it, vi } from "vitest";

const jpegMocks = vi.hoisted(() => ({
  tryApplyJpegArtifactToCanvas: vi.fn(() => null),
}));

const glMocks = vi.hoisted(() => {
  const gl = {
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE_2D: 0x0de1,
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform3f: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  return {
    gl,
    drawPass: vi.fn(
      (
        _gl: WebGL2RenderingContext,
        _target: unknown,
        _width: number,
        _height: number,
        _program: unknown,
        setUniforms: () => void,
      ) => setUniforms(),
    ),
    ensureTexture: vi.fn(
      (_gl: WebGL2RenderingContext, _name: string, width: number, height: number) => ({
        tex: {} as WebGLTexture,
        fbo: {} as WebGLFramebuffer,
        w: width,
        h: height,
      }),
    ),
    getGLCtx: vi.fn(() => ({
      gl,
      canvas: document.createElement("canvas"),
    })),
    getQuadVAO: vi.fn(() => ({}) as WebGLVertexArrayObject),
    glAvailable: vi.fn(() => true),
    glUnavailableStub: vi.fn((width: number, height: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }),
    linkProgram: vi.fn(() => ({
      prog: {} as WebGLProgram,
      uniforms: new Proxy({}, { get: () => null }),
    })),
    readoutToCanvas: vi.fn((_canvas: unknown, width: number, height: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }),
    resizeGLCanvas: vi.fn((canvas: HTMLCanvasElement, width: number, height: number) => {
      canvas.width = width;
      canvas.height = height;
    }),
    uploadSourceTexture: vi.fn(),
  };
});

vi.mock("filters/jpegArtifact", async () => {
  const actual =
    await vi.importActual<typeof import("filters/jpegArtifact")>("filters/jpegArtifact");
  return { ...actual, tryApplyJpegArtifactToCanvas: jpegMocks.tryApplyJpegArtifactToCanvas };
});

vi.mock("gl/index", async () => {
  const actual = await vi.importActual<typeof import("gl/index")>("gl/index");
  return { ...actual, ...glMocks };
});

import mavicaFd7 from "filters/mavicaFd7";

describe("Mavica JPEG composition failure", () => {
  it("returns the exact visible plate without a post pass or source-alpha replacement", () => {
    const input = document.createElement("canvas");
    input.width = 53;
    input.height = 41;
    // The default canvas is transparent: a later alpha-replacement pass would
    // erase the failure plate, which is the regression this protects.

    const output = mavicaFd7.func(input, mavicaFd7.defaults);

    expect(jpegMocks.tryApplyJpegArtifactToCanvas).toHaveBeenCalledOnce();
    expect(glMocks.glUnavailableStub).toHaveBeenCalledWith(53, 41);
    expect(output).toBe(glMocks.glUnavailableStub.mock.results[0]?.value);
    expect(glMocks.drawPass).toHaveBeenCalledTimes(3);
  });
});
