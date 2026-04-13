import { renderOfflineFrames } from "./offlineRender";
import { buildDecodedTimeline, decodeTimelineFramesWithWebCodecs } from "./offlineWebCodecsDecode";
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
) => HTMLCanvasElement | OffscreenCanvas | null;

interface CaptureLoopOfflineFramesOptions {
  video: HTMLVideoElement;
  mode: "gif" | "sequence";
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
  loopAutoFps: _loopAutoFps,
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

  const renderFromCanvasFrame = (
    sourceCanvas: HTMLCanvasElement,
    scaledCanvas: HTMLCanvasElement,
    scaledCtx: CanvasRenderingContext2D,
    timeSec: number,
    durationUs: number,
  ) => {
    const rendered = renderFrameForExport(sourceCanvas, {
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
        const decoded = await decodeTimelineFramesWithWebCodecs({
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
        const framesToRender = decoded.frames;

        for (let i = 0; i < framesToRender.length; i += 1) {
          if (isAborted()) {
            aborted = true;
            break;
          }
          const decodedFrame = framesToRender[i];
          const timelineFrame = timeline[Math.min(i, timeline.length - 1)];
          const frameDurationUs = timelineFrame.durationUs;
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
            const rendered = renderFrameForExport(sourceCanvas, {
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
