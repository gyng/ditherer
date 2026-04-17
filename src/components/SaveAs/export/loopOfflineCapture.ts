import { renderOfflineFrames } from "./offlineRender";
import { buildDecodedTimeline, decodeSourceFramesWithWebCodecs, decodeTimelineFramesWithWebCodecs } from "./offlineWebCodecsDecode";
import { formatEta, quantizeGifDelay, type GifFrame } from "../helpers";
import type { LoopSourcePath } from "./exportRouting";

export type LoopGifProfile = {
  path: LoopSourcePath;
  fallbackReason: string;
  decodeLoadMs: number;
  decodeConfigMs: number;
  demuxMs: number;
  decodeMs: number;
  renderMs: number;
  encodeMs: number;
  selectedFrames: number;
  decodedChunks: number;
  decodedFrames: number;
};

type RenderFrameForExport = (
  sourceCanvas: HTMLCanvasElement,
  frame: { sessionId: string; time: number; video: null },
) => Promise<HTMLCanvasElement | OffscreenCanvas | null>;

interface CaptureLoopOfflineFramesOptions {
  video: HTMLVideoElement;
  mode: "gif" | "sequence" | "contact";
  sourceWidth: number;
  sourceHeight: number;
  mult: number;
  captureFps: number;
  rangeStartSec: number;
  rangeEndSec: number;
  durationSec: number;
  loopAutoFps: boolean;
  sourceUrl: string | null;
  useWebCodecsCapture: boolean;
  updateProgress: (message: string, value?: number | null) => void;
  isAborted: () => boolean;
  createHiddenExportVideo: (video: HTMLVideoElement) => Promise<HTMLVideoElement>;
  waitForVideoSeekSettled: (
    video: HTMLVideoElement,
    targetTime: number,
    expectedFrameMs: number,
  ) => Promise<void>;
  renderFrameForExport: RenderFrameForExport;
  clearExportSession: (sessionId: string) => void;
}

export const filterDecodedFramesForRange = (
  decodedFrames: { timestampUs: number; durationUs: number; frame: VideoFrame }[],
  startSec: number,
  endSec: number,
) => {
  const startUs = Math.round(startSec * 1_000_000);
  const endUs = Math.round(endSec * 1_000_000);
  const filtered = decodedFrames.filter(({ timestampUs }) => timestampUs >= startUs && timestampUs < endUs);
  return filtered.length > 0 ? filtered : decodedFrames;
};

export const getDecodedGifFrameDurationUs = (
  decodedFrames: { timestampUs: number; durationUs: number }[],
  index: number,
  fallbackDurationUs: number,
  endSec: number,
) => {
  const current = decodedFrames[index];
  const explicitDurationUs = current.durationUs;
  const rangeEndUs = Math.round(endSec * 1_000_000);
  const rangeRemainderUs = Math.max(1, rangeEndUs - current.timestampUs);
  if (explicitDurationUs > 0) {
    return Math.min(rangeRemainderUs, explicitDurationUs);
  }

  const next = decodedFrames[index + 1];
  if (next) {
    return Math.max(1, next.timestampUs - current.timestampUs);
  }

  return Math.max(rangeRemainderUs, fallbackDurationUs);
};

export const getRenderableDecodedGifFrames = <T,>(decodedFrames: T[]) =>
  decodedFrames.length > 1 ? decodedFrames.slice(0, -1) : decodedFrames;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
};

export const inferDecodedGifCadenceUs = (
  decodedFrames: { timestampUs: number; durationUs: number }[],
  fallbackDurationUs: number,
) => {
  const durationSamples = decodedFrames
    .map((frame) => frame.durationUs)
    .filter((value) => value > 0);
  if (durationSamples.length > 0) {
    return median(durationSamples);
  }

  const deltaSamples: number[] = [];
  for (let i = 1; i < decodedFrames.length; i += 1) {
    const deltaUs = decodedFrames[i].timestampUs - decodedFrames[i - 1].timestampUs;
    if (deltaUs > 0) {
      deltaSamples.push(deltaUs);
    }
  }
  return deltaSamples.length > 0 ? median(deltaSamples) : fallbackDurationUs;
};

export const collapseDecodedFramesToCadence = (
  decodedFrames: { timestampUs: number; durationUs: number; frame: VideoFrame }[],
  fallbackDurationUs: number,
) => {
  if (decodedFrames.length <= 1) {
    return decodedFrames;
  }
  const cadenceUs = inferDecodedGifCadenceUs(decodedFrames, fallbackDurationUs);
  const minSpacingUs = Math.max(1, Math.round(cadenceUs * 0.75));
  const selected = [decodedFrames[0]];
  let lastTimestampUs = decodedFrames[0].timestampUs;
  for (let i = 1; i < decodedFrames.length; i += 1) {
    const frame = decodedFrames[i];
    if (frame.timestampUs - lastTimestampUs >= minSpacingUs) {
      selected.push(frame);
      lastTimestampUs = frame.timestampUs;
    }
  }
  const lastFrame = decodedFrames[decodedFrames.length - 1];
  if (selected[selected.length - 1] !== lastFrame) {
    selected.push(lastFrame);
  }
  return selected;
};

