import { planLoopCaptureRouting } from "./exportRouting";
import { finalizeGifExport, finalizeSequenceExport } from "./finalizeFrameExports";
import { captureLoopOfflineFrames, type LoopGifProfile } from "./loopOfflineCapture";
import { captureLoopPlaybackFrames } from "./loopPlaybackCapture";
import type { GifFrame, SourceVideoWithObjectUrl } from "../helpers";

type PlaybackFrameStatus = {
  renderedTime: number | null;
  renderVersion: number;
  frameToken: number;
};

type RenderFrameForExport = (
  sourceCanvas: HTMLCanvasElement,
  frame: { sessionId: string; time: number; video: null },
) => HTMLCanvasElement | OffscreenCanvas | null;

interface RunLoopExportOptions {
  mode: "gif" | "sequence";
  video: HTMLVideoElement;
  sourceCanvas: HTMLCanvasElement;
  mult: number;
  loopExportScope: "loop" | "range";
  loopRangeStart: number;
  loopRangeEnd: number;
  loopAutoFps: boolean;
  gifFps: number;
  loopCaptureMode: "realtime" | "offline" | "webcodecs";
  gifPaletteSource: "auto" | "filter";
  gifFilterPalette: number[][] | null;
  estimateVideoFps: (video: HTMLVideoElement, fallback: number) => number;
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
  waitForVideoSeekSettled: (
    video: HTMLVideoElement,
    targetTime: number,
    expectedFrameMs: number,
  ) => Promise<void>;
  getCurrentRenderVersion: () => number;
  updateProgress: (message: string, value?: number | null) => void;
  clearProgress: () => void;
  isAborted: () => boolean;
  clearGifResult: () => void;
  clearSequenceResult: () => void;
  setGifResult: (blob: Blob, label: string) => void;
  setSequenceResult: (blob: Blob) => void;
  createHiddenExportVideo: (video: HTMLVideoElement) => Promise<HTMLVideoElement>;
  renderFrameForExport: RenderFrameForExport;
  clearExportSession: (sessionId: string) => void;
  logGifExportProfile: (label: string, stats: Record<string, number | string | boolean | null>) => void;
}

