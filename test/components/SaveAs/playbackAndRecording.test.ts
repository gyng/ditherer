import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLoopPlaybackFrames } from "components/SaveAs/export/loopPlaybackCapture";
import {
  buildRecorderOptions,
  getLoopStopDelayMs,
  startCanvasRecording,
  startRealtimeLoopRecording,
} from "components/SaveAs/export/realtimeVideoRecording";

class RecorderStub {
  static instances: RecorderStub[] = [];
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly stream: MediaStream;
  readonly options: MediaRecorderOptions;
  readonly start = vi.fn((timeslice?: number) => {
    this.state = "recording";
    return timeslice;
  });
  readonly stop = vi.fn(() => {
    this.state = "inactive";
    this.onstop?.();
  });

  constructor(stream: MediaStream, options: MediaRecorderOptions) {
    this.stream = stream;
    this.options = options;
    RecorderStub.instances.push(this);
  }
}

const makeCanvas = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 1;
  return canvas;
};

const playbackOptions = (overrides: Record<string, unknown> = {}) => ({
  video: document.createElement("video"),
  getScaledCanvas: () => makeCanvas(),
  waitForRenderedSeek: vi.fn(async () => {}),
  _waitForRenderedPlaybackFrame: vi.fn(async () => undefined),
  _getCurrentRenderVersion: vi.fn(() => 0),
  updateProgress: vi.fn(),
  isAborted: vi.fn(() => false),
  usePlaybackCapture: true,
  _useVFC: false,
  captureFps: 2,
  gifFps: 20,
  rangeStartSec: 0.25,
  durationSec: 2,
  exportDurationSec: 1,
  ...overrides,
}) as Parameters<typeof captureLoopPlaybackFrames>[0];

beforeEach(() => {
  RecorderStub.instances = [];
  vi.stubGlobal("MediaRecorder", RecorderStub);
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(performance.now());
    return 1;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loop playback frame capture", () => {
  it("returns immediately when playback capture is disabled", async () => {
    const result = await captureLoopPlaybackFrames(playbackOptions({ usePlaybackCapture: false }));
    expect(result).toEqual({ capturedFrames: [], aborted: false });
  });

  it("samples the requested timeline and assigns quantized frame delays", async () => {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 25));
    const options = playbackOptions();
    const result = await captureLoopPlaybackFrames(options);

    expect(result.aborted).toBe(false);
    expect(result.capturedFrames).toHaveLength(2);
    expect(result.capturedFrames.map((frame) => frame.delay)).toEqual([500, 500]);
    expect(options.waitForRenderedSeek).toHaveBeenNthCalledWith(1, options.video, 0.25, 500);
    expect(options.waitForRenderedSeek).toHaveBeenNthCalledWith(2, options.video, 0.75, 500);
    expect(options.updateProgress).toHaveBeenNthCalledWith(1, expect.not.stringContaining("ETA"), 0.44);
    expect(options.updateProgress.mock.calls[1]?.[0]).toContain("ETA");
    expect(options.updateProgress.mock.calls[1]?.[1]).toBeCloseTo(0.8);
  });

  it("supports aborts, lower-bound FPS values, and end-of-media clamping", async () => {
    const isAborted = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const options = playbackOptions({
      captureFps: 0,
      gifFps: 0,
      rangeStartSec: 9,
      durationSec: 1,
      exportDurationSec: 3,
      isAborted,
    });
    const result = await captureLoopPlaybackFrames(options);

    expect(result.aborted).toBe(true);
    expect(result.capturedFrames).toHaveLength(1);
    expect(result.capturedFrames[0].delay).toBe(1000);
    expect(options.waitForRenderedSeek).toHaveBeenCalledWith(options.video, 0.9995, 1000);
  });

  it("can abort before the first frame without assigning a delay", async () => {
    const result = await captureLoopPlaybackFrames(playbackOptions({ isAborted: () => true }));
    expect(result).toEqual({ capturedFrames: [], aborted: true });
  });

  it("reports missing canvases and missing 2D contexts", async () => {
    await expect(captureLoopPlaybackFrames(playbackOptions({ getScaledCanvas: () => null })))
      .rejects.toThrow("requires a rendered output canvas");
    const canvas = makeCanvas();
    vi.spyOn(canvas, "getContext").mockReturnValue(null);
    await expect(captureLoopPlaybackFrames(playbackOptions({ getScaledCanvas: () => canvas })))
      .rejects.toThrow("initialize loop export canvas");
  });
});

