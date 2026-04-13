import { formatEta, quantizeGifDelay, type GifFrame } from "../helpers";

type PlaybackFrameStatus = {
  renderedTime: number | null;
  renderVersion: number;
  frameToken: number;
};

interface CaptureLoopPlaybackFramesOptions {
  video: HTMLVideoElement;
  getScaledCanvas: () => HTMLCanvasElement | null;
  waitForRenderedSeek: (
    video: HTMLVideoElement,
    targetTime: number,
    expectedFrameMs: number,
  ) => Promise<void>;
  _waitForRenderedPlaybackFrame: (
    targetTime: number,
    previousRenderVersion: number,
    expectedFrameMs: number,
  ) => Promise<PlaybackFrameStatus | undefined>;
  _getCurrentRenderVersion: () => number;
  updateProgress: (message: string, value?: number | null) => void;
  isAborted: () => boolean;
  usePlaybackCapture: boolean;
  _useVFC: boolean;
  captureFps: number;
  gifFps: number;
  rangeStartSec: number;
  durationSec: number;
  exportDurationSec: number;
}

const captureCurrentCanvasFrame = (
  getScaledCanvas: () => HTMLCanvasElement | null,
  fallbackDelayMs: number,
) => {
  const scaled = getScaledCanvas();
  if (!scaled) {
    throw new Error("Loop export requires a rendered output canvas.");
  }
  const ctx = scaled.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to initialize loop export canvas.");
  }
  const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);
  return {
    data: imageData.data,
    width: scaled.width,
    height: scaled.height,
    delay: quantizeGifDelay(fallbackDelayMs),
  } satisfies GifFrame;
};

export const captureLoopPlaybackFrames = async ({
  video,
  getScaledCanvas,
  waitForRenderedSeek,
  _waitForRenderedPlaybackFrame,
  _getCurrentRenderVersion,
  updateProgress,
  isAborted,
  usePlaybackCapture,
  _useVFC,
  captureFps,
  gifFps,
  rangeStartSec,
  durationSec,
  exportDurationSec,
}: CaptureLoopPlaybackFramesOptions) => {
  const capturedFrames: GifFrame[] = [];
  let aborted = false;

  const commitDelayToPreviousFrame = (delayMs: number) => {
    if (capturedFrames.length === 0) return;
    capturedFrames[capturedFrames.length - 1].delay = quantizeGifDelay(delayMs);
  };

  const captureFrame = () => {
    capturedFrames.push(captureCurrentCanvasFrame(
      getScaledCanvas,
      1000 / Math.max(1, gifFps),
    ));
  };

  if (!usePlaybackCapture) {
    return { capturedFrames, aborted };
  }

  const intervalMs = 1000 / Math.max(1, captureFps);
  const sampleCount = Math.max(1, Math.ceil(exportDurationSec * Math.max(1, captureFps)));
  const captureStartedAt = performance.now();

  for (let i = 0; i < sampleCount; i += 1) {
    if (isAborted()) {
      aborted = true;
      break;
    }
    const targetTime = Math.min(durationSec - 0.0005, rangeStartSec + (i / Math.max(1, captureFps)));
    const elapsedMs = performance.now() - captureStartedAt;
    const avgMs = i > 0 ? elapsedMs / i : 0;
    const etaMs = i > 0 ? avgMs * (sampleCount - i) : 0;
    updateProgress(
      `Capturing ${i + 1}/${sampleCount} (${targetTime.toFixed(2)}s / ${durationSec.toFixed(2)}s)${i > 0 ? ` · ETA ${formatEta(etaMs)}` : ""}`,
      0.08 + ((i + 1) / Math.max(1, sampleCount)) * 0.72,
    );
    await waitForRenderedSeek(video, targetTime, intervalMs);
    if (capturedFrames.length > 0) {
      commitDelayToPreviousFrame(intervalMs);
    }
    captureFrame();
  }

  const coveredMs = Math.max(0, (sampleCount - 1) * intervalMs);
  commitDelayToPreviousFrame(Math.max(10, exportDurationSec * 1000 - coveredMs));

  return { capturedFrames, aborted };
};
