import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSaveAsExportHandlers } from "components/SaveAs/hooks/useSaveAsExportHandlers";

const mocks = vi.hoisted(() => ({
  copyBlobWithFeedback: vi.fn(() => Promise.resolve()),
  runCurrentFrameContactSheetExport: vi.fn(() => Promise.resolve()),
  runCurrentFrameGifExport: vi.fn(() => Promise.resolve()),
  runCurrentFrameSequenceExport: vi.fn(() => Promise.resolve()),
  runLoopExport: vi.fn(() => Promise.resolve()),
  runReliableVideoExport: vi.fn(() => Promise.resolve(null)),
  saveBlob: vi.fn(),
  startCanvasRecording: vi.fn(),
  startRealtimeLoopRecording: vi.fn(),
}));

vi.mock("components/SaveAs/export/currentFrameExport", () => ({
  runCurrentFrameContactSheetExport: mocks.runCurrentFrameContactSheetExport,
  runCurrentFrameGifExport: mocks.runCurrentFrameGifExport,
  runCurrentFrameSequenceExport: mocks.runCurrentFrameSequenceExport,
}));
vi.mock("components/SaveAs/export/loopExportOrchestrator", () => ({
  runLoopExport: mocks.runLoopExport,
}));
vi.mock("components/SaveAs/export/blobActions", () => ({
  copyBlobWithFeedback: mocks.copyBlobWithFeedback,
  saveBlob: mocks.saveBlob,
}));
vi.mock("components/SaveAs/export/realtimeVideoRecording", () => ({
  startCanvasRecording: mocks.startCanvasRecording,
  startRealtimeLoopRecording: mocks.startRealtimeLoopRecording,
}));
vi.mock("components/SaveAs/export/reliableVideoExport", () => ({
  runReliableVideoExport: mocks.runReliableVideoExport,
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useSaveAsExportHandlers>;
let canvas: HTMLCanvasElement;
let video: HTMLVideoElement;
let options: Record<string, unknown>;

const callbacks = [
  "clearRecordedResult",
  "setRecordedResult",
  "clearGifResult",
  "setGifResult",
  "clearSequenceResult",
  "setSequenceResult",
  "clearContactSheetResult",
  "setContactSheetResult",
  "setCopySuccess",
  "setCapturing",
  "setRecordingTime",
  "setExporting",
  "updateProgress",
  "clearProgress",
  "estimateVideoFps",
  "waitForRenderedSeek",
  "waitForRenderedPlaybackFrame",
  "waitForVideoSeekSettled",
  "createHiddenExportVideo",
  "setManualPause",
  "logReliableRenderProfile",
  "logGifExportProfile",
] as const;

const Harness = ({ value }: { value: Record<string, unknown> }) => {
  latest = useSaveAsExportHandlers(value as never);
  return null;
};

const render = (overrides: Record<string, unknown> = {}) => {
  options = { ...options, ...overrides };
  act(() => root.render(<Harness value={options} />));
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 12;
  Object.defineProperty(canvas, "toBlob", {
    configurable: true,
    value: vi.fn((callback: BlobCallback) => callback(new Blob(["image"], { type: "image/png" }))),
  });
  video = {
    duration: 10,
    currentTime: 2,
    paused: false,
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
  } as unknown as HTMLVideoElement;
  const actionFns = {
    renderFrameForExport: vi.fn((source: HTMLCanvasElement) => Promise.resolve(source)),
    clearExportSession: vi.fn(),
  };
  const fns = Object.fromEntries(callbacks.map((name) => [name, vi.fn()]));
  (fns.estimateVideoFps as ReturnType<typeof vi.fn>).mockReturnValue(24);
  (fns.waitForRenderedSeek as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (fns.waitForRenderedPlaybackFrame as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (fns.waitForVideoSeekSettled as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (fns.createHiddenExportVideo as ReturnType<typeof vi.fn>).mockResolvedValue(video);
  options = {
    outputCanvasRef: { current: canvas },
    stateVideo: null,
    actions: actionFns,
    capturing: false,
    exporting: false,
    format: "png",
    quality: 0.8,
    includeVideoAudio: true,
    activeRecFormat: { mimeType: "video/webm", ext: "webm", label: "WebM" },
    bitrate: 2.5,
    autoBitrate: true,
    autoRecordFps: true,
    recordFps: 30,
    videoLoopMode: "realtime",
    reliableStrictValidation: false,
    reliableMaxFps: 60,
    reliableSettleFrames: 2,
    reliableScope: "loop",
    reliableRangeStart: 0,
    reliableRangeEnd: 10,
    frames: 5,
    gifFps: 10,
    gifPaletteSource: "auto",
    gifFilterPalette: null,
    loopAutoFps: true,
    loopCaptureMode: "offline",
    loopExportScope: "loop",
    loopRangeStart: 0,
    loopRangeEnd: 10,
    contactColumns: 3,
    mult: 1,
    videoFormat: "gif",
    mediaRecorderRef: { current: null },
    streamRef: { current: null },
    chunksRef: { current: [] },
    timerRef: { current: null },
    exportAbortRef: { current: false },
    renderVersionRef: { current: 7 },
    recordedBlob: new Blob(["recorded"], { type: "video/webm" }),
    gifBlob: new Blob(["gif"], { type: "image/gif" }),
    sequenceBlob: new Blob(["zip"], { type: "application/zip" }),
    contactSheetBlob: new Blob(["sheet"], { type: "image/png" }),
    getScaledCanvas: vi.fn(() => canvas),
    ...fns,
  };
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useSaveAsExportHandlers", () => {
  it("saves/copies every artifact and honors image format quality", async () => {
    latest.handleSave();
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", undefined);
    expect(mocks.saveBlob).toHaveBeenCalledWith(expect.any(Blob), "png");

    render({ format: "jpeg", quality: 0.6 });
    latest.handleSave();
    expect(canvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), "image/jpeg", 0.6);
    await latest.handleCopy();

    latest.handleSaveVideo();
    await latest.handleCopyVideo();
    latest.handleSaveGif();
    await latest.handleCopyGif();
    latest.handleSaveSequence();
    await latest.handleCopySequence();
    latest.handleSaveContactSheet();
    await latest.handleCopyContactSheet();
    expect(mocks.saveBlob.mock.calls.map((call) => call[1])).toEqual([
      "png",
      "jpeg",
      "webm",
      "gif",
      "zip",
      "png",
    ]);
    expect(mocks.copyBlobWithFeedback).toHaveBeenCalledTimes(5);

    render({ recordedBlob: new Blob(["mp4"], { type: "video/mp4" }) });
    latest.handleSaveVideo();
    expect(mocks.saveBlob).toHaveBeenLastCalledWith(expect.any(Blob), "mp4");
    render({ recordedBlob: null, gifBlob: null, sequenceBlob: null, contactSheetBlob: null });
    latest.handleSaveVideo();
    latest.handleSaveGif();
    latest.handleSaveSequence();
    latest.handleSaveContactSheet();
  });

  it("starts and stops realtime recordings through lifecycle callbacks", () => {
    latest.handleRecord();
    expect(mocks.startCanvasRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCanvas: canvas,
        includeVideoAudio: true,
        fps: undefined,
      }),
    );
    const recording = mocks.startCanvasRecording.mock.calls[0][0];
    recording.onStart();
    expect(options.setCapturing).toHaveBeenCalledWith(true);
    expect(options.setRecordingTime).toHaveBeenCalledWith(0);
    recording.onBlobReady(new Blob(["ready"]));
    expect(options.setRecordedResult).toHaveBeenCalled();
    recording.onStop();

    const stop = vi.fn();
    const timerRef = { current: 123 };
    const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    render({
      capturing: true,
      mediaRecorderRef: { current: { state: "recording", stop } },
      timerRef,
    });
    latest.handleRecord();
    expect(stop).toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith(123);
    expect(timerRef.current).toBeNull();
    expect(options.setCapturing).toHaveBeenCalledWith(false);
  });

  it("routes realtime and reliable loop recording, including restore and abort behavior", async () => {
    render({ stateVideo: video });
    latest.handleRecordLoop();
    expect(mocks.startRealtimeLoopRecording).toHaveBeenCalled();
    const realtime = mocks.startRealtimeLoopRecording.mock.calls[0][0];
    realtime.onBlobReady(new Blob(["loop"]));
    expect(options.setRecordedResult).toHaveBeenCalled();

    render({ videoLoopMode: "offline", exporting: true });
    latest.handleRecordLoop();
    expect((options.exportAbortRef as { current: boolean }).current).toBe(true);
    expect(options.updateProgress).toHaveBeenCalledWith("Stopping...", null);

    mocks.runReliableVideoExport.mockResolvedValue({
      blob: new Blob(["reliable"]),
      aborted: false,
      audioIncluded: false,
      audioUnavailableReason: "no decoder",
    });
    render({
      exporting: false,
      reliableScope: "range",
      reliableRangeStart: -5,
      reliableRangeEnd: 20,
      autoRecordFps: false,
      recordFps: 25,
    });
    latest.handleRecordLoop();
    await flush();
    expect(video.pause).toHaveBeenCalled();
    expect(mocks.runReliableVideoExport).toHaveBeenCalledWith(
      expect.objectContaining({
        rangeStartSec: 0,
        rangeEndSec: 10,
        reliableFps: 25,
        reliableScope: "range",
      }),
    );
    const reliable = mocks.runReliableVideoExport.mock.calls.at(-1)![0];
    await reliable.renderFrameForExport(canvas, 3);
    reliable.clearExportSession();
    expect(reliable.isAborted()).toBe(false);
    expect(
      (options.actions as Record<string, ReturnType<typeof vi.fn>>).renderFrameForExport,
    ).toHaveBeenCalled();
    expect(options.waitForRenderedSeek).toHaveBeenCalledWith(video, 2, 40);
    expect(video.play).toHaveBeenCalled();
  });

  it("runs current-frame and loop exports and always finalizes failures", async () => {
    await act(async () => latest.handleExportGif());
    await act(async () => latest.handleExportSequence());
    await act(async () => latest.handleExportContactSheet());
    expect(mocks.runCurrentFrameGifExport).toHaveBeenCalled();
    expect(mocks.runCurrentFrameSequenceExport).toHaveBeenCalled();
    expect(mocks.runCurrentFrameContactSheetExport).toHaveBeenCalled();

    render({ stateVideo: video });
    await act(async () => latest.handleExportLoop("gif"));
    await act(async () => latest.handleExportLoop("sequence"));
    await act(async () => latest.handleExportLoop("contact"));
    expect(mocks.runLoopExport).toHaveBeenCalledTimes(3);
    const loop = mocks.runLoopExport.mock.calls[0][0];
    expect(loop.getCurrentRenderVersion()).toBe(7);
    await loop.renderFrameForExport(canvas, 1);
    loop.clearExportSession();
    expect(loop.isAborted()).toBe(false);

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runCurrentFrameGifExport.mockRejectedValueOnce(new Error("gif failed"));
    mocks.runCurrentFrameSequenceExport.mockRejectedValueOnce(new Error("zip failed"));
    mocks.runCurrentFrameContactSheetExport.mockRejectedValueOnce(new Error("sheet failed"));
    mocks.runLoopExport.mockRejectedValueOnce(new Error("loop failed"));
    await act(async () => latest.handleExportGif());
    await act(async () => latest.handleExportSequence());
    await act(async () => latest.handleExportContactSheet());
    await act(async () => latest.handleExportLoop("contact"));
    expect(error).toHaveBeenCalledTimes(4);
    expect(options.setExporting).toHaveBeenLastCalledWith(false);
    expect(options.clearProgress).toHaveBeenCalled();
  });

  it("dispatches the selected video export format for still and video sources", async () => {
    latest.handleVideoExport();
    await flush();
    expect(mocks.runCurrentFrameGifExport).toHaveBeenCalled();
    render({ videoFormat: "contact" });
    latest.handleVideoExport();
    await flush();
    expect(mocks.runCurrentFrameContactSheetExport).toHaveBeenCalled();
    render({ videoFormat: "sequence" });
    latest.handleVideoExport();
    await flush();
    expect(mocks.runCurrentFrameSequenceExport).toHaveBeenCalled();

    render({ stateVideo: video, videoFormat: "gif" });
    latest.handleVideoExport();
    await flush();
    render({ videoFormat: "contact" });
    latest.handleVideoExport();
    await flush();
    render({ videoFormat: "sequence" });
    latest.handleVideoExport();
    await flush();
    expect(mocks.runLoopExport.mock.calls.slice(-3).map((call) => call[0].mode)).toEqual([
      "gif",
      "contact",
      "sequence",
    ]);
  });
});
