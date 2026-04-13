import { useCallback, type RefObject } from "react";
import { runCurrentFrameContactSheetExport, runCurrentFrameGifExport, runCurrentFrameSequenceExport } from "../export/currentFrameExport";
import { runLoopExport } from "../export/loopExportOrchestrator";
import { copyBlobWithFeedback, saveBlob } from "../export/blobActions";
import { startCanvasRecording, startRealtimeLoopRecording } from "../export/realtimeVideoRecording";
import { runReliableVideoExport } from "../export/reliableVideoExport";
import type { FilterActions } from "context/filterContextValue";
import type { RecordingFormat, VideoFrameCallbackVideo } from "../helpers";

type ExportProgressLogger = (label: string, stats: Record<string, number | string | boolean | null>) => void;

type RenderedSeekFn = (
  video: HTMLVideoElement,
  targetTime: number,
  expectedFrameMs: number,
) => Promise<void>;

type RenderedPlaybackFrameFn = (
  targetTime: number,
  previousRenderVersion: number,
  expectedFrameMs: number,
) => Promise<{
  renderedTime: number | null;
  renderVersion: number;
  frameToken: number;
} | undefined>;

interface UseSaveAsExportHandlersOptions {
  outputCanvasRef: RefObject<HTMLCanvasElement | null>;
  stateVideo: HTMLVideoElement | null;
  actions: Pick<FilterActions, "renderFrameForExport" | "clearExportSession">;
  capturing: boolean;
  exporting: boolean;
  format: string;
  quality: number;
  includeVideoAudio: boolean;
  activeRecFormat: RecordingFormat | null;
  bitrate: number;
  autoBitrate: boolean;
  autoRecordFps: boolean;
  recordFps: number;
  videoLoopMode: "realtime" | "offline" | "webcodecs";
  reliableStrictValidation: boolean;
  reliableMaxFps: number;
  reliableSettleFrames: number;
  reliableScope: "loop" | "range";
  reliableRangeStart: number;
  reliableRangeEnd: number;
  frames: number;
  gifFps: number;
  gifPaletteSource: "auto" | "filter";
  gifFilterPalette: number[][] | null;
  loopAutoFps: boolean;
  loopCaptureMode: "realtime" | "offline" | "webcodecs";
  loopExportScope: "loop" | "range";
  loopRangeStart: number;
  loopRangeEnd: number;
  contactColumns: number;
  mult: number;
  videoFormat: string;
  mediaRecorderRef: RefObject<MediaRecorder | null>;
  streamRef: RefObject<MediaStream | null>;
  chunksRef: RefObject<BlobPart[]>;
  timerRef: RefObject<number | null>;
  exportAbortRef: RefObject<boolean>;
  renderVersionRef: RefObject<number>;
  recordedBlob: Blob | null;
  gifBlob: Blob | null;
  sequenceBlob: Blob | null;
  contactSheetBlob: Blob | null;
  clearRecordedResult: () => void;
  setRecordedResult: (blob: Blob) => void;
  clearGifResult: () => void;
  setGifResult: (blob: Blob, label: string) => void;
  clearSequenceResult: () => void;
  setSequenceResult: (blob: Blob) => void;
  clearContactSheetResult: () => void;
  setContactSheetResult: (blob: Blob) => void;
  setCopySuccess: (value: boolean) => void;
  setCapturing: (value: boolean) => void;
  setRecordingTime: (value: number | ((previous: number) => number)) => void;
  setExporting: (value: boolean) => void;
  updateProgress: (message: string | null, value?: number | null) => void;
  clearProgress: () => void;
  getScaledCanvas: () => HTMLCanvasElement | null;
  estimateVideoFps: (video: HTMLVideoElement, fallback: number) => number;
  waitForRenderedSeek: RenderedSeekFn;
  waitForRenderedPlaybackFrame: RenderedPlaybackFrameFn;
  waitForVideoSeekSettled: RenderedSeekFn;
  createHiddenExportVideo: (video: HTMLVideoElement) => Promise<HTMLVideoElement>;
  setManualPause: (video: HTMLVideoElement | null, manualPause: boolean) => void;
  logReliableRenderProfile: ExportProgressLogger;
  logGifExportProfile: ExportProgressLogger;
}

