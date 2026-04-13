import { renderOfflineFrames } from "./offlineRender";
import { buildDecodedTimeline, decodeTimelineFramesWithWebCodecs } from "./offlineWebCodecsDecode";
import { createOfflineVideoEncoder, getReliableVideoSupport } from "./offlineVideoEncode";
import { formatEta, type SourceVideoWithObjectUrl } from "../helpers";
import { planReliableVideoRouting, type ReliableSourcePath, type ReliableVideoMode } from "./exportRouting";

type RenderFrameForExport = (
  sourceCanvas: HTMLCanvasElement,
  frame: { sessionId: string; time: number; video: null },
) => HTMLCanvasElement | OffscreenCanvas | null;

type ReliableRenderMetrics = {
  seekMs: number;
  captureMs: number;
  encodeMs: number;
};

type ReliableRenderResult = {
  aborted: boolean;
  frameCount: number;
  metrics: ReliableRenderMetrics;
  sourcePath: ReliableSourcePath;
  fallbackReason?: string;
};

type ReliableRenderOutcome = {
  blob: Blob | null;
  aborted: boolean;
  audioIncluded: boolean;
  audioUnavailableReason: string | null;
  renderResult: ReliableRenderResult | null;
  finalizeMetrics: {
    audioPrepareMs: number;
    finalizeMs: number;
  } | null;
};

interface RunReliableVideoExportOptions {
  video: HTMLVideoElement;
  preferredMode: ReliableVideoMode;
  includeAudio: boolean;
  reliableFps: number;
  sourceEstimatedFps: number;
  reliableMaxFps: number;
  rangeStartSec: number;
  rangeEndSec: number;
  exportDurationSec: number;
  reliableScope: "loop" | "range";
  reliableStrictValidation: boolean;
  reliableSettleFrames: number;
  getScaledCanvas: () => HTMLCanvasElement | null;
  waitForRenderedSeek: (
    video: HTMLVideoElement,
    targetTime: number,
    expectedFrameMs: number,
    strictValidation?: boolean,
    settleFrames?: number,
  ) => Promise<void>;
  updateProgress: (message: string, value?: number | null) => void;
  isAborted: () => boolean;
  renderFrameForExport: RenderFrameForExport;
  clearExportSession: (sessionId: string) => void;
  logReliableRenderProfile: (label: string, stats: Record<string, number | string | boolean | null>) => void;
}