export const runLoopExport = async ({
  mode,
  video,
  sourceCanvas,
  mult,
  loopExportScope,
  loopRangeStart,
  loopRangeEnd,
  loopAutoFps,
  gifFps,
  loopCaptureMode,
  gifPaletteSource,
  gifFilterPalette,
  estimateVideoFps,
  getScaledCanvas,
  waitForRenderedSeek,
  waitForRenderedPlaybackFrame,
  waitForVideoSeekSettled,
  getCurrentRenderVersion,
  updateProgress,
  clearProgress,
  isAborted,
  clearGifResult,
  clearSequenceResult,
  setGifResult,
  setSequenceResult,
  createHiddenExportVideo,
  renderFrameForExport,
  clearExportSession,
  logGifExportProfile,
}: RunLoopExportOptions) => {
  const rangeStartSec = loopExportScope === "range"
    ? Math.max(0, Math.min(video.duration, loopRangeStart))
    : 0;
  const rangeEndSec = loopExportScope === "range"
    ? Math.max(rangeStartSec + 0.001, Math.min(video.duration, loopRangeEnd))
    : video.duration;
  const exportDuration = Math.max(0.001, rangeEndSec - rangeStartSec);

  updateProgress(loopExportScope === "range" ? `Seeking start (${rangeStartSec.toFixed(2)}s)...` : "Rewinding...", 0.04);
  if (mode === "gif") {
    clearGifResult();
  } else {
    clearSequenceResult();
  }

  video.pause();
  if (Math.abs((video.currentTime || 0) - rangeStartSec) > 0.0005) {
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = rangeStartSec;
    });
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const capturedFrames: GifFrame[] = [];
  const duration = rangeEndSec;
  const captureFps = loopAutoFps ? estimateVideoFps(video, gifFps) : gifFps;
  const sourceUrl = (video as SourceVideoWithObjectUrl).__objectUrl || video.currentSrc || video.src;
  const loopRoutingPlan = planLoopCaptureRouting({
    captureMode: loopCaptureMode,
    sourceUrl: sourceUrl || null,
    hasVideoDecoder: typeof VideoDecoder !== "undefined",
  });
  const usePlaybackCapture = loopRoutingPlan.usesPlaybackCapture;
  const useWebCodecsCapture = loopRoutingPlan.shouldAttemptWebCodecs;
  const useVFC = usePlaybackCapture && loopAutoFps && "requestVideoFrameCallback" in video;
  let aborted = false;
  const gifProfile: LoopGifProfile | null = mode === "gif" ? {
    path: loopRoutingPlan.path,
    fallbackReason: loopRoutingPlan.fallbackReason || "",
    decodeLoadMs: 0,
    decodeConfigMs: 0,
    demuxMs: 0,
    decodeMs: 0,
    renderMs: 0,
    encodeMs: 0,
    selectedFrames: 0,
    decodedChunks: 0,
    decodedFrames: 0,
  } : null;

  if (!usePlaybackCapture) {
    const offlineResult = await captureLoopOfflineFrames({
      video,
      mode,
      sourceWidth: sourceCanvas.width,
      sourceHeight: sourceCanvas.height,
      mult,
      captureFps,
      rangeStartSec,
      rangeEndSec,
      durationSec: duration,
      loopAutoFps,
      sourceUrl: sourceUrl || null,
      useWebCodecsCapture,
      updateProgress,
      isAborted,
      createHiddenExportVideo,
      waitForVideoSeekSettled,
      renderFrameForExport,
      clearExportSession,
    });
    capturedFrames.push(...offlineResult.capturedFrames);
    aborted = offlineResult.aborted;
    if (gifProfile) {
      gifProfile.path = offlineResult.gifProfile.path;
      gifProfile.fallbackReason = offlineResult.gifProfile.fallbackReason;
      gifProfile.decodeLoadMs = offlineResult.gifProfile.decodeLoadMs;
      gifProfile.decodeConfigMs = offlineResult.gifProfile.decodeConfigMs;
      gifProfile.demuxMs = offlineResult.gifProfile.demuxMs;
      gifProfile.decodeMs = offlineResult.gifProfile.decodeMs;
      gifProfile.renderMs = offlineResult.gifProfile.renderMs;
      gifProfile.selectedFrames = offlineResult.gifProfile.selectedFrames;
      gifProfile.decodedChunks = offlineResult.gifProfile.decodedChunks;
      gifProfile.decodedFrames = offlineResult.gifProfile.decodedFrames;
    }
  }

  const playbackResult = await captureLoopPlaybackFrames({
    video,
    getScaledCanvas,
    waitForRenderedSeek,
    _waitForRenderedPlaybackFrame: waitForRenderedPlaybackFrame,
    _getCurrentRenderVersion: getCurrentRenderVersion,
    updateProgress,
    isAborted,
    usePlaybackCapture,
    _useVFC: useVFC,
    captureFps,
    gifFps,
    rangeStartSec,
    durationSec: duration,
    exportDurationSec: exportDuration,
  });
  capturedFrames.push(...playbackResult.capturedFrames);
  aborted = aborted || playbackResult.aborted;

  if (capturedFrames.length === 0) {
    clearProgress();
    return;
  }

  if (mode === "gif") {
    const colorTable = gifPaletteSource === "filter" ? gifFilterPalette : null;
    await finalizeGifExport({
      frames: capturedFrames,
      aborted,
      colorTable,
      capturedFrameCount: capturedFrames.length,
      updateProgress,
      setGifResult,
      onEncoded: ({ normalizedFrameCount, encodeMs }) => {
        if (!gifProfile) return;
        gifProfile.encodeMs = encodeMs;
        logGifExportProfile("completed", {
          path: gifProfile.path,
          ...(gifProfile.fallbackReason ? { fallbackReason: gifProfile.fallbackReason } : {}),
          fps: captureFps,
          selectedFrames: gifProfile.selectedFrames || capturedFrames.length,
          normalizedFrames: normalizedFrameCount,
          decodedChunks: gifProfile.decodedChunks,
          decodedFrames: gifProfile.decodedFrames,
          decodeLoadMs: gifProfile.decodeLoadMs,
          decodeConfigMs: gifProfile.decodeConfigMs,
          demuxMs: gifProfile.demuxMs,
          decodeMs: gifProfile.decodeMs,
          renderMs: gifProfile.renderMs,
          encodeMs: gifProfile.encodeMs,
          aborted,
          captureMode: loopCaptureMode,
        });
      },
    });
  } else if (!isAborted()) {
    await finalizeSequenceExport({
      frames: capturedFrames,
      updateProgress,
      setSequenceResult,
    });
  }

  clearProgress();
};
