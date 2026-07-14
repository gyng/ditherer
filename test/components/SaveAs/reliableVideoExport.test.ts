import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getReliableVideoSupport: vi.fn(),
  createOfflineVideoEncoder: vi.fn(),
  planReliableVideoRouting: vi.fn(),
  buildDecodedTimeline: vi.fn(),
  decodeTimelineFramesWithWebCodecs: vi.fn(),
  renderOfflineFrames: vi.fn(),
}));

vi.mock("components/SaveAs/export/offlineVideoEncode", () => ({
  getReliableVideoSupport: mocks.getReliableVideoSupport,
  createOfflineVideoEncoder: mocks.createOfflineVideoEncoder,
}));

vi.mock("components/SaveAs/export/exportRouting", () => ({
  planReliableVideoRouting: mocks.planReliableVideoRouting,
}));

vi.mock("components/SaveAs/export/offlineWebCodecsDecode", () => ({
  buildDecodedTimeline: mocks.buildDecodedTimeline,
  decodeTimelineFramesWithWebCodecs: mocks.decodeTimelineFramesWithWebCodecs,
}));

vi.mock("components/SaveAs/export/offlineRender", () => ({
  renderOfflineFrames: mocks.renderOfflineFrames,
}));

import { runReliableVideoExport } from "components/SaveAs/export/reliableVideoExport";

const makeCanvas = (width = 4, height = 3) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const makeEncoder = () => ({
  addFrame: vi.fn().mockResolvedValue(undefined),
  finalize: vi.fn().mockResolvedValue({
    blob: new Blob(["video"]),
    metrics: { audioPrepareMs: 3, finalizeMs: 7 },
  }),
  dispose: vi.fn(),
  audioIncluded: true,
  audioUnavailableReason: null,
});

const makeOptions = (overrides: Record<string, unknown> = {}) => {
  const video = document.createElement("video");
  Object.defineProperty(video, "duration", { configurable: true, value: 2 });
  Object.defineProperty(video, "currentSrc", { configurable: true, value: "https://example.test/source.mp4" });
  return {
    video,
    preferredMode: "auto" as const,
    includeAudio: true,
    reliableFps: 2,
    sourceEstimatedFps: 29.97,
    reliableMaxFps: 30,
    rangeStartSec: 0,
    rangeEndSec: 1,
    exportDurationSec: 1,
    reliableScope: "loop" as const,
    reliableStrictValidation: true,
    reliableSettleFrames: 2,
    getScaledCanvas: vi.fn(() => makeCanvas()),
    waitForRenderedSeek: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn(),
    isAborted: vi.fn(() => false),
    renderFrameForExport: vi.fn(async () => makeCanvas()),
    clearExportSession: vi.fn(),
    logReliableRenderProfile: vi.fn(),
    ...overrides,
  };
};