export const runReliableVideoExport = async ({
  video,
  preferredMode,
  includeAudio,
  reliableFps,
  sourceEstimatedFps,
  reliableMaxFps,
  rangeStartSec,
  rangeEndSec,
  exportDurationSec,
  reliableScope,
  reliableStrictValidation,
  reliableSettleFrames,
  getScaledCanvas,
  waitForRenderedSeek,
  updateProgress,
  isAborted,
  renderFrameForExport,
  clearExportSession,
  logReliableRenderProfile,
}: RunReliableVideoExportOptions): Promise<ReliableRenderOutcome> => {
  const scaled = getScaledCanvas();
  if (!scaled) {
    throw new Error("Reliable export requires a rendered output canvas.");
  }

  const support = await getReliableVideoSupport(scaled.width, scaled.height, reliableFps, includeAudio);
  if (!support.supported) {
    throw new Error(support.reason || "Reliable offline video export is unavailable in this browser.");
  }

  const estimatedFrameCount = Math.max(1, Math.ceil(exportDurationSec * Math.max(1, reliableFps)));
  updateProgress(
    `Preparing reliable offline render (${estimatedFrameCount} frames at ${reliableFps} fps${reliableScope === "range" ? `, ${rangeStartSec.toFixed(2)}s-${rangeEndSec.toFixed(2)}s` : ""})...`,
    0.04,
  );

  const encoder = await createOfflineVideoEncoder({
    width: scaled.width,
    height: scaled.height,
    fps: reliableFps,
    durationUs: Math.round(exportDurationSec * 1_000_000),
    sourceVideo: video,
    includeAudio,
    isAborted,
    onProgress: (message: string) => updateProgress(message, 0.92),
  });

  try {
    let renderResult: ReliableRenderResult;
    const sourceUrl = (video as SourceVideoWithObjectUrl).__objectUrl || video.currentSrc || video.src;
    const routingPlan = planReliableVideoRouting({
      preferredMode,
      sourceUrl: sourceUrl || null,
      hasVideoDecoder: typeof VideoDecoder !== "undefined",
    });

    if (routingPlan.shouldAttemptWebCodecs) {
      const exportSessionId = crypto.randomUUID();
      try {
        const timeline = buildDecodedTimeline(video.duration, reliableFps, rangeStartSec, rangeEndSec);
        const decodeStartedAt = performance.now();
        const decoded = await decodeTimelineFramesWithWebCodecs({
          source: sourceUrl,
          timeline,
          isAborted,
          onProgress: ({ message, fraction }) => updateProgress(message, fraction ?? 0.08),
        });
        const seekMs = performance.now() - decodeStartedAt;
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = decoded.width;
        sourceCanvas.height = decoded.height;
        const sourceCtx = sourceCanvas.getContext("2d");
        const scaledCanvas = document.createElement("canvas");
        scaledCanvas.width = scaled.width;
        scaledCanvas.height = scaled.height;
        const scaledCtx = scaledCanvas.getContext("2d");
        if (!sourceCtx || !scaledCtx) {
          throw new Error("Failed to initialize reliable WebCodecs source canvases.");
        }

        const captureStartedAt = performance.now();
        for (let i = 0; i < decoded.frames.length; i += 1) {
          if (isAborted()) break;
          const timelineFrame = timeline[i];
          const decodedFrame = decoded.frames[i];
          updateProgress(
            `Rendering frame ${i + 1}/${decoded.frames.length} (${timelineFrame.timeSec.toFixed(2)}s / ${rangeEndSec.toFixed(2)}s)`,
            0.1 + ((i + 1) / Math.max(1, decoded.frames.length)) * 0.76,
          );
          sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
          sourceCtx.drawImage(decodedFrame.frame, 0, 0, sourceCanvas.width, sourceCanvas.height);
          const rendered = renderFrameForExport(sourceCanvas, {
            sessionId: exportSessionId,
            time: timelineFrame.timeSec,
            video: null,
          });
          if (!rendered) {
            throw new Error("Failed to render reliable WebCodecs frame.");
          }
          scaledCtx.imageSmoothingEnabled = false;
          scaledCtx.clearRect(0, 0, scaledCanvas.width, scaledCanvas.height);
          scaledCtx.drawImage(rendered, 0, 0, scaledCanvas.width, scaledCanvas.height);
          const imageData = scaledCtx.getImageData(0, 0, scaledCanvas.width, scaledCanvas.height);
          await encoder.addFrame({
            pixels: imageData.data,
            width: scaledCanvas.width,
            height: scaledCanvas.height,
            timestampUs: timelineFrame.timestampUs,
            durationUs: timelineFrame.durationUs,
            timeSec: timelineFrame.timeSec,
          });
        }
        const captureMs = performance.now() - captureStartedAt;
        decoded.frames.forEach(({ frame }) => frame.close());
        renderResult = {
          aborted: isAborted(),
          frameCount: decoded.frames.length,
          metrics: { seekMs: Math.round(seekMs), captureMs: Math.round(captureMs), encodeMs: 0 },
          sourcePath: "webcodecs",
        };
      } catch (error) {
        console.warn("Reliable WebCodecs source path failed, falling back to browser seek:", error);
        const fallbackReason = error instanceof Error ? error.message : String(error);
        const fallbackRenderResult = await renderOfflineFrames({
          video,
          fps: reliableFps,
          startTimeSec: rangeStartSec,
          endTimeSec: rangeEndSec,
          getFrameCanvas: getScaledCanvas,
          waitForFrame: (currentVideo, time, frameMs) =>
            waitForRenderedSeek(currentVideo, time, frameMs, reliableStrictValidation, reliableSettleFrames),
          isAborted,
          onProgress: ({ phase, frameIndex, frameCount, targetTime, etaMs }) => {
            if (phase === "rewind") {
              updateProgress(reliableScope === "range" ? `Seeking start (${rangeStartSec.toFixed(2)}s)...` : "Rewinding...", 0.08);
              return;
            }
            const label = phase === "seek" ? "Seeking" : "Capturing";
            const frameProgress = frameCount > 0 ? (frameIndex + 1) / frameCount : 0;
            updateProgress(
              `${label} frame ${frameIndex + 1}/${frameCount} (${targetTime.toFixed(2)}s / ${rangeEndSec.toFixed(2)}s)${etaMs ? ` · ETA ${formatEta(etaMs)}` : ""}`,
              0.1 + frameProgress * 0.76,
            );
          },
          onFrame: (frame) => encoder.addFrame(frame),
        });
        renderResult = {
          ...fallbackRenderResult,
          sourcePath: "browser-seek",
          fallbackReason,
        };
      } finally {
        clearExportSession(exportSessionId);
      }
    } else {
      const fallbackRenderResult = await renderOfflineFrames({
        video,
        fps: reliableFps,
        startTimeSec: rangeStartSec,
        endTimeSec: rangeEndSec,
        getFrameCanvas: getScaledCanvas,
        waitForFrame: (currentVideo, time, frameMs) =>
          waitForRenderedSeek(currentVideo, time, frameMs, reliableStrictValidation, reliableSettleFrames),
        isAborted,
        onProgress: ({ phase, frameIndex, frameCount, targetTime, etaMs }) => {
          if (phase === "rewind") {
            updateProgress(reliableScope === "range" ? `Seeking start (${rangeStartSec.toFixed(2)}s)...` : "Rewinding...", 0.08);
            return;
          }
          const label = phase === "seek" ? "Seeking" : "Capturing";
          const frameProgress = frameCount > 0 ? (frameIndex + 1) / frameCount : 0;
          updateProgress(
            `${label} frame ${frameIndex + 1}/${frameCount} (${targetTime.toFixed(2)}s / ${rangeEndSec.toFixed(2)}s)${etaMs ? ` · ETA ${formatEta(etaMs)}` : ""}`,
            0.1 + frameProgress * 0.76,
          );
        },
        onFrame: (frame) => encoder.addFrame(frame),
      });
      renderResult = {
        ...fallbackRenderResult,
        sourcePath: "browser-seek",
        ...(routingPlan.fallbackReason ? { fallbackReason: routingPlan.fallbackReason } : {}),
      };
    }

    if (renderResult.aborted || isAborted()) {
      if (renderResult.frameCount === 0) {
        encoder.dispose();
        logReliableRenderProfile("aborted-before-first-frame", {
          sourceDecode: preferredMode,
          sourcePath: renderResult.sourcePath,
          fallbackReason: renderResult.fallbackReason || null,
          fps: reliableFps,
          strictValidation: reliableStrictValidation,
          settleFrames: reliableSettleFrames,
          scope: reliableScope,
          seekMs: Math.round(renderResult.metrics.seekMs),
          captureMs: Math.round(renderResult.metrics.captureMs),
          encodeMs: Math.round(renderResult.metrics.encodeMs),
          frames: renderResult.frameCount,
        });
        return {
          blob: null,
          aborted: true,
          audioIncluded: encoder.audioIncluded,
          audioUnavailableReason: encoder.audioUnavailableReason,
          renderResult,
          finalizeMetrics: null,
        };
      }
      updateProgress("Finalizing partial preview...", 0.97);
      const finalized = await encoder.finalize();
      logReliableRenderProfile("aborted-partial", {
        sourceDecode: preferredMode,
        sourcePath: renderResult.sourcePath,
        fallbackReason: renderResult.fallbackReason || null,
        fps: reliableFps,
        strictValidation: reliableStrictValidation,
        settleFrames: reliableSettleFrames,
        scope: reliableScope,
        seekMs: Math.round(renderResult.metrics.seekMs),
        captureMs: Math.round(renderResult.metrics.captureMs),
        encodeMs: Math.round(renderResult.metrics.encodeMs),
        audioPrepareMs: Math.round(finalized.metrics.audioPrepareMs),
        finalizeMs: Math.round(finalized.metrics.finalizeMs),
        frames: renderResult.frameCount,
      });
      return {
        blob: finalized.blob,
        aborted: true,
        audioIncluded: encoder.audioIncluded,
        audioUnavailableReason: encoder.audioUnavailableReason,
        renderResult,
        finalizeMetrics: finalized.metrics,
      };
    }

    updateProgress(encoder.audioIncluded ? "Encoding video + audio..." : "Encoding video...", 0.92);
    const finalized = await encoder.finalize();
    logReliableRenderProfile("completed", {
      sourceDecode: preferredMode,
      sourcePath: renderResult.sourcePath,
      fallbackReason: renderResult.fallbackReason || null,
      fps: reliableFps,
      sourceEstimatedFps,
      reliableMaxFps,
      strictValidation: reliableStrictValidation,
      settleFrames: reliableSettleFrames,
      scope: reliableScope,
      rangeStartSec: Math.round(rangeStartSec * 1000) / 1000,
      rangeEndSec: Math.round(rangeEndSec * 1000) / 1000,
      seekMs: Math.round(renderResult.metrics.seekMs),
      captureMs: Math.round(renderResult.metrics.captureMs),
      encodeMs: Math.round(renderResult.metrics.encodeMs),
      audioPrepareMs: Math.round(finalized.metrics.audioPrepareMs),
      finalizeMs: Math.round(finalized.metrics.finalizeMs),
      frames: renderResult.frameCount,
      audioIncluded: encoder.audioIncluded,
      audioUnavailableReason: encoder.audioUnavailableReason,
    });
    return {
      blob: finalized.blob,
      aborted: false,
      audioIncluded: encoder.audioIncluded,
      audioUnavailableReason: encoder.audioUnavailableReason,
      renderResult,
      finalizeMetrics: finalized.metrics,
    };
  } catch (error) {
    encoder.dispose();
    throw error;
  }
};
