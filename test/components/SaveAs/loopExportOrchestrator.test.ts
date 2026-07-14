import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLoopExport } from "components/SaveAs/export/loopExportOrchestrator";

const mocks = vi.hoisted(() => ({
  captureOffline: vi.fn(),
  capturePlayback: vi.fn(),
  finalizeGif: vi.fn(),
  finalizeSequence: vi.fn(),
  finalizeContact: vi.fn(),
}));

vi.mock("components/SaveAs/export/loopOfflineCapture", () => ({
  captureLoopOfflineFrames: mocks.captureOffline,
}));
vi.mock("components/SaveAs/export/loopPlaybackCapture", () => ({
  captureLoopPlaybackFrames: mocks.capturePlayback,
}));
vi.mock("components/SaveAs/export/finalizeFrameExports", () => ({
  finalizeGifExport: mocks.finalizeGif,
  finalizeSequenceExport: mocks.finalizeSequence,
  finalizeContactSheetExport: mocks.finalizeContact,
}));

const frame = {
  data: new Uint8ClampedArray([10, 20, 30, 255]),
  width: 1,
  height: 1,
  delay: 40,
};

type Options = Parameters<typeof runLoopExport>[0];

const makeVideo = (currentTime = 0) => ({
  duration: 2,
  currentTime,
  currentSrc: "blob:source-video",
  src: "",
  pause: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}) as unknown as HTMLVideoElement;