describe("runReliableVideoExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReliableVideoSupport.mockResolvedValue({ supported: true });
    mocks.createOfflineVideoEncoder.mockResolvedValue(makeEncoder());
    mocks.planReliableVideoRouting.mockReturnValue({
      shouldAttemptWebCodecs: false,
      fallbackReason: "decoder unavailable",
    });
    mocks.renderOfflineFrames.mockResolvedValue({
      aborted: false,
      frameCount: 2,
      metrics: { seekMs: 10, captureMs: 20, encodeMs: 30 },
    });
  });

  it("rejects missing output and unsupported browser configurations before encoding", async () => {
    await expect(runReliableVideoExport(makeOptions({ getScaledCanvas: () => null })))
      .rejects.toThrow("requires a rendered output canvas");

    mocks.getReliableVideoSupport.mockResolvedValueOnce({ supported: false, reason: "codec blocked" });
    await expect(runReliableVideoExport(makeOptions())).rejects.toThrow("codec blocked");

    mocks.getReliableVideoSupport.mockResolvedValueOnce({ supported: false, reason: "" });
    await expect(runReliableVideoExport(makeOptions())).rejects.toThrow("unavailable in this browser");
    expect(mocks.createOfflineVideoEncoder).not.toHaveBeenCalled();
  });

  it("completes browser-seek routing and reports range progress and audio metrics", async () => {
    const encoder = makeEncoder();
    mocks.createOfflineVideoEncoder.mockResolvedValue(encoder);
    const options = makeOptions({ reliableScope: "range", rangeStartSec: 0.25, rangeEndSec: 0.75 });

    const result = await runReliableVideoExport(options);

    expect(result).toMatchObject({ aborted: false, audioIncluded: true });
    expect(result.renderResult).toMatchObject({ sourcePath: "browser-seek", fallbackReason: "decoder unavailable" });
    expect(options.updateProgress).toHaveBeenCalledWith(expect.stringContaining("0.25s-0.75s"), 0.04);
    expect(options.updateProgress).toHaveBeenCalledWith("Encoding video + audio...", 0.92);
    expect(options.logReliableRenderProfile).toHaveBeenCalledWith("completed", expect.objectContaining({
      sourcePath: "browser-seek",
      audioIncluded: true,
    }));

    const encoderOptions = mocks.createOfflineVideoEncoder.mock.calls[0][0];
    encoderOptions.onProgress("Muxing audio");
    expect(options.updateProgress).toHaveBeenCalledWith("Muxing audio", 0.92);

    const renderOptions = mocks.renderOfflineFrames.mock.calls[0][0];
    await renderOptions.waitForFrame(options.video, 0.5, 16);
    renderOptions.onProgress({ phase: "rewind", frameIndex: 0, frameCount: 2, targetTime: 0.25, etaMs: 0 });
    renderOptions.onProgress({ phase: "seek", frameIndex: 0, frameCount: 2, targetTime: 0.25, etaMs: 1000 });
    renderOptions.onProgress({ phase: "capture", frameIndex: 0, frameCount: 0, targetTime: 0.25, etaMs: 0 });
    await renderOptions.onFrame({ pixels: new Uint8ClampedArray(4), width: 1, height: 1 });
    expect(options.waitForRenderedSeek).toHaveBeenCalledWith(options.video, 0.5, 16, true, 2);
    expect(encoder.addFrame).toHaveBeenCalledOnce();
  });

  it("renders decoded WebCodecs frames through the export pipeline", async () => {
    const encoder = makeEncoder();
    mocks.createOfflineVideoEncoder.mockResolvedValue(encoder);
    mocks.planReliableVideoRouting.mockReturnValue({ shouldAttemptWebCodecs: true });
    const timeline = [
      { timeSec: 0, timestampUs: 0, durationUs: 500_000 },
      { timeSec: 0.5, timestampUs: 500_000, durationUs: 500_000 },
    ];
    const frames = timeline.map(() => ({ frame: Object.assign(makeCanvas(), { close: vi.fn() }) }));
    mocks.buildDecodedTimeline.mockReturnValue(timeline);
    mocks.decodeTimelineFramesWithWebCodecs.mockResolvedValue({ width: 4, height: 3, frames });
    const options = makeOptions();

    const result = await runReliableVideoExport(options);

    expect(result.renderResult).toMatchObject({ sourcePath: "webcodecs", frameCount: 2 });
    expect(options.renderFrameForExport).toHaveBeenCalledTimes(2);
    expect(encoder.addFrame).toHaveBeenCalledTimes(2);
    expect(frames.every(({ frame }) => frame.close.mock.calls.length === 1)).toBe(true);
    expect(options.clearExportSession).toHaveBeenCalledOnce();
  });

  it("falls back to browser seeking when WebCodecs decode or rendering fails", async () => {
    mocks.planReliableVideoRouting.mockReturnValue({ shouldAttemptWebCodecs: true });
    mocks.buildDecodedTimeline.mockReturnValue([{ timeSec: 0, timestampUs: 0, durationUs: 1_000_000 }]);
    mocks.decodeTimelineFramesWithWebCodecs.mockRejectedValue(new Error("demux failed"));
    const options = makeOptions();

    const result = await runReliableVideoExport(options);

    expect(result.renderResult).toMatchObject({
      sourcePath: "browser-seek",
      fallbackReason: "demux failed",
    });
    expect(mocks.renderOfflineFrames).toHaveBeenCalledOnce();
    expect(options.clearExportSession).toHaveBeenCalledOnce();

    const renderOptions = mocks.renderOfflineFrames.mock.calls[0][0];
    renderOptions.onProgress({ phase: "rewind", frameIndex: 0, frameCount: 1, targetTime: 0, etaMs: 0 });
    renderOptions.onProgress({ phase: "capture", frameIndex: 0, frameCount: 1, targetTime: 0, etaMs: 500 });
    expect(options.updateProgress).toHaveBeenCalledWith("Rewinding...", 0.08);
  });

  it("disposes an empty aborted export without finalizing", async () => {
    const encoder = makeEncoder();
    mocks.createOfflineVideoEncoder.mockResolvedValue(encoder);
    mocks.renderOfflineFrames.mockResolvedValue({
      aborted: true,
      frameCount: 0,
      metrics: { seekMs: 1.4, captureMs: 2.4, encodeMs: 3.4 },
    });

    const result = await runReliableVideoExport(makeOptions());

    expect(result).toMatchObject({ blob: null, aborted: true, finalizeMetrics: null });
    expect(encoder.dispose).toHaveBeenCalledOnce();
    expect(encoder.finalize).not.toHaveBeenCalled();
  });

  it("finalizes a partial aborted export and omits unavailable audio", async () => {
    const encoder = makeEncoder();
    encoder.audioIncluded = false;
    encoder.audioUnavailableReason = "source had no audio";
    mocks.createOfflineVideoEncoder.mockResolvedValue(encoder);
    mocks.renderOfflineFrames.mockResolvedValue({
      aborted: true,
      frameCount: 1,
      metrics: { seekMs: 1, captureMs: 2, encodeMs: 3 },
    });

    const result = await runReliableVideoExport(makeOptions());

    expect(result).toMatchObject({
      aborted: true,
      audioIncluded: false,
      audioUnavailableReason: "source had no audio",
    });
    expect(encoder.finalize).toHaveBeenCalledOnce();
  });

  it("treats an external abort after rendering as a partial result", async () => {
    const encoder = makeEncoder();
    encoder.audioIncluded = false;
    mocks.createOfflineVideoEncoder.mockResolvedValue(encoder);
    const isAborted = vi.fn(() => true);
    mocks.renderOfflineFrames.mockResolvedValue({
      aborted: false,
      frameCount: 1,
      metrics: { seekMs: 1, captureMs: 2, encodeMs: 3 },
    });

    const result = await runReliableVideoExport(makeOptions({ isAborted }));

    expect(result.aborted).toBe(true);
    expect(encoder.finalize).toHaveBeenCalledOnce();
  });

  it("disposes the encoder when rendering or finalization throws", async () => {
    const encoder = makeEncoder();
    encoder.finalize.mockRejectedValue(new Error("mux failed"));
    mocks.createOfflineVideoEncoder.mockResolvedValue(encoder);

    await expect(runReliableVideoExport(makeOptions())).rejects.toThrow("mux failed");
    expect(encoder.dispose).toHaveBeenCalledOnce();
  });
});
