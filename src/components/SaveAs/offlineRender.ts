export type OfflineRenderPhase = "rewind" | "seek" | "capture";

export type OfflineRenderProgress = {
  phase: OfflineRenderPhase;
  frameIndex: number;
  frameCount: number;
  targetTime: number;
  etaMs: number | null;
};

export type OfflineFrameSample = {
  index: number;
  timestampUs: number;
  durationUs: number;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export type OfflineTimelineFrame = {
  index: number;
  timeSec: number;
  timestampUs: number;
  durationUs: number;
};

export type OfflineRenderMetrics = {
  seekMs: number;
  captureMs: number;
  encodeMs: number;
};

type RenderOfflineFramesArgs = {
  video: HTMLVideoElement;
  fps: number;
  startTimeSec?: number;
  endTimeSec?: number;
  getFrameCanvas: (frame: OfflineTimelineFrame) => Promise<HTMLCanvasElement | null> | HTMLCanvasElement | null;
  waitForFrame: (video: HTMLVideoElement, targetTime: number, expectedFrameMs: number) => Promise<void>;
  onFrame: (frame: OfflineFrameSample) => Promise<void> | void;
  onProgress?: (progress: OfflineRenderProgress) => void;
  isAborted?: () => boolean;
};

const FRAME_END_EPSILON_SEC = 0.0005;

export const buildOfflineTimeline = (durationSec: number, fps: number, startTimeSec = 0, endTimeSec = durationSec): OfflineTimelineFrame[] => {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Offline export requires a finite positive duration.");
  }
  const clampedStartSec = Math.max(0, Math.min(durationSec, startTimeSec || 0));
  const clampedEndSec = Math.max(clampedStartSec + FRAME_END_EPSILON_SEC, Math.min(durationSec, endTimeSec || durationSec));
  const exportDurationSec = clampedEndSec - clampedStartSec;
  if (!Number.isFinite(exportDurationSec) || exportDurationSec <= 0) {
    throw new Error("Offline export requires a positive time range.");
  }

  const safeFps = Math.max(1, Math.round(fps || 0));
  const frameDurationSec = 1 / safeFps;
  const frameCount = Math.max(1, Math.ceil(exportDurationSec * safeFps));
  const frames: OfflineTimelineFrame[] = [];

  for (let index = 0; index < frameCount; index += 1) {
    const nominalTimeSec = index * frameDurationSec;
    const targetTimeSec = Math.min(
      Math.max(clampedStartSec, clampedEndSec - Math.min(FRAME_END_EPSILON_SEC, frameDurationSec * 0.5)),
      clampedStartSec + nominalTimeSec
    );
    const remainingSec = Math.max(0, clampedEndSec - (clampedStartSec + nominalTimeSec));
    const durationForFrameSec = index === frameCount - 1
      ? Math.max(remainingSec || frameDurationSec, FRAME_END_EPSILON_SEC)
      : frameDurationSec;

    frames.push({
      index,
      timeSec: targetTimeSec,
      timestampUs: Math.round(nominalTimeSec * 1_000_000),
      durationUs: Math.max(1, Math.round(durationForFrameSec * 1_000_000)),
    });
  }

  return frames;
};

export const renderOfflineFrames = async ({
  video,
  fps,
  startTimeSec = 0,
  endTimeSec = video.duration,
  getFrameCanvas,
  waitForFrame,
  onFrame,
  onProgress,
  isAborted,
}: RenderOfflineFramesArgs): Promise<{ frameCount: number; durationSec: number; aborted: boolean; metrics: OfflineRenderMetrics }> => {
  const sourceDurationSec = video.duration;
  const timeline = buildOfflineTimeline(sourceDurationSec, fps, startTimeSec, endTimeSec);
  const durationSec = Math.max(FRAME_END_EPSILON_SEC, Math.min(sourceDurationSec, endTimeSec) - Math.max(0, startTimeSec));
  const captureStartedAt = performance.now();
  const metrics: OfflineRenderMetrics = {
    seekMs: 0,
    captureMs: 0,
    encodeMs: 0,
  };

  onProgress?.({
    phase: "rewind",
    frameIndex: 0,
    frameCount: timeline.length,
    targetTime: startTimeSec,
    etaMs: null,
  });

  video.pause();
  if (Math.abs((video.currentTime || 0) - startTimeSec) > 0.0005) {
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = startTimeSec;
    });
  }

  const expectedFrameMs = 1000 / Math.max(1, Math.round(fps || 0));

  for (const frame of timeline) {
    if (isAborted?.()) {
      return { frameCount: frame.index, durationSec, aborted: true, metrics };
    }

    const elapsedMs = performance.now() - captureStartedAt;
    const avgMs = frame.index > 0 ? elapsedMs / frame.index : 0;
    const etaMs = frame.index > 0 ? avgMs * (timeline.length - frame.index) : null;

    onProgress?.({
      phase: "seek",
      frameIndex: frame.index,
      frameCount: timeline.length,
      targetTime: frame.timeSec,
      etaMs,
    });

    const seekStartedAt = performance.now();
    await waitForFrame(video, frame.timeSec, expectedFrameMs);
    metrics.seekMs += performance.now() - seekStartedAt;

    if (isAborted?.()) {
      return { frameCount: frame.index, durationSec, aborted: true, metrics };
    }

    onProgress?.({
      phase: "capture",
      frameIndex: frame.index,
      frameCount: timeline.length,
      targetTime: frame.timeSec,
      etaMs,
    });

    const canvas = await getFrameCanvas(frame);
    if (!canvas) {
      throw new Error("Failed to capture export frame canvas.");
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to read export frame pixels.");
    }
    const captureStageStartedAt = performance.now();
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    metrics.captureMs += performance.now() - captureStageStartedAt;

    const encodeStartedAt = performance.now();
    await onFrame({
      index: frame.index,
      timestampUs: frame.timestampUs,
      durationUs: frame.durationUs,
      width: canvas.width,
      height: canvas.height,
      pixels: imageData.data,
    });
    metrics.encodeMs += performance.now() - encodeStartedAt;
  }

  return { frameCount: timeline.length, durationSec, aborted: false, metrics };
};