export const useSaveAsExportHandlers = ({
  outputCanvasRef,
  stateVideo,
  actions,
  capturing,
  exporting,
  format,
  quality,
  includeVideoAudio,
  activeRecFormat,
  bitrate,
  autoBitrate,
  autoRecordFps,
  recordFps,
  videoLoopMode,
  reliableStrictValidation,
  reliableMaxFps,
  reliableSettleFrames,
  reliableScope,
  reliableRangeStart,
  reliableRangeEnd,
  frames,
  gifFps,
  gifPaletteSource,
  gifFilterPalette,
  loopAutoFps,
  loopCaptureMode,
  loopExportScope,
  loopRangeStart,
  loopRangeEnd,
  contactColumns,
  mult,
  mediaRecorderRef,
  streamRef,
  chunksRef,
  timerRef,
  exportAbortRef,
  renderVersionRef,
  videoFormat,
  recordedBlob,
  gifBlob,
  sequenceBlob,
  contactSheetBlob,
  clearRecordedResult,
  setRecordedResult,
  clearGifResult,
  setGifResult,
  clearSequenceResult,
  setSequenceResult,
  clearContactSheetResult,
  setContactSheetResult,
  setCopySuccess,
  setCapturing,
  setRecordingTime,
  setExporting,
  updateProgress,
  clearProgress,
  getScaledCanvas,
  estimateVideoFps,
  waitForRenderedSeek,
  waitForRenderedPlaybackFrame,
  waitForVideoSeekSettled,
  createHiddenExportVideo,
  setManualPause,
  logReliableRenderProfile,
  logGifExportProfile,
}: UseSaveAsExportHandlersOptions) => {
  const handleSave = useCallback(() => {
    const canvas = getScaledCanvas();
    if (!canvas) return;
    const mimeType = `image/${format}`;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        saveBlob(blob, format);
      },
      mimeType,
      format === "png" ? undefined : quality,
    );
  }, [getScaledCanvas, format, quality]);

  const handleCopy = useCallback(async () => {
    const canvas = getScaledCanvas();
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      await copyBlobWithFeedback(blob, setCopySuccess, "Image clipboard copy failed:");
    }, "image/png");
  }, [getScaledCanvas, setCopySuccess]);

  const handleRecord = useCallback(() => {
    if (capturing) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setCapturing(false);
      return;
    }

    const source = outputCanvasRef.current;
    if (!source) return;

    const fps = autoRecordFps ? undefined : recordFps;
    startCanvasRecording({
      sourceCanvas: source,
      sourceVideo: stateVideo ? stateVideo as VideoFrameCallbackVideo : null,
      includeVideoAudio,
      fps,
      recordingFormat: activeRecFormat,
      autoBitrate,
      bitrateMbps: bitrate,
      mediaRecorderRef,
      streamRef,
      chunksRef,
      onBlobReady: (blob) => {
        setRecordedResult(blob);
        clearProgress();
      },
      onStart: () => {
        setCapturing(true);
        setRecordingTime(0);
        clearRecordedResult();
        clearProgress();
        timerRef.current = window.setInterval(() => {
          setRecordingTime((time) => time + 1);
        }, 1000);
      },
      onStop: () => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
      },
    });
  }, [
    capturing,
    outputCanvasRef,
    stateVideo,
    includeVideoAudio,
    activeRecFormat,
    bitrate,
    autoBitrate,
    autoRecordFps,
    recordFps,
    mediaRecorderRef,
    streamRef,
    chunksRef,
    setRecordedResult,
    clearProgress,
    setCapturing,
    setRecordingTime,
    clearRecordedResult,
    timerRef,
  ]);

  const handleSaveVideo = useCallback(() => {
    if (!recordedBlob) return;
    const ext = recordedBlob.type.includes("mp4")
      ? "mp4"
      : recordedBlob.type.includes("webm")
        ? "webm"
        : (activeRecFormat?.ext || "webm");
    saveBlob(recordedBlob, ext);
  }, [recordedBlob, activeRecFormat]);

  const handleCopyVideo = useCallback(async () => {
    await copyBlobWithFeedback(recordedBlob, setCopySuccess, "Video clipboard copy failed (browser may not support video mime type):");
  }, [recordedBlob, setCopySuccess]);

  const handleSaveGif = useCallback(() => {
    saveBlob(gifBlob, "gif");
  }, [gifBlob]);

  const handleCopyGif = useCallback(async () => {
    await copyBlobWithFeedback(gifBlob, setCopySuccess, "GIF clipboard copy failed:");
  }, [gifBlob, setCopySuccess]);

  const handleSaveSequence = useCallback(() => {
    saveBlob(sequenceBlob, "zip");
  }, [sequenceBlob]);

  const handleCopySequence = useCallback(async () => {
    await copyBlobWithFeedback(sequenceBlob, setCopySuccess, "Sequence clipboard copy failed:");
  }, [sequenceBlob, setCopySuccess]);

  const handleSaveContactSheet = useCallback(() => {
    saveBlob(contactSheetBlob, "png");
  }, [contactSheetBlob]);

  const handleCopyContactSheet = useCallback(async () => {
    await copyBlobWithFeedback(contactSheetBlob, setCopySuccess, "Contact sheet clipboard copy failed:");
  }, [contactSheetBlob, setCopySuccess]);

  const handleAbortExport = useCallback(() => {
    exportAbortRef.current = true;
    updateProgress("Stopping...", null);
  }, [exportAbortRef, updateProgress]);

  const handleRecordLoop = useCallback(() => {
    const vid = stateVideo;
    if (!vid || capturing) return;

    if (videoLoopMode !== "realtime") {
      if (exporting) {
        handleAbortExport();
        return;
      }

      const includeAudio = includeVideoAudio;
      const sourceEstimatedFps = estimateVideoFps(vid, recordFps);
      const reliableFps = autoRecordFps
        ? Math.max(1, Math.min(reliableMaxFps, sourceEstimatedFps))
        : recordFps;
      const rangeStartSec = reliableScope === "range"
        ? Math.max(0, Math.min(vid.duration, reliableRangeStart))
        : 0;
      const rangeEndSec = reliableScope === "range"
        ? Math.max(rangeStartSec + 0.001, Math.min(vid.duration, reliableRangeEnd))
        : vid.duration;
      const exportDurationSec = Math.max(0.001, rangeEndSec - rangeStartSec);
      const wasPaused = vid.paused;
      const previousTime = vid.currentTime || 0;

      setManualPause(vid, true);
      vid.pause();

      exportAbortRef.current = false;
      setExporting(true);
      clearRecordedResult();
      updateProgress("Preparing reliable offline render...", 0.02);

      const run = async () => runReliableVideoExport({
        video: vid,
        preferredMode: videoLoopMode,
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
        isAborted: () => exportAbortRef.current,
        renderFrameForExport: (sourceCanvas, frame) => actions.renderFrameForExport(sourceCanvas, frame),
        clearExportSession: actions.clearExportSession,
        logReliableRenderProfile,
      });

      run()
        .then((result) => {
          if (!result?.blob) {
            updateProgress("Reliable render stopped.", null);
            return;
          }
          setRecordedResult(result.blob);
          updateProgress(result.aborted
            ? "Partial WebM preview ready after stopping."
            : result.audioIncluded
              ? "Reliable WebM with source audio ready to save or copy."
              : (includeAudio && result.audioUnavailableReason)
                ? "Reliable WebM ready to save or copy. Source audio could not be decoded, so this export is silent."
                : "Reliable WebM ready to save or copy.", null);
        })
        .catch((error) => {
          console.error("Reliable video export failed:", error);
          updateProgress(error instanceof Error ? error.message : "Reliable video export failed.", null);
        })
        .finally(() => {
          exportAbortRef.current = false;
          setExporting(false);

          const restoreTime = Math.min(previousTime, Math.max(0, vid.duration - 0.0005));
          waitForRenderedSeek(vid, restoreTime, 1000 / Math.max(1, reliableFps))
            .catch(() => {})
            .finally(() => {
              if (!wasPaused) {
                setManualPause(vid, false);
                vid.play().catch(() => {});
              } else {
                setManualPause(vid, true);
              }
            });
        });

      return;
    }

    const source = outputCanvasRef.current;
    if (!source) return;
    startRealtimeLoopRecording({
      video: vid,
      sourceCanvas: source,
      sourceVideo: vid as VideoFrameCallbackVideo,
      includeVideoAudio,
      fps: autoRecordFps ? undefined : recordFps,
      recordingFormat: activeRecFormat,
      autoBitrate,
      bitrateMbps: bitrate,
      mediaRecorderRef,
      streamRef,
      chunksRef,
      timerRef,
      setCapturing,
      setRecordingTime,
      clearRecordedResult,
      onBlobReady: (blob) => {
        setRecordedResult(blob);
      },
    });
  }, [
    stateVideo,
    capturing,
    videoLoopMode,
    exporting,
    handleAbortExport,
    includeVideoAudio,
    estimateVideoFps,
    recordFps,
    autoRecordFps,
    reliableMaxFps,
    reliableScope,
    reliableRangeStart,
    reliableRangeEnd,
    setManualPause,
    exportAbortRef,
    setExporting,
    clearRecordedResult,
    updateProgress,
    reliableStrictValidation,
    reliableSettleFrames,
    getScaledCanvas,
    waitForRenderedSeek,
    actions,
    logReliableRenderProfile,
    setRecordedResult,
    outputCanvasRef,
    activeRecFormat,
    autoBitrate,
    bitrate,
    mediaRecorderRef,
    streamRef,
    chunksRef,
    timerRef,
    setCapturing,
    setRecordingTime,
  ]);

  const handleExportGif = useCallback(async () => {
    exportAbortRef.current = false;
    setExporting(true);
    try {
      await runCurrentFrameGifExport({
        frameCount: frames,
        gifFps,
        getScaledCanvas,
        updateProgress: (message, value) => updateProgress(message, value),
        clearProgress,
        isAborted: () => exportAbortRef.current,
        clearGifResult,
        setGifResult,
        gifPaletteSource,
        gifFilterPalette,
      });
    } catch (error) {
      console.error("GIF export failed:", error);
    } finally {
      exportAbortRef.current = false;
      setExporting(false);
      clearProgress();
    }
  }, [
    exportAbortRef,
    setExporting,
    frames,
    gifFps,
    getScaledCanvas,
    updateProgress,
    clearProgress,
    clearGifResult,
    setGifResult,
    gifPaletteSource,
    gifFilterPalette,
  ]);

  const handleExportLoop = useCallback(async (mode: "gif" | "sequence" | "contact") => {
    const vid = stateVideo;
    if (!vid) return;
    const source = outputCanvasRef.current;
    if (!source) return;

    exportAbortRef.current = false;
    setExporting(true);
    try {
      await runLoopExport({
        mode,
        video: vid,
        sourceCanvas: source,
        mult,
        targetFrameCount: frames,
        contactColumns,
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
        getCurrentRenderVersion: () => renderVersionRef.current,
        updateProgress: (message, value) => updateProgress(message, value),
        clearProgress,
        isAborted: () => exportAbortRef.current,
        clearGifResult,
        clearSequenceResult,
        setGifResult,
        setSequenceResult,
        clearContactSheetResult,
        setContactSheetResult,
        createHiddenExportVideo,
        renderFrameForExport: (sourceCanvas, frame) => actions.renderFrameForExport(sourceCanvas, frame),
        clearExportSession: actions.clearExportSession,
        logGifExportProfile,
      });
    } catch (error) {
      console.error(
        mode === "gif"
          ? "GIF loop export failed:"
          : mode === "sequence"
            ? "Sequence zip failed:"
            : "Contact sheet export failed:",
        error,
      );
    } finally {
      setExporting(false);
      clearProgress();
    }
  }, [
    stateVideo,
    outputCanvasRef,
    exportAbortRef,
    setExporting,
    mult,
    contactColumns,
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
    renderVersionRef,
    updateProgress,
    clearProgress,
    clearGifResult,
    clearSequenceResult,
    setGifResult,
    setSequenceResult,
    clearContactSheetResult,
    setContactSheetResult,
    createHiddenExportVideo,
    actions,
    logGifExportProfile,
  ]);

  const handleExportSequence = useCallback(async () => {
    exportAbortRef.current = false;
    setExporting(true);
    try {
      await runCurrentFrameSequenceExport({
        frameCount: frames,
        getScaledCanvas,
        updateProgress: (message, value) => updateProgress(message, value),
        clearProgress,
        isAborted: () => exportAbortRef.current,
        clearSequenceResult,
        setSequenceResult,
      });
    } catch (error) {
      console.error("Sequence zip failed:", error);
    } finally {
      setExporting(false);
      clearProgress();
    }
  }, [
    exportAbortRef,
    setExporting,
    frames,
    getScaledCanvas,
    updateProgress,
    clearProgress,
    clearSequenceResult,
    setSequenceResult,
  ]);

  const handleExportContactSheet = useCallback(async () => {
    exportAbortRef.current = false;
    setExporting(true);
    try {
      await runCurrentFrameContactSheetExport({
        frameCount: frames,
        columns: contactColumns,
        getScaledCanvas,
        updateProgress: (message, value) => updateProgress(message, value),
        clearProgress,
        isAborted: () => exportAbortRef.current,
        clearContactSheetResult,
        setContactSheetResult,
      });
    } catch (error) {
      console.error("Contact sheet export failed:", error);
    } finally {
      setExporting(false);
      clearProgress();
    }
  }, [
    exportAbortRef,
    setExporting,
    frames,
    contactColumns,
    getScaledCanvas,
    updateProgress,
    clearProgress,
    clearContactSheetResult,
    setContactSheetResult,
  ]);

  const handleVideoExport = useCallback(() => {
    if (stateVideo) {
      if (videoFormat === "gif") {
        void handleExportLoop("gif");
        return;
      }
      if (videoFormat === "contact") {
        void handleExportLoop("contact");
        return;
      }
      void handleExportLoop("sequence");
      return;
    }

    if (videoFormat === "gif") {
      void handleExportGif();
      return;
    }
    if (videoFormat === "contact") {
      void handleExportContactSheet();
      return;
    }
    void handleExportSequence();
  }, [
    stateVideo,
    videoFormat,
    handleExportLoop,
    handleExportGif,
    handleExportSequence,
    handleExportContactSheet,
  ]);

  return {
    handleSave,
    handleCopy,
    handleRecord,
    handleSaveVideo,
    handleCopyVideo,
    handleSaveGif,
    handleCopyGif,
    handleSaveSequence,
    handleCopySequence,
    handleSaveContactSheet,
    handleCopyContactSheet,
    handleAbortExport,
    handleRecordLoop,
    handleExportGif,
    handleExportLoop,
    handleExportSequence,
    handleExportContactSheet,
    handleVideoExport,
  };
};
