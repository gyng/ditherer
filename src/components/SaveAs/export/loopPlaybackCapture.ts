import { formatEta, quantizeGifDelay, type GifFrame, type VideoFrameCallbackVideo, type VideoFrameMetadata } from "../helpers";

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
  waitForRenderedPlaybackFrame: (
    targetTime: number,
    previousRenderVersion: number,
    expectedFrameMs: number,
  ) => Promise<PlaybackFrameStatus | undefined>;
  getCurrentRenderVersion: () => number;
  updateProgress: (message: string, value?: number | null) => void;
  isAborted: () => boolean;
  usePlaybackCapture: boolean;
  useVFC: boolean;
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
  waitForRenderedPlaybackFrame,
  getCurrentRenderVersion,
  updateProgress,
  isAborted,
  usePlaybackCapture,
  useVFC,
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

  if (usePlaybackCapture) {
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
  }

  captureFrame();

  await new Promise<void>((resolve) => {
    let lastMediaTime = 0;
    let lastCapturedRenderedTime = rangeStartSec;
    let lastCapturedRenderVersion = getCurrentRenderVersion();
    let stopped = false;
    let handle: number | null = null;
    let stopTimeout: number | null = null;
    let capturePending = false;
    const captureStartedAt = performance.now();
    const stop = () => {
      if (!stopped) {
        stopped = true;
        if (handle != null) window.clearInterval(handle);
        if (stopTimeout != null) window.clearTimeout(stopTimeout);
        if (lastMediaTime > 0 && Number.isFinite(durationSec) && durationSec > lastMediaTime) {
          commitDelayToPreviousFrame((durationSec - lastMediaTime) * 1000);
        }
        video.pause();
        resolve();
      }
    };

    if (useVFC) {
      const onFrame = async (_now: number, metadata: VideoFrameMetadata) => {
        if (stopped) return;
        if (isAborted()) {
          aborted = true;
          stop();
          return;
        }
        const mediaTime = metadata.mediaTime;
        if (mediaTime == null) {
          if (!stopped) (video as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
          return;
        }
        if (mediaTime < lastMediaTime - 0.05 || mediaTime >= durationSec) {
          stop();
          return;
        }
        if (mediaTime <= 0.001 && lastMediaTime === 0) {
          if (!stopped) (video as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
          return;
        }
        if (lastMediaTime > 0) {
          commitDelayToPreviousFrame((mediaTime - lastMediaTime) * 1000);
        }
        lastMediaTime = mediaTime;
        const previousRenderVersion = getCurrentRenderVersion();
        const rendered = await waitForRenderedPlaybackFrame(mediaTime, previousRenderVersion, 1000 / Math.max(1, gifFps));
        if (stopped || isAborted()) {
          if (isAborted()) {
            aborted = true;
            stop();
          }
          return;
        }
        if (!rendered || rendered.renderedTime == null) {
          if (!stopped) (video as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
          return;
        }
        if (rendered.renderVersion <= lastCapturedRenderVersion || rendered.renderedTime <= lastCapturedRenderedTime + 0.0005) {
          if (!stopped) (video as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
          return;
        }
        const capturedCount = Math.max(1, capturedFrames.length);
        const elapsedMs = performance.now() - captureStartedAt;
        const avgMs = elapsedMs / capturedCount;
        const approxRemaining = Math.max(0, durationSec - mediaTime);
        const etaMs = durationSec > 0 ? avgMs * ((approxRemaining / durationSec) * Math.max(1, capturedCount)) : 0;
        const playbackProgress = exportDurationSec > 0 ? Math.min(1, Math.max(0, (mediaTime - rangeStartSec) / exportDurationSec)) : 0;
        updateProgress(
          `Capturing ${capturedFrames.length + 1} (${mediaTime.toFixed(2)}s / ${durationSec.toFixed(2)}s)${capturedFrames.length > 0 ? ` · ETA ${formatEta(etaMs)}` : ""}`,
          0.08 + playbackProgress * 0.72,
        );
        captureFrame();
        lastCapturedRenderedTime = rendered.renderedTime;
        lastCapturedRenderVersion = rendered.renderVersion;
        if (!stopped) (video as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
      };
      (video as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
    } else {
      const intervalMs = Math.round(1000 / gifFps);
      let lastTime = video.currentTime;
      handle = window.setInterval(async () => {
        if (stopped || capturePending) return;
        if (isAborted()) {
          aborted = true;
          stop();
          return;
        }
        if (video.currentTime < lastTime - 0.05 || video.currentTime >= durationSec) {
          stop();
          return;
        }
        const currentTime = video.currentTime;
        if (currentTime <= lastTime + 0.0005) return;
        commitDelayToPreviousFrame((currentTime - lastTime) * 1000);
        lastTime = currentTime;
        capturePending = true;
        const previousRenderVersion = getCurrentRenderVersion();
        const rendered = await waitForRenderedPlaybackFrame(currentTime, previousRenderVersion, intervalMs);
        capturePending = false;
        if (stopped || isAborted()) {
          if (isAborted()) {
            aborted = true;
            stop();
          }
          return;
        }
        if (!rendered || rendered.renderedTime == null) {
          return;
        }
        if (rendered.renderVersion <= lastCapturedRenderVersion || rendered.renderedTime <= lastCapturedRenderedTime + 0.0005) {
          return;
        }
        const capturedCount = Math.max(1, capturedFrames.length);
        const elapsedMs = performance.now() - captureStartedAt;
        const avgMs = elapsedMs / capturedCount;
        const approxRemaining = Math.max(0, durationSec - currentTime);
        const etaMs = durationSec > 0 ? avgMs * ((approxRemaining / durationSec) * Math.max(1, capturedCount)) : 0;
        const playbackProgress = exportDurationSec > 0 ? Math.min(1, Math.max(0, (currentTime - rangeStartSec) / exportDurationSec)) : 0;
        updateProgress(
          `Capturing ${capturedFrames.length + 1} (${video.currentTime.toFixed(2)}s / ${durationSec.toFixed(2)}s)${capturedFrames.length > 0 ? ` · ETA ${formatEta(etaMs)}` : ""}`,
          0.08 + playbackProgress * 0.72,
        );
        captureFrame();
        lastCapturedRenderedTime = rendered.renderedTime;
        lastCapturedRenderVersion = rendered.renderVersion;
      }, intervalMs);
    }

    if (rangeStartSec > 0) {
      lastMediaTime = rangeStartSec;
    }
    video.play().catch(() => {});
    stopTimeout = window.setTimeout(stop, (exportDurationSec / (video.playbackRate || 1)) * 1000 + 500);
  });

  return { capturedFrames, aborted };
};
