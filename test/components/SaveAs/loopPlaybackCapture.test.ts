import { describe, expect, it, vi } from "vitest";
import { captureLoopPlaybackFrames } from "components/SaveAs/export/loopPlaybackCapture";

describe("captureLoopPlaybackFrames", () => {
  it("returns no frames when playback capture is disabled", async () => {
    const getScaledCanvas = vi.fn(() => {
      throw new Error("should not read playback canvas");
    });
    const waitForRenderedSeek = vi.fn();
    const waitForRenderedPlaybackFrame = vi.fn();
    const getCurrentRenderVersion = vi.fn(() => 0);
    const updateProgress = vi.fn();
    const isAborted = vi.fn(() => false);
    const video = {
      currentTime: 0,
      playbackRate: 1,
      pause: vi.fn(),
      play: vi.fn(),
    } as unknown as HTMLVideoElement;

    const result = await captureLoopPlaybackFrames({
      video,
      getScaledCanvas,
      waitForRenderedSeek,
      waitForRenderedPlaybackFrame,
      getCurrentRenderVersion,
      updateProgress,
      isAborted,
      usePlaybackCapture: false,
      useVFC: false,
      captureFps: 30,
      gifFps: 30,
      rangeStartSec: 0,
      durationSec: 1,
      exportDurationSec: 1,
    });

    expect(result).toEqual({ capturedFrames: [], aborted: false });
    expect(getScaledCanvas).not.toHaveBeenCalled();
    expect(waitForRenderedSeek).not.toHaveBeenCalled();
    expect(waitForRenderedPlaybackFrame).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
  });
});
