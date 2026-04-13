import { describe, expect, it, vi } from "vitest";
import { finalizeGifExport, finalizeSequenceExport } from "components/SaveAs/export/finalizeFrameExports";

vi.mock("components/SaveAs/export/exportArtifacts", () => ({
  encodeGifBlob: vi.fn(async () => ({ blob: new Blob(["gif"], { type: "image/gif" }) })),
  encodePngSequenceZip: vi.fn(async (_frames: unknown, onFrame?: (frameIndex: number, frameCount: number) => void) => {
    onFrame?.(0, 2);
    onFrame?.(1, 2);
    return {
      blob: new Blob(["zip"], { type: "application/zip" }),
      fileCount: 2,
    };
  }),
}));

describe("finalizeGifExport", () => {
  it("publishes GIF results and reports normalized stats", async () => {
    const updateProgress = vi.fn();
    const setGifResult = vi.fn();
    const onEncoded = vi.fn();

    await finalizeGifExport({
      frames: [
        { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1, delay: 40 },
      ],
      aborted: false,
      colorTable: null,
      capturedFrameCount: 1,
      updateProgress,
      setGifResult,
      onEncoded,
    });

    expect(updateProgress).toHaveBeenCalledWith("Encoding GIF (1 frame)...", 0.9);
    expect(setGifResult).toHaveBeenCalledWith(expect.any(Blob), "GIF ready to save or copy.");
    expect(onEncoded).toHaveBeenCalledWith(expect.objectContaining({ normalizedFrameCount: 1 }));
  });
});

describe("finalizeSequenceExport", () => {
  it("publishes ZIP results and reports encoding progress", async () => {
    const updateProgress = vi.fn();
    const setSequenceResult = vi.fn();

    await finalizeSequenceExport({
      frames: [
        { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1, delay: 0 },
        { data: new Uint8ClampedArray([4, 5, 6, 255]), width: 1, height: 1, delay: 0 },
      ],
      updateProgress,
      setSequenceResult,
    });

    expect(updateProgress.mock.calls[0]?.[0]).toBe("Encoding frame 1/2");
    expect(updateProgress.mock.calls[0]?.[1]).toBeCloseTo(0.88);
    expect(updateProgress.mock.calls[1]?.[0]).toBe("Encoding frame 2/2");
    expect(updateProgress.mock.calls[1]?.[1]).toBeCloseTo(0.94);
    expect(updateProgress).toHaveBeenCalledWith("Zipping 2 frames...", 0.96);
    expect(setSequenceResult).toHaveBeenCalledWith(expect.any(Blob));
  });
});
