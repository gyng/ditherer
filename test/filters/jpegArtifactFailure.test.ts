import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderJpegArtifactGL } = vi.hoisted(() => ({
  renderJpegArtifactGL: vi.fn(),
}));

vi.mock("filters/jpegArtifactGL", async () => {
  const actual = await vi.importActual<typeof import("filters/jpegArtifactGL")>("filters/jpegArtifactGL");
  return { ...actual, renderJpegArtifactGL };
});

import {
  applyJpegArtifactToCanvas,
  tryApplyJpegArtifactToCanvas,
} from "filters/jpegArtifact";
import {
  getCanvasPoolStats,
  resetCanvasPoolStats,
  takePooledCanvas,
} from "@gyng/ditherer-filters";

describe("JPEG Artifact GL failure", () => {
  beforeEach(() => {
    renderJpegArtifactGL.mockReset();
    renderJpegArtifactGL.mockReturnValue(null);
  });

  it("returns the visible GL-unavailable plate instead of silently passing input through", () => {
    const input = document.createElement("canvas");
    input.width = 53;
    input.height = 31;

    const output = applyJpegArtifactToCanvas(input);

    expect(renderJpegArtifactGL).toHaveBeenCalledOnce();
    expect(output).not.toBe(input);
    expect(output).toMatchObject({ width: 53, height: 31 });
  });

  it("exposes a nullable composed-call contract without manufacturing a plate", () => {
    const input = document.createElement("canvas");
    input.width = 41;
    input.height = 29;

    expect(tryApplyJpegArtifactToCanvas(input)).toBeNull();
    expect(renderJpegArtifactGL).toHaveBeenCalledOnce();
  });

  it("returns the rendered canvas to the pool when post-processing throws", () => {
    const width = 197;
    const height = 83;
    const input = document.createElement("canvas");
    input.width = width;
    input.height = height;

    const rendered = takePooledCanvas(width, height);
    const context = rendered.getContext("2d") as CanvasRenderingContext2D | null;
    expect(context).toBeTruthy();
    if (!context) return;
    vi.spyOn(context, "getImageData").mockImplementationOnce(() => {
      throw new Error("injected JPEG post-process failure");
    });
    renderJpegArtifactGL.mockReturnValueOnce(rendered);
    resetCanvasPoolStats();

    expect(() => applyJpegArtifactToCanvas(input, {
      palette: { options: { levels: 2 } },
    })).toThrow("injected JPEG post-process failure");
    expect(getCanvasPoolStats()).toMatchObject({ releases: 1 });
    expect(takePooledCanvas(width, height)).toBe(rendered);
  });
});