describe("realtime MediaRecorder capture", () => {
  it("builds default and fixed-bitrate recorder options", () => {
    expect(buildRecorderOptions(null, true, 8)).toEqual({ mimeType: "video/webm" });
    expect(buildRecorderOptions({ label: "MP4", container: "mp4", mimeType: "video/mp4", ext: "mp4" }, false, 2.5))
      .toEqual({ mimeType: "video/mp4", videoBitsPerSecond: 2_500_000 });
    expect(getLoopStopDelayMs(4, 2)).toBe(2200);
    expect(getLoopStopDelayMs(4, 0)).toBe(4200);
  });

  it("records canvas data, clones source audio, and cleans every track on stop", () => {
    const clonedTrack = { stop: vi.fn() };
    const sourceTrack = { clone: vi.fn(() => clonedTrack) };
    const outputTracks = [{ stop: vi.fn() }, clonedTrack];
    const stream = {
      addTrack: vi.fn(),
      getTracks: vi.fn(() => outputTracks),
    } as unknown as MediaStream;
    const videoStream = {
      getAudioTracks: vi.fn(() => [sourceTrack]),
    } as unknown as MediaStream;
    const sourceCanvas = makeCanvas();
    const captureStream = vi.fn(() => stream);
    Object.defineProperty(sourceCanvas, "captureStream", { configurable: true, value: captureStream });
    const sourceVideo = { captureStream: vi.fn(() => videoStream) } as never;
    const mediaRecorderRef = { current: null as MediaRecorder | null };
    const streamRef = { current: null as MediaStream | null };
    const chunksRef = { current: [] as BlobPart[] };
    const onBlobReady = vi.fn();
    const onStart = vi.fn();
    const onStop = vi.fn();

    const recorder = startCanvasRecording({
      sourceCanvas,
      sourceVideo,
      includeVideoAudio: true,
      fps: 24,
      recordingFormat: { label: "VP9", container: "webm", mimeType: "video/webm;codecs=vp9", ext: "webm" },
      autoBitrate: false,
      bitrateMbps: 4,
      mediaRecorderRef,
      streamRef,
      chunksRef,
      onBlobReady,
      onStart,
      onStop,
    }) as unknown as RecorderStub;

    expect(captureStream).toHaveBeenCalledWith(24);
    expect(sourceVideo.captureStream).toHaveBeenCalledWith(24);
    expect(stream.addTrack).toHaveBeenCalledWith(clonedTrack);
    expect(recorder.start).toHaveBeenCalledWith(100);
    expect(onStart).toHaveBeenCalledOnce();
    recorder.ondataavailable?.({ data: new Blob(["frame"]) } as BlobEvent);
    recorder.stop();
    expect(outputTracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(onBlobReady).toHaveBeenCalledWith(expect.objectContaining({ type: "video/webm;codecs=vp9" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("supports no-FPS recording when the source has no audio stream", () => {
    const stream = { getTracks: vi.fn(() => []) } as unknown as MediaStream;
    const canvas = makeCanvas();
    const captureStream = vi.fn(() => stream);
    Object.defineProperty(canvas, "captureStream", { configurable: true, value: captureStream });
    const streamRef = { current: null as MediaStream | null };
    const sourceVideo = { captureStream: vi.fn(() => undefined) } as never;
    const recorder = startCanvasRecording({
      sourceCanvas: canvas,
      sourceVideo,
      includeVideoAudio: true,
      fps: undefined,
      recordingFormat: null,
      autoBitrate: true,
      bitrateMbps: 1,
      mediaRecorderRef: { current: null },
      streamRef,
      chunksRef: { current: [] },
      onBlobReady: vi.fn(),
    }) as unknown as RecorderStub;
    expect(captureStream).toHaveBeenCalledWith();
    expect(sourceVideo.captureStream).toHaveBeenCalledWith();
    streamRef.current = null;
    recorder.stop();
  });

  it("starts at loop zero and stops once even when timeupdate and timeout race", async () => {
    const stream = { getTracks: vi.fn(() => []) } as unknown as MediaStream;
    const canvas = makeCanvas();
    Object.defineProperty(canvas, "captureStream", { configurable: true, value: vi.fn(() => stream) });
    const video = document.createElement("video");
    Object.defineProperties(video, {
      duration: { configurable: true, value: 2 },
      playbackRate: { configurable: true, value: 1 },
      currentTime: { configurable: true, writable: true, value: 0 },
    });
    vi.spyOn(video, "pause").mockImplementation(() => {});
    vi.spyOn(video, "play").mockRejectedValue(new DOMException("autoplay blocked"));
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const timerRef = { current: null as number | null };
    const setCapturing = vi.fn();
    const setRecordingTime = vi.fn();

    startRealtimeLoopRecording({
      video,
      sourceCanvas: canvas,
      sourceVideo: null,
      includeVideoAudio: false,
      fps: 30,
      recordingFormat: null,
      autoBitrate: true,
      bitrateMbps: 4,
      mediaRecorderRef: { current: null },
      streamRef: { current: null },
      chunksRef: { current: [] },
      timerRef,
      setCapturing,
      setRecordingTime,
      clearRecordedResult: vi.fn(),
      onBlobReady: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(RecorderStub.instances).toHaveLength(1);
    expect(setCapturing).toHaveBeenCalledWith(true);
    now = 100;
    video.dispatchEvent(new Event("timeupdate"));
    expect(RecorderStub.instances[0].stop).not.toHaveBeenCalled();
    now = 600;
    video.dispatchEvent(new Event("timeupdate"));
    vi.runAllTimers();
    const recorder = RecorderStub.instances[0];
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(setCapturing).toHaveBeenLastCalledWith(false);
    expect(timerRef.current).toBeNull();
  });

  it("seeks non-zero videos before starting and accepts successful playback", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 1 });
    Object.defineProperties(video, {
      duration: { configurable: true, value: 1 },
      playbackRate: { configurable: true, value: 1 },
    });
    vi.spyOn(video, "pause").mockImplementation(() => {});
    vi.spyOn(video, "play").mockResolvedValue();
    const canvas = makeCanvas();
    Object.defineProperty(canvas, "captureStream", {
      configurable: true,
      value: vi.fn(() => ({ getTracks: () => [] } as unknown as MediaStream)),
    });
    startRealtimeLoopRecording({
      video,
      sourceCanvas: canvas,
      sourceVideo: null,
      includeVideoAudio: false,
      fps: undefined,
      recordingFormat: null,
      autoBitrate: true,
      bitrateMbps: 1,
      mediaRecorderRef: { current: null },
      streamRef: { current: null },
      chunksRef: { current: [] },
      timerRef: { current: null },
      setCapturing: vi.fn(),
      setRecordingTime: vi.fn(),
      clearRecordedResult: vi.fn(),
      onBlobReady: vi.fn(),
    });
    expect(video.currentTime).toBe(0);
    expect(RecorderStub.instances).toHaveLength(0);
    video.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(0);
    expect(RecorderStub.instances).toHaveLength(1);
    expect(video.play).toHaveBeenCalledOnce();
  });

  it("does not stop an already inactive recorder twice", async () => {
    const stream = { getTracks: vi.fn(() => []) } as unknown as MediaStream;
    const canvas = makeCanvas();
    Object.defineProperty(canvas, "captureStream", { configurable: true, value: vi.fn(() => stream) });
    const video = document.createElement("video");
    Object.defineProperties(video, {
      duration: { configurable: true, value: 1 },
      playbackRate: { configurable: true, value: 1 },
      currentTime: { configurable: true, writable: true, value: 0 },
    });
    vi.spyOn(video, "pause").mockImplementation(() => {});
    vi.spyOn(video, "play").mockResolvedValue();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    startRealtimeLoopRecording({
      video,
      sourceCanvas: canvas,
      sourceVideo: null,
      includeVideoAudio: false,
      fps: 30,
      recordingFormat: null,
      autoBitrate: true,
      bitrateMbps: 1,
      mediaRecorderRef: { current: null },
      streamRef: { current: null },
      chunksRef: { current: [] },
      timerRef: { current: null },
      setCapturing: vi.fn(),
      setRecordingTime: vi.fn(),
      clearRecordedResult: vi.fn(),
      onBlobReady: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    const recorder = RecorderStub.instances[0];
    recorder.state = "inactive";
    now = 600;
    video.dispatchEvent(new Event("timeupdate"));
    expect(recorder.stop).not.toHaveBeenCalled();
  });
});
