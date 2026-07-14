import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDecodedTimeline: vi.fn(),
  decodeSourceFramesWithWebCodecs: vi.fn(),
  decodeTimelineFramesWithWebCodecs: vi.fn(),
  renderOfflineFrames: vi.fn(),
}));

vi.mock("components/SaveAs/export/offlineWebCodecsDecode", () => ({
  buildDecodedTimeline: mocks.buildDecodedTimeline,
  decodeSourceFramesWithWebCodecs: mocks.decodeSourceFramesWithWebCodecs,
  decodeTimelineFramesWithWebCodecs: mocks.decodeTimelineFramesWithWebCodecs,
}));

vi.mock("components/SaveAs/export/offlineRender", () => ({
  renderOfflineFrames: mocks.renderOfflineFrames,
}));

import { captureLoopOfflineFrames } from "components/SaveAs/export/loopOfflineCapture";

const makeCanvas = (width = 2, height = 2) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const makeVideo = () => {
  const video = document.createElement("video");
  Object.defineProperties(video, {
    duration: { configurable: true, value: 1 },
    videoWidth: { configurable: true, value: 2 },
    videoHeight: { configurable: true, value: 2 },
  });
  vi.spyOn(video, "pause").mockImplementation(() => undefined);
  vi.spyOn(video, "load").mockImplementation(() => undefined);
  return video;
};

const makeOptions = (overrides: Record<string, unknown> = {}) => ({
  video: makeVideo(),
  mode: "gif" as const,
  sourceWidth: 2,
  sourceHeight: 2,
  mult: 1,
  captureFps: 2,
  rangeStartSec: 0,
  rangeEndSec: 1,
  durationSec: 1,
  loopAutoFps: false,
  sourceUrl: "https://example.test/video.mp4",
  useWebCodecsCapture: true,
  updateProgress: vi.fn(),
  isAborted: vi.fn(() => false),
  createHiddenExportVideo: vi.fn(async () => makeVideo()),
  waitForVideoSeekSettled: vi.fn(async () => undefined),
  renderFrameForExport: vi.fn(async () => makeCanvas()),
  clearExportSession: vi.fn(),
  ...overrides,
});

const decodedFrame = (timestampUs: number, durationUs = 500_000) => ({
  timestampUs,
  durationUs,
  frame: Object.assign(makeCanvas(), { close: vi.fn() }),
});

describe("captureLoopOfflineFrames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildDecodedTimeline.mockReturnValue([
      { timeSec: 0, timestampUs: 0, durationUs: 500_000 },
      { timeSec: 0.5, timestampUs: 500_000, durationUs: 500_000 },
    ]);
    mocks.renderOfflineFrames.mockResolvedValue({ aborted: false });
  });

  it("awaits WebCodecs GIF frame rendering and closes every decoded frame", async () => {
    const frames = [decodedFrame(0), decodedFrame(500_000), decodedFrame(1_000_000)];
    mocks.decodeSourceFramesWithWebCodecs.mockResolvedValue({
      width: 2,
      height: 2,
      frames,
      metrics: { loadMs: 1.2, configMs: 2.2, demuxMs: 3.2, decodeMs: 4.2, decodedChunks: 3 },
    });
    const options = makeOptions({ loopAutoFps: true });

    const result = await captureLoopOfflineFrames(options);

    expect(result.capturedFrames).toHaveLength(1);
    expect(options.renderFrameForExport).toHaveBeenCalledOnce();
    expect(result.gifProfile).toMatchObject({
      path: "webcodecs-demux",
      selectedFrames: 1,
      decodedChunks: 3,
      decodedFrames: 3,
    });
    expect(frames.every(({ frame }) => frame.close.mock.calls.length === 1)).toBe(true);
    expect(options.clearExportSession).toHaveBeenCalledWith(result.exportSessionId);
  });

  it("uses timeline decoding for fixed-cadence contact sheets", async () => {
    const frames = [decodedFrame(0), decodedFrame(500_000)];
    mocks.decodeTimelineFramesWithWebCodecs.mockResolvedValue({
      width: 2,
      height: 2,
      frames,
      metrics: { loadMs: 0, configMs: 0, demuxMs: 0, decodeMs: 0, decodedChunks: 2 },
    });
    const options = makeOptions({ mode: "contact", loopAutoFps: true });

    const result = await captureLoopOfflineFrames(options);

    expect(mocks.decodeSourceFramesWithWebCodecs).not.toHaveBeenCalled();
    expect(mocks.decodeTimelineFramesWithWebCodecs).toHaveBeenCalledOnce();
    expect(result.capturedFrames).toHaveLength(2);
  });

  it("falls back after a demux failure and drives hidden-video capture callbacks", async () => {
    mocks.decodeTimelineFramesWithWebCodecs.mockRejectedValue("demux unavailable");
    mocks.renderOfflineFrames.mockImplementation(async (options) => {
      const canvas = await options.getFrameCanvas({ timeSec: 0.25 });
      options.onProgress({ frameIndex: 0, frameCount: 1, targetTime: 0.25, etaMs: 1000 });
      options.onProgress({ frameIndex: 0, frameCount: 0, targetTime: 0.25, etaMs: 0 });
      options.onFrame({
        pixels: new Uint8ClampedArray([1, 2, 3, 255]),
        width: canvas.width,
        height: canvas.height,
        durationUs: 500_000,
      });
      return { aborted: false };
    });
    const exportVideo = makeVideo();
    const options = makeOptions({ createHiddenExportVideo: vi.fn(async () => exportVideo) });

    const result = await captureLoopOfflineFrames(options);

    expect(result.capturedFrames).toHaveLength(1);
    expect(result.gifProfile).toMatchObject({
      path: "hidden-video-fallback",
      fallbackReason: "demux unavailable",
      selectedFrames: 1,
    });
    expect(exportVideo.pause).toHaveBeenCalledOnce();
    expect(exportVideo.load).toHaveBeenCalledOnce();
  });

  it("documents missing WebCodecs sources before using hidden-video fallback", async () => {
    const options = makeOptions({ sourceUrl: null });

    const result = await captureLoopOfflineFrames(options);

    expect(result.gifProfile.fallbackReason).toBe("No source URL available for WebCodecs demux.");
    expect(options.createHiddenExportVideo).toHaveBeenCalledOnce();
  });

  it("stops decoded rendering on cancellation and still releases resources", async () => {
    const frames = [decodedFrame(0), decodedFrame(500_000)];
    mocks.decodeTimelineFramesWithWebCodecs.mockResolvedValue({
      width: 2,
      height: 2,
      frames,
      metrics: { loadMs: 0, configMs: 0, demuxMs: 0, decodeMs: 0, decodedChunks: 2 },
    });
    const options = makeOptions({ isAborted: vi.fn(() => true) });

    const result = await captureLoopOfflineFrames(options);

    expect(result.aborted).toBe(true);
    expect(result.capturedFrames).toHaveLength(0);
    expect(frames.every(({ frame }) => frame.close.mock.calls.length === 1)).toBe(true);
  });
});
