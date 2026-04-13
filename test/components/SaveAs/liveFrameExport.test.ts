import { describe, expect, it, vi } from "vitest";
import { addFrameDelay, captureCurrentOutputFrames } from "components/SaveAs/export/liveFrameExport";

describe("addFrameDelay", () => {
  it("adds delay without changing frame pixels", () => {
    const frame = {
      data: new Uint8ClampedArray([1, 2, 3, 255]),
      width: 1,
      height: 1,
    };

    expect(addFrameDelay(frame, 40)).toEqual({
      ...frame,
      delay: 40,
    });
  });
});

describe("captureCurrentOutputFrames", () => {
  it("captures frames and reports progress", async () => {
    const imageData = new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1);
    const getImageData = vi.fn(() => imageData);
    const getContext = vi.fn(() => ({ getImageData }));
    const getScaledCanvas = vi.fn(() => ({
      width: 1,
      height: 1,
      getContext,
    } as unknown as HTMLCanvasElement));
    const onProgress = vi.fn();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const result = await captureCurrentOutputFrames({
      frameCount: 2,
      getScaledCanvas,
      isAborted: () => false,
      onProgress,
    });

    expect(result.aborted).toBe(false);
    expect(result.capturedFrames).toHaveLength(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(getScaledCanvas).toHaveBeenCalledTimes(2);
    raf.mockRestore();
  });

  it("stops before capture when aborted", async () => {
    const result = await captureCurrentOutputFrames({
      frameCount: 3,
      getScaledCanvas: vi.fn(),
      isAborted: () => true,
      onProgress: vi.fn(),
    });

    expect(result).toEqual({ capturedFrames: [], aborted: true });
  });
});