export const captureLoopOfflineFrames = async ({
  video,
  mode,
  sourceWidth,
  sourceHeight,
  mult,
  captureFps,
  rangeStartSec,
  rangeEndSec,
  durationSec,
  loopAutoFps,
  sourceUrl,
  useWebCodecsCapture,
  updateProgress,
  isAborted,
  createHiddenExportVideo,
  waitForVideoSeekSettled,
  renderFrameForExport,
  clearExportSession,
}: CaptureLoopOfflineFramesOptions) => {
  const capturedFrames: GifFrame[] = [];
  let aborted = false;
  const exportSessionId = crypto.randomUUID();
  const gifProfile: LoopGifProfile = {
    path: useWebCodecsCapture ? "webcodecs-demux" : "hidden-video-fallback",
    fallbackReason: "",
    decodeLoadMs: 0,
    decodeConfigMs: 0,
    demuxMs: 0,
    decodeMs: 0,
    renderMs: 0,
    encodeMs: 0,
    selectedFrames: 0,
    decodedChunks: 0,
    decodedFrames: 0,
  };

  const renderFromCanvasFrame = async (
    sourceCanvas: HTMLCanvasElement,
    scaledCanvas: HTMLCanvasElement,
    scaledCtx: CanvasRenderingContext2D,
    timeSec: number,
    durationUs: number,
  ) => {
    const rendered = await renderFrameForExport(sourceCanvas, {
      sessionId: exportSessionId,
      time: timeSec,
      video: null,
    });
    if (!rendered) {
      throw new Error(`Failed to render ${mode} export frame.`);
    }
    scaledCtx.imageSmoothingEnabled = false;
    scaledCtx.clearRect(0, 0, scaledCanvas.width, scaledCanvas.height);
    scaledCtx.drawImage(rendered, 0, 0, scaledCanvas.width, scaledCanvas.height);
    const imageData = scaledCtx.getImageData(0, 0, scaledCanvas.width, scaledCanvas.height);
    capturedFrames.push({
      data: new Uint8ClampedArray(imageData.data),
      width: scaledCanvas.width,
      height: scaledCanvas.height,
      delay: quantizeGifDelay(durationUs / 1000),
    });
  };

  try {
    let renderedViaWebCodecs = false;
    if (useWebCodecsCapture && sourceUrl) {
      let decodedFramesToClose: { frame: VideoFrame }[] = [];
      try {
        const timeline = buildDecodedTimeline(video.duration, captureFps, rangeStartSec, rangeEndSec);
        const useDecodedSourceFrames = loopAutoFps && (mode === "gif" || mode === "sequence");
        const decoded = useDecodedSourceFrames
          ? await decodeSourceFramesWithWebCodecs({
              source: sourceUrl,
              startTimeSec: rangeStartSec,
              endTimeSec: rangeEndSec,
              isAborted,
              onProgress: ({ message, fraction }) => updateProgress(message, fraction ?? 0.08),
            })
          : await decodeTimelineFramesWithWebCodecs({
              source: sourceUrl,
              timeline,
              isAborted,
              onProgress: ({ message, fraction }) => updateProgress(message, fraction ?? 0.08),
            });
        gifProfile.path = "webcodecs-demux";
        gifProfile.fallbackReason = "";
        gifProfile.decodeLoadMs = Math.round(decoded.metrics.loadMs);
        gifProfile.decodeConfigMs = Math.round(decoded.metrics.configMs);
        gifProfile.demuxMs = Math.round(decoded.metrics.demuxMs);
        gifProfile.decodeMs = Math.round(decoded.metrics.decodeMs);
        gifProfile.decodedChunks = decoded.metrics.decodedChunks;
        gifProfile.decodedFrames = decoded.frames.length;
        gifProfile.selectedFrames = decoded.frames.length;
        decodedFramesToClose = decoded.frames;

        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = decoded.width;
        sourceCanvas.height = decoded.height;
        const sourceCtx = sourceCanvas.getContext("2d");
        const scaledCanvas = document.createElement("canvas");
        scaledCanvas.width = decoded.width * mult;
        scaledCanvas.height = decoded.height * mult;
        const scaledCtx = scaledCanvas.getContext("2d");
        if (!sourceCtx || !scaledCtx) {
          throw new Error("Failed to initialize WebCodecs decode render canvases.");
        }
        const renderStartedAt = performance.now();
        const decodedSourceFrames = useDecodedSourceFrames
          ? collapseDecodedFramesToCadence(
              filterDecodedFramesForRange(decoded.frames, rangeStartSec, rangeEndSec),
              timeline[0]?.durationUs ?? Math.round(1_000_000 / Math.max(1, captureFps)),
            )
          : decoded.frames;
        const framesToRender = mode === "gif" && useDecodedSourceFrames
          ? getRenderableDecodedGifFrames(decodedSourceFrames)
          : decodedSourceFrames;

        for (let i = 0; i < framesToRender.length; i += 1) {
          if (isAborted()) {
            aborted = true;
            break;
          }
          const decodedFrame = framesToRender[i];
          const timelineFrame = timeline[Math.min(i, timeline.length - 1)];
          const frameDurationUs = useDecodedSourceFrames
            ? getDecodedGifFrameDurationUs(decodedSourceFrames, i, timelineFrame.durationUs, rangeEndSec)
            : timelineFrame.durationUs;
          const elapsedMs = performance.now() - renderStartedAt;
          const avgMs = i > 0 ? elapsedMs / i : 0;
          const etaMs = i > 0 ? avgMs * (framesToRender.length - i) : null;
          updateProgress(
            `Rendering ${i + 1}/${framesToRender.length} (${(decodedFrame.timestampUs / 1_000_000).toFixed(2)}s / ${durationSec.toFixed(2)}s)${etaMs ? ` · ETA ${formatEta(etaMs)}` : ""}`,
            0.08 + ((i + 1) / Math.max(1, framesToRender.length)) * 0.72,
          );
          sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
          sourceCtx.drawImage(decodedFrame.frame, 0, 0, sourceCanvas.width, sourceCanvas.height);
          renderFromCanvasFrame(
            sourceCanvas,
            scaledCanvas,
            scaledCtx,
            decodedFrame.timestampUs / 1_000_000,
            frameDurationUs,
          );
        }
        gifProfile.renderMs = Math.round(performance.now() - renderStartedAt);
        gifProfile.selectedFrames = framesToRender.length;
        renderedViaWebCodecs = true;
      } catch (error) {
        gifProfile.fallbackReason = error instanceof Error ? error.message : String(error);
        console.warn(`WebCodecs demux ${mode.toUpperCase()} path failed, falling back to hidden export video:`, error);
      } finally {
        decodedFramesToClose.forEach(({ frame }) => frame.close());
      }
    } else if (useWebCodecsCapture && !sourceUrl) {
      gifProfile.fallbackReason = "No source URL available for WebCodecs demux.";
    } else if (useWebCodecsCapture) {
      gifProfile.fallbackReason = "WebCodecs VideoDecoder is unavailable in this browser.";
    }

    if (!renderedViaWebCodecs) {
      if (useWebCodecsCapture && !gifProfile.fallbackReason) {
        gifProfile.fallbackReason = "WebCodecs demux fell back to hidden export video.";
      }
      gifProfile.path = "hidden-video-fallback";
      const exportVideo = await createHiddenExportVideo(video);
      try {
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = exportVideo.videoWidth || sourceWidth;
        sourceCanvas.height = exportVideo.videoHeight || sourceHeight;
        const sourceCtx = sourceCanvas.getContext("2d");
        const scaledCanvas = document.createElement("canvas");
        scaledCanvas.width = sourceCanvas.width * mult;
        scaledCanvas.height = sourceCanvas.height * mult;
        const scaledCtx = scaledCanvas.getContext("2d");
        if (!sourceCtx || !scaledCtx) {
          throw new Error("Failed to initialize hidden export video canvases.");
        }
        const renderStartedAt = performance.now();

        const renderResult = await renderOfflineFrames({
          video: exportVideo,
          fps: captureFps,
          startTimeSec: rangeStartSec,
          endTimeSec: rangeEndSec,
          waitForFrame: waitForVideoSeekSettled,
          getFrameCanvas: async (frame) => {
            sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
            sourceCtx.drawImage(exportVideo, 0, 0, sourceCanvas.width, sourceCanvas.height);
            const rendered = await renderFrameForExport(sourceCanvas, {
              sessionId: exportSessionId,
              time: frame.timeSec,
              video: null,
            });
            if (!rendered) {
              throw new Error(`Failed to render ${mode} export frame.`);
            }
            scaledCtx.imageSmoothingEnabled = false;
            scaledCtx.clearRect(0, 0, scaledCanvas.width, scaledCanvas.height);
            scaledCtx.drawImage(rendered, 0, 0, scaledCanvas.width, scaledCanvas.height);
            return scaledCanvas;
          },
          isAborted,
          onProgress: ({ frameIndex, frameCount, targetTime, etaMs }) => {
            updateProgress(
              `Rendering ${frameIndex + 1}/${frameCount} (${targetTime.toFixed(2)}s / ${durationSec.toFixed(2)}s)${etaMs ? ` · ETA ${formatEta(etaMs)}` : ""}`,
              0.08 + ((frameIndex + 1) / Math.max(1, frameCount)) * 0.72,
            );
          },
          onFrame: (frame) => {
            capturedFrames.push({
              data: new Uint8ClampedArray(frame.pixels),
              width: frame.width,
              height: frame.height,
              delay: quantizeGifDelay(frame.durationUs / 1000),
            });
          },
        });

        aborted = renderResult.aborted;
        gifProfile.renderMs = Math.round(performance.now() - renderStartedAt);
        gifProfile.selectedFrames = capturedFrames.length;
      } finally {
        exportVideo.pause();
        exportVideo.removeAttribute("src");
        exportVideo.load();
      }
    }
  } finally {
    clearExportSession(exportSessionId);
  }

  return { capturedFrames, aborted, gifProfile, exportSessionId };
};
