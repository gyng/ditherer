import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import SaveAs from "components/SaveAs";

const bridge = vi.hoisted(() => ({
  context: null as unknown,
  exportOptions: null as Record<string, unknown> | null,
  imageProps: null as Record<string, unknown> | null,
  reliableSupport: vi.fn(() => Promise.resolve({ supported: true, audio: true })),
  renderSyncOptions: null as Record<string, unknown> | null,
  results: null as Record<string, unknown> | null,
  videoProps: null as Record<string, unknown> | null,
  handlers: Object.fromEntries([
    "handleSave", "handleCopy", "handleRecord", "handleSaveVideo", "handleCopyVideo",
    "handleSaveGif", "handleCopyGif", "handleSaveSequence", "handleCopySequence",
    "handleSaveContactSheet", "handleCopyContactSheet", "handleAbortExport",
    "handleRecordLoop", "handleVideoExport",
  ].map((name) => [name, vi.fn()])),
  sync: {
    getScaledCanvas: vi.fn(),
    estimateVideoFps: vi.fn(() => 24),
    waitForRenderedSeek: vi.fn(),
    waitForRenderedPlaybackFrame: vi.fn(),
    waitForVideoSeekSettled: vi.fn(),
    createHiddenExportVideo: vi.fn(),
  },
}));