const makeOptions = (overrides: Partial<Options> = {}): Options => ({
  mode: "gif",
  video: makeVideo(),
  sourceCanvas: Object.assign(document.createElement("canvas"), { width: 2, height: 2 }),
  mult: 1,
  targetFrameCount: 8,
  contactColumns: 4,
  loopExportScope: "loop",
  loopRangeStart: 0,
  loopRangeEnd: 2,
  loopAutoFps: false,
  gifFps: 12,
  loopCaptureMode: "realtime",
  gifPaletteSource: "auto",
  gifFilterPalette: null,
  estimateVideoFps: vi.fn(() => 24),
  getScaledCanvas: vi.fn(() => document.createElement("canvas")),
  waitForRenderedSeek: vi.fn(async () => undefined),
  waitForRenderedPlaybackFrame: vi.fn(async () => undefined),
  waitForVideoSeekSettled: vi.fn(async () => undefined),
  getCurrentRenderVersion: vi.fn(() => 3),
  updateProgress: vi.fn(),
  clearProgress: vi.fn(),
  isAborted: vi.fn(() => false),
  clearGifResult: vi.fn(),
  clearSequenceResult: vi.fn(),
  setGifResult: vi.fn(),
  setSequenceResult: vi.fn(),
  clearContactSheetResult: vi.fn(),
  setContactSheetResult: vi.fn(),
  createHiddenExportVideo: vi.fn(async () => makeVideo()),
  renderFrameForExport: vi.fn(async () => document.createElement("canvas")),
  clearExportSession: vi.fn(),
  logGifExportProfile: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  mocks.captureOffline.mockResolvedValue({
    capturedFrames: [],
    aborted: false,
    gifProfile: {
      path: "hidden-video-fallback",
      fallbackReason: "",
      decodeLoadMs: 0,
      decodeConfigMs: 0,
      demuxMs: 0,
      decodeMs: 0,
      renderMs: 0,
      selectedFrames: 0,
      decodedChunks: 0,
      decodedFrames: 0,
    },
  });
  mocks.capturePlayback.mockResolvedValue({ capturedFrames: [frame], aborted: false });
  mocks.finalizeGif.mockImplementation(async (options: { onEncoded?: (value: { normalizedFrameCount: number; encodeMs: number }) => void }) => {
    options.onEncoded?.({ normalizedFrameCount: 1, encodeMs: 7 });
  });
  mocks.finalizeSequence.mockResolvedValue(undefined);
  mocks.finalizeContact.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("runLoopExport", () => {
  it("captures realtime GIF frames, applies the filter palette, and logs the completed profile", async () => {
    const palette = [[0, 0, 0], [255, 255, 255]];
    const options = makeOptions({
      gifPaletteSource: "filter",
      gifFilterPalette: palette,
    });

    await runLoopExport(options);

    expect(options.video.pause).toHaveBeenCalledOnce();
    expect(options.clearGifResult).toHaveBeenCalledOnce();
    expect(mocks.captureOffline).not.toHaveBeenCalled();
    expect(mocks.capturePlayback).toHaveBeenCalledWith(expect.objectContaining({
      usePlaybackCapture: true,
      captureFps: 12,
      rangeStartSec: 0,
      exportDurationSec: 2,
    }));
    expect(mocks.finalizeGif).toHaveBeenCalledWith(expect.objectContaining({
      frames: [frame],
      colorTable: palette,
      aborted: false,
    }));
    expect(options.logGifExportProfile).toHaveBeenCalledWith("completed", expect.objectContaining({
      path: "realtime-playback",
      fps: 12,
      normalizedFrames: 1,
      encodeMs: 7,
    }));
    expect(options.clearProgress).toHaveBeenCalledOnce();
  });

  it("routes offline sequence capture through the hidden-video path and finalizes the ZIP", async () => {
    mocks.captureOffline.mockResolvedValueOnce({
      capturedFrames: [frame],
      aborted: false,
      gifProfile: {
        path: "hidden-video-fallback",
        fallbackReason: "",
        decodeLoadMs: 0,
        decodeConfigMs: 0,
        demuxMs: 0,
        decodeMs: 0,
        renderMs: 0,
        selectedFrames: 1,
        decodedChunks: 0,
        decodedFrames: 0,
      },
    });
    mocks.capturePlayback.mockResolvedValueOnce({ capturedFrames: [], aborted: false });
    const options = makeOptions({ mode: "sequence", loopCaptureMode: "offline" });

    await runLoopExport(options);

    expect(options.clearSequenceResult).toHaveBeenCalledOnce();
    expect(mocks.captureOffline).toHaveBeenCalledWith(expect.objectContaining({
      mode: "sequence",
      useWebCodecsCapture: false,
      captureFps: 12,
    }));
    expect(mocks.capturePlayback).toHaveBeenCalledWith(expect.objectContaining({
      usePlaybackCapture: false,
    }));
    expect(mocks.finalizeSequence).toHaveBeenCalledWith(expect.objectContaining({ frames: [frame] }));
    expect(mocks.finalizeGif).not.toHaveBeenCalled();
  });

  it("uses bounded range timing and automatic FPS for contact sheets", async () => {
    mocks.captureOffline.mockResolvedValueOnce({
      capturedFrames: [frame],
      aborted: false,
      gifProfile: {
        path: "hidden-video-fallback",
        fallbackReason: "",
        decodeLoadMs: 0,
        decodeConfigMs: 0,
        demuxMs: 0,
        decodeMs: 0,
        renderMs: 0,
        selectedFrames: 1,
        decodedChunks: 0,
        decodedFrames: 0,
      },
    });
    mocks.capturePlayback.mockResolvedValueOnce({ capturedFrames: [], aborted: false });
    const video = makeVideo(0.5);
    const options = makeOptions({
      mode: "contact",
      video,
      loopCaptureMode: "offline",
      loopExportScope: "range",
      loopRangeStart: 0.5,
      loopRangeEnd: 1.5,
      loopAutoFps: true,
      targetFrameCount: 8,
    });

    await runLoopExport(options);

    expect(options.clearContactSheetResult).toHaveBeenCalledOnce();
    expect(options.updateProgress).toHaveBeenCalledWith("Seeking start (0.50s)...", 0.04);
    expect(mocks.captureOffline).toHaveBeenCalledWith(expect.objectContaining({
      rangeStartSec: 0.5,
      rangeEndSec: 1.5,
      captureFps: 8,
    }));
    expect(mocks.finalizeContact).toHaveBeenCalledWith(expect.objectContaining({
      frames: [frame],
      columns: 4,
    }));
  });

  it("clears progress without finalizing when capture yields no frames", async () => {
    mocks.capturePlayback.mockResolvedValueOnce({ capturedFrames: [], aborted: true });
    const options = makeOptions();

    await runLoopExport(options);

    expect(mocks.finalizeGif).not.toHaveBeenCalled();
    expect(mocks.finalizeSequence).not.toHaveBeenCalled();
    expect(mocks.finalizeContact).not.toHaveBeenCalled();
    expect(options.clearProgress).toHaveBeenCalledOnce();
  });

  it("does not publish sequence output if cancellation arrives after capture", async () => {
    const isAborted = vi.fn(() => true);
    const options = makeOptions({
      mode: "sequence",
      isAborted,
    });

    await runLoopExport(options);

    expect(mocks.finalizeSequence).not.toHaveBeenCalled();
    expect(options.clearProgress).toHaveBeenCalledOnce();
  });
});
