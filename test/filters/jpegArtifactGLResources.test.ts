import { describe, expect, it, vi } from "vitest";
import {
  ensureJpegFloatTexture,
  getJpegFloatTextureCountForContext,
  releaseJpegFloatTexturesForContext,
} from "filters/jpegArtifactGL";

const makeGl = () => ({
  TEXTURE_2D: 0x0de1,
  RGBA32F: 0x8814,
  RGBA: 0x1908,
  FLOAT: 0x1406,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  CLAMP_TO_EDGE: 0x812f,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  createTexture: vi.fn(),
  createFramebuffer: vi.fn(),
  deleteTexture: vi.fn(),
  deleteFramebuffer: vi.fn(),
  bindTexture: vi.fn(),
  texImage2D: vi.fn(),
  texParameteri: vi.fn(),
  bindFramebuffer: vi.fn(),
  framebufferTexture2D: vi.fn(),
  checkFramebufferStatus: vi.fn(() => 0x8cd5),
}) as unknown as WebGL2RenderingContext;

describe("JPEG Artifact float texture ownership", () => {
  it("cleans either half-created resource and retries from an empty cache", () => {
    const gl = makeGl();
    const texture = { id: "texture" } as unknown as WebGLTexture;
    const framebuffer = { id: "framebuffer" } as unknown as WebGLFramebuffer;

    vi.mocked(gl.createTexture)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(texture);
    vi.mocked(gl.createFramebuffer)
      .mockReturnValueOnce(framebuffer)
      .mockReturnValueOnce(null);

    expect(ensureJpegFloatTexture(gl, "half", 8, 8)).toBeNull();
    expect(gl.deleteFramebuffer).toHaveBeenCalledWith(framebuffer);

    expect(ensureJpegFloatTexture(gl, "half", 8, 8)).toBeNull();
    expect(gl.deleteTexture).toHaveBeenCalledWith(texture);
    expect(gl.createTexture).toHaveBeenCalledTimes(2);
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(2);
  });

  it("drops a resized cache entry before an incomplete replacement and allocates afresh on retry", () => {
    const gl = makeGl();
    const oldTexture = { id: "old-texture" } as unknown as WebGLTexture;
    const oldFramebuffer = { id: "old-framebuffer" } as unknown as WebGLFramebuffer;
    const rejectedTexture = { id: "rejected-texture" } as unknown as WebGLTexture;
    const rejectedFramebuffer = { id: "rejected-framebuffer" } as unknown as WebGLFramebuffer;
    const retryTexture = { id: "retry-texture" } as unknown as WebGLTexture;
    const retryFramebuffer = { id: "retry-framebuffer" } as unknown as WebGLFramebuffer;

    vi.mocked(gl.createTexture)
      .mockReturnValueOnce(oldTexture)
      .mockReturnValueOnce(rejectedTexture)
      .mockReturnValueOnce(retryTexture);
    vi.mocked(gl.createFramebuffer)
      .mockReturnValueOnce(oldFramebuffer)
      .mockReturnValueOnce(rejectedFramebuffer)
      .mockReturnValueOnce(retryFramebuffer);
    vi.mocked(gl.checkFramebufferStatus)
      .mockReturnValueOnce(gl.FRAMEBUFFER_COMPLETE)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(gl.FRAMEBUFFER_COMPLETE);

    const first = ensureJpegFloatTexture(gl, "resize", 8, 8);
    expect(first).toMatchObject({ tex: oldTexture, fbo: oldFramebuffer });
    expect(ensureJpegFloatTexture(gl, "resize", 16, 16)).toBeNull();
    expect(gl.deleteTexture).toHaveBeenCalledWith(oldTexture);
    expect(gl.deleteFramebuffer).toHaveBeenCalledWith(oldFramebuffer);
    expect(gl.deleteTexture).toHaveBeenCalledWith(rejectedTexture);
    expect(gl.deleteFramebuffer).toHaveBeenCalledWith(rejectedFramebuffer);

    const retry = ensureJpegFloatTexture(gl, "resize", 8, 8);
    expect(retry).toMatchObject({ tex: retryTexture, fbo: retryFramebuffer });
    expect(retry).not.toBe(first);
    expect(gl.createTexture).toHaveBeenCalledTimes(3);
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(3);
  });

  it("releases all six codec targets, clears their cache entries, and is idempotent", () => {
    const gl = makeGl();
    const names = ["ycbcr", "dct1", "dct2", "quant", "idct1", "idct2"];
    let serial = 0;
    vi.mocked(gl.createTexture).mockImplementation(() => ({
      id: `texture-${serial++}`,
    }) as unknown as WebGLTexture);
    vi.mocked(gl.createFramebuffer).mockImplementation(() => ({
      id: `framebuffer-${serial++}`,
    }) as unknown as WebGLFramebuffer);

    const firstEntries = names.map((name) => ensureJpegFloatTexture(gl, name, 16, 8));
    expect(firstEntries.every(Boolean)).toBe(true);
    expect(getJpegFloatTextureCountForContext(gl)).toBe(6);
    expect(releaseJpegFloatTexturesForContext(gl)).toBe(6);
    expect(getJpegFloatTextureCountForContext(gl)).toBe(0);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(6);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(6);
    expect(releaseJpegFloatTexturesForContext(gl)).toBe(0);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(6);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(6);

    const retry = ensureJpegFloatTexture(gl, names[0], 16, 8);
    expect(retry).not.toBe(firstEntries[0]);
    expect(getJpegFloatTextureCountForContext(gl)).toBe(1);
    expect(gl.createTexture).toHaveBeenCalledTimes(7);
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(7);
  });
});