vi.mock("context/useFilter", () => ({ useFilter: () => bridge.context }));
vi.mock("@gyng/ditherer-filters", () => ({
  filterList: [{ filter: { name: "Temporal Test", temporal: true } }],
  hasTemporalBehavior: (entry: { filter: { temporal?: boolean } }) => entry.filter.temporal === true,
}));
vi.mock("components/SaveAs/export/offlineVideoEncode", () => ({
  getReliableVideoSupport: bridge.reliableSupport,
}));
vi.mock("components/SaveAs/helpers", () => ({
  detectRecordingFormats: () => [
    { label: "WebM", ext: "webm", mimeType: "video/webm" },
    { label: "MP4", ext: "mp4", mimeType: "video/mp4" },
  ],
  getGifPaletteColorTable: () => [[1, 2, 3], [4, 5, 6]],
}));
vi.mock("components/SaveAs/hooks/useSaveAsResults", () => ({
  useSaveAsResults: () => bridge.results,
}));
vi.mock("components/SaveAs/hooks/useSaveAsExportHandlers", () => ({
  useSaveAsExportHandlers: (options: Record<string, unknown>) => {
    bridge.exportOptions = options;
    return bridge.handlers;
  },
}));
vi.mock("components/SaveAs/hooks/useSaveAsRenderSync", () => ({
  useSaveAsRenderSync: (options: Record<string, unknown>) => {
    bridge.renderSyncOptions = options;
    return bridge.sync;
  },
}));
vi.mock("components/SaveAs/ui/ImageTab", () => ({
  ImageTab: (props: Record<string, unknown>) => {
    bridge.imageProps = props;
    return <div data-testid="image-tab">Image panel</div>;
  },
}));
vi.mock("components/SaveAs/ui/VideoTab", () => ({
  VideoTab: (props: Record<string, unknown>) => {
    bridge.videoProps = props;
    return <div data-testid="video-tab">Video panel</div>;
  },
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;
let output: HTMLCanvasElement;
let outputCanvasRef: { current: HTMLCanvasElement | null };
let onClose: ReturnType<typeof vi.fn>;
let actions: Record<string, ReturnType<typeof vi.fn>>;

const state = (overrides: Record<string, unknown> = {}) => ({
  chain: [],
  activeIndex: 0,
  video: null,
  realtimeFiltering: false,
  videoVolume: 0.8,
  outputImage: null,
  ...overrides,
});

const render = (stateOverrides: Record<string, unknown> = {}) => {
  bridge.context = { state: state(stateOverrides), actions };
  act(() => root.render(<SaveAs outputCanvasRef={outputCanvasRef} onClose={onClose} />));
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const elementWithDirectText = (text: string) => Array.from(container.querySelectorAll("*"))
  .find((element) => Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === text,
  ));

beforeEach(() => {
  vi.clearAllMocks();
  bridge.exportOptions = null;
  bridge.imageProps = null;
  bridge.renderSyncOptions = null;
  bridge.videoProps = null;
  bridge.reliableSupport.mockResolvedValue({ supported: true, audio: true });
  bridge.results = {
    recordedBlob: null,
    recordedUrl: null,
    gifBlob: null,
    gifUrl: null,
    gifResultLabel: null,
    sequenceBlob: null,
    contactSheetBlob: null,
    contactSheetUrl: null,
    clearRecordedResult: vi.fn(),
    setRecordedResult: vi.fn(),
    clearGifResult: vi.fn(),
    setGifResult: vi.fn(),
    clearSequenceResult: vi.fn(),
    setSequenceResult: vi.fn(),
    clearContactSheetResult: vi.fn(),
    setContactSheetResult: vi.fn(),
  };
  actions = {
    renderFrameForExport: vi.fn(),
    clearExportSession: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  output = document.createElement("canvas");
  output.width = 320;
  output.height = 200;
  outputCanvasRef = { current: output };
  onClose = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("SaveAs coordinator", () => {
  it("drives still-image settings, progress normalization, and close behavior", () => {
    render();
    expect(container.querySelector('[data-testid="image-tab"]')).not.toBeNull();
    expect(bridge.imageProps).toMatchObject({
      format: "png",
      canvasWidth: 320,
      canvasHeight: 200,
      exportWidth: 320,
      exportHeight: 200,
      canvasReady: true,
      largeExport: false,
    });

    act(() => {
      (bridge.imageProps!.setFormat as (value: string) => void)("jpeg");
      (bridge.imageProps!.setQuality as (value: number) => void)(0.5);
      (bridge.imageProps!.setResolution as (value: string) => void)("custom");
      (bridge.imageProps!.setCustomMultiplier as (value: number) => void)(20);
    });
    expect(bridge.imageProps).toMatchObject({
      format: "jpeg",
      quality: 0.5,
      exportWidth: 6400,
      exportHeight: 4000,
      largeExport: true,
    });
    (bridge.imageProps!.onSave as () => void)();
    (bridge.imageProps!.onCopy as () => void)();
    expect(bridge.handlers.handleSave).toHaveBeenCalled();
    expect(bridge.handlers.handleCopy).toHaveBeenCalled();

    act(() => (bridge.exportOptions!.updateProgress as (message: string, value?: number) => void)("Half", 1.5));
    expect(bridge.imageProps!.copySuccess).toBe(false);
    act(() => (bridge.exportOptions!.updateProgress as (message: string, value?: number) => void)("Unknown", Number.NaN));
    act(() => (bridge.exportOptions!.clearProgress as () => void)());
    (bridge.exportOptions!.logReliableRenderProfile as (label: string, stats: object) => void)("done", {});
    (bridge.exportOptions!.logGifExportProfile as (label: string, stats: object) => void)("done", {});

    const close = container.querySelector<HTMLButtonElement>('[title="Close"]')!;
    act(() => close.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("advertises dimensions from output state when the mounted canvas ref is one frame stale", () => {
    output.width = 300;
    output.height = 300;
    render({
      outputImage: { width: 256, height: 192 },
      outputScale: 1,
    });

    expect(bridge.imageProps).toMatchObject({
      canvasWidth: 256,
      canvasHeight: 192,
      exportWidth: 256,
      exportHeight: 192,
    });
  });

  it("initializes video ranges/support and routes every recording/frame panel callback", async () => {
    const video = {
      duration: 12,
      currentTime: 3,
      paused: true,
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;
    render({
      video,
      chain: [{ enabled: true, filter: { name: "Temporal Test", options: { palette: {} } } }],
    });
    await flush();
    expect(container.querySelector('[data-testid="video-tab"]')).not.toBeNull();
    expect(bridge.reliableSupport).toHaveBeenCalledWith(320, 200, 24, true);
    const recording = bridge.videoProps!.recordingPanel as Record<string, unknown>;
    const frames = bridge.videoProps!.frameExportPanel as Record<string, unknown>;
    expect(recording).toMatchObject({ hasSourceVideo: true, videoDuration: 12 });
    expect(frames).toMatchObject({ hasSourceVideo: true, canUseGifFilterPalette: true });

    act(() => {
      (recording.onSetVideoLoopMode as (value: string) => void)("offline");
      (recording.onSetIncludeVideoAudio as (value: boolean) => void)(false);
      (recording.onSetSelectedRecFormat as (value: string) => void)("MP4");
      (recording.onSetSelectedRecFormat as (value: string) => void)("missing");
      (recording.onSetAutoRecordFps as (value: boolean) => void)(false);
      (recording.onSetRecordFps as (value: number) => void)(25);
      (recording.onSetReliableMaxFps as (value: number) => void)(30);
      (recording.onSetAutoBitrate as (value: boolean) => void)(false);
      (recording.onSetBitrate as (value: number) => void)(4);
      (recording.onSetReliableSettleFrames as (value: number) => void)(4);
      (recording.onSetReliableStrictValidation as (value: boolean) => void)(true);
      (recording.onSetReliableScope as (value: string) => void)("range");
      (recording.onSetReliableRangeStart as (value: number) => void)(1);
      (recording.onSetReliableRangeEnd as (value: number) => void)(9);
      (frames.onSetFrames as (value: number) => void)(40);
      (frames.onSetLoopCaptureMode as (value: string) => void)("offline");
      (frames.onSetLoopAutoFps as (value: boolean) => void)(false);
      (frames.onSetGifFps as (value: number) => void)(15);
      (frames.onSetContactColumns as (value: number) => void)(6);
      (frames.onSetGifPaletteSource as (value: string) => void)("filter");
      (frames.onSetLoopExportScope as (value: string) => void)("range");
      (frames.onSetLoopRangeStart as (value: number) => void)(2);
      (frames.onSetLoopRangeEnd as (value: number) => void)(8);
    });
    expect((bridge.videoProps!.recordingPanel as Record<string, unknown>)).toMatchObject({
      videoLoopMode: "offline",
      includeVideoAudio: false,
      activeRecFormatLabel: "MP4",
      recordFps: 25,
      reliableScope: "range",
    });

    (recording.onRecord as () => void)();
    (recording.onRecordLoop as () => void)();
    (recording.onSaveVideo as () => void)();
    (recording.onCopyVideo as () => void)();
    (frames.onAbortExport as () => void)();
    (frames.onVideoExport as () => void)();
    (frames.onSaveGif as () => void)();
    (frames.onCopyGif as () => void)();
    (frames.onSaveSequence as () => void)();
    (frames.onCopySequence as () => void)();
    (frames.onSaveContactSheet as () => void)();
    (frames.onCopyContactSheet as () => void)();
    for (const name of [
      "handleRecord", "handleRecordLoop", "handleSaveVideo", "handleCopyVideo",
      "handleAbortExport", "handleVideoExport", "handleSaveGif", "handleCopyGif",
      "handleSaveSequence", "handleCopySequence", "handleSaveContactSheet",
      "handleCopyContactSheet",
    ]) expect(bridge.handlers[name]).toHaveBeenCalled();

    const managed = video as HTMLVideoElement & { __manualPause?: boolean };
    (bridge.exportOptions!.setManualPause as (video: HTMLVideoElement | null, paused: boolean) => void)(null, true);
    (bridge.exportOptions!.setManualPause as (video: HTMLVideoElement | null, paused: boolean) => void)(video, true);
    expect(managed.__manualPause).toBe(true);
  });

  it("shows the video tab for temporal/realtime state and applies contact defaults", () => {
    const video = document.createElement("video");
    render({ video, realtimeFiltering: true });
    expect(container.querySelector('[data-testid="video-tab"]')).not.toBeNull();
    const imageTab = elementWithDirectText("Image")!;
    expect(imageTab).toBeTruthy();
    act(() => imageTab.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector('[data-testid="image-tab"]')).not.toBeNull();
    const videoTab = elementWithDirectText("Video")!;
    expect(videoTab).toBeTruthy();
    act(() => videoTab.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector('[data-testid="video-tab"]')).not.toBeNull();

    act(() => (bridge.videoProps!.onSetVideoFormat as (value: string) => void)("contact"));
    const frameProps = bridge.videoProps!.frameExportPanel as Record<string, unknown>;
    expect(bridge.videoProps!.videoFormat).toBe("contact");
    expect(frameProps).toMatchObject({ frames: 30, contactColumns: 5, loopCaptureMode: "webcodecs" });

    act(() => (bridge.videoProps!.onSetVideoFormat as (value: string) => void)("gif"));
    expect(bridge.videoProps!.videoFormat).toBe("gif");
  });

  it("surfaces reliable-support failures and disables canvas-dependent exports", async () => {
    bridge.reliableSupport.mockRejectedValueOnce(new Error("codec probe failed"));
    outputCanvasRef.current = null;
    const video = { duration: 5 } as HTMLVideoElement;
    render({ video });
    await flush();
    expect((bridge.videoProps!.recordingPanel as Record<string, unknown>).reliableVideoSupport).toBeNull();
    expect((bridge.renderSyncOptions!.outputCanvasRef as { current: unknown }).current).toBeNull();

    outputCanvasRef.current = output;
    render({ video });
    await flush();
    expect((bridge.videoProps!.recordingPanel as Record<string, unknown>).reliableVideoSupport)
      .toMatchObject({ supported: false, reason: "codec probe failed", audio: false });
  });
});
