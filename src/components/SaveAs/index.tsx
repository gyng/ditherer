import { useState, useRef, useEffect, useCallback } from "react";
import { useFilter } from "context/useFilter";
import { filterList, hasTemporalBehavior } from "filters";
import {
  DEFAULT_RELIABLE_MAX_FPS,
  DEFAULT_RELIABLE_SETTLE_FRAMES,
  GIF_PALETTE_PREVIEW_LIMIT,
} from "./constants";
import { getReliableVideoSupport, type ReliableVideoSupport } from "./export/offlineVideoEncode";
import { ImageTab } from "./ui/ImageTab";
import { VideoTab } from "./ui/VideoTab";
import {
  detectRecordingFormats,
  getGifPaletteColorTable,
  type ManagedVideoElement,
} from "./helpers";
import { useSaveAsResults } from "./hooks/useSaveAsResults";
import { useSaveAsExportHandlers } from "./hooks/useSaveAsExportHandlers";
import { useSaveAsRenderSync } from "./hooks/useSaveAsRenderSync";
import controls from "components/controls/styles.module.css";
import s from "./styles.module.css";

interface SaveAsProps {
  outputCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onClose: () => void;
}

const SaveAs = ({ outputCanvasRef, onClose }: SaveAsProps) => {
  const { state, actions } = useFilter();
  const temporalFilterNamesRef = useRef(new Set(
    filterList.filter(hasTemporalBehavior).map((entry) => entry.filter.name)
  ));

  // Tab
  const hasAnimatedFilter = (state.chain || []).some(
    (entry) => entry.enabled !== false && temporalFilterNamesRef.current.has(entry.filter?.name)
  );
  const isAnimated = !!state.video || hasAnimatedFilter;
  const showVideoTab = isAnimated || state.realtimeFiltering;
  // Default to Video tab only when input is actually video/animated, not just because realtime is on
  const [activeTab, setActiveTab] = useState<"image" | "video">(
    isAnimated ? "video" : "image"
  );

  // Image settings
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState(0.92);
  const [resolution, setResolution] = useState("1");
  const [customMultiplier, setCustomMultiplier] = useState(2);

  // Video settings
  const [recordingFormats] = useState(() => detectRecordingFormats());
  const [videoFormat, setVideoFormat] = useState("recording"); // "recording" | "gif" | "sequence"
  const [selectedRecFormat, setSelectedRecFormat] = useState(0); // index into recordingFormats
  const [autoBitrate, setAutoBitrate] = useState(true);
  const [bitrate, setBitrate] = useState(2.5);
  const [autoRecordFps, setAutoRecordFps] = useState(true);
  const [recordFps, setRecordFps] = useState(30);
  const [includeVideoAudio, setIncludeVideoAudio] = useState(true);
  const [videoLoopMode, setVideoLoopMode] = useState<"realtime" | "offline" | "webcodecs">("webcodecs");
  const [reliableScope, setReliableScope] = useState<"loop" | "range">("loop");
  const [reliableStrictValidation, setReliableStrictValidation] = useState(false);
  const [reliableMaxFps, setReliableMaxFps] = useState(DEFAULT_RELIABLE_MAX_FPS);
  const [reliableSettleFrames, setReliableSettleFrames] = useState(DEFAULT_RELIABLE_SETTLE_FRAMES);
  const [reliableRangeStart, setReliableRangeStart] = useState(0);
  const [reliableRangeEnd, setReliableRangeEnd] = useState(0);
  const [loopExportScope, setLoopExportScope] = useState<"loop" | "range">("loop");
  const [loopRangeStart, setLoopRangeStart] = useState(0);
  const [loopRangeEnd, setLoopRangeEnd] = useState(0);
  const [frames, setFrames] = useState(30);
  const [gifFps, setGifFps] = useState(10);
  const [gifPaletteSource, setGifPaletteSource] = useState<"auto" | "filter">("auto");
  const [loopAutoFps, setLoopAutoFps] = useState(true);
  const [loopCaptureMode, setLoopCaptureMode] = useState<"realtime" | "offline" | "webcodecs">("offline");

  // Recording state
  const [capturing, setCapturing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [reliableVideoSupport, setReliableVideoSupport] = useState<ReliableVideoSupport | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);
  const renderVersionRef = useRef(0);
  const latestStateRef = useRef(state);
  const exportAbortRef = useRef(false);
  const scaledCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [progressValue, setProgressValue] = useState<number | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const {
    recordedBlob,
    recordedUrl,
    gifBlob,
    gifUrl,
    gifResultLabel,
    sequenceBlob,
    clearRecordedResult,
    setRecordedResult,
    clearGifResult,
    setGifResult,
    clearSequenceResult,
    setSequenceResult,
  } = useSaveAsResults();

  const updateProgress = useCallback((message: string | null, value?: number | null) => {
    setProgress(message);
    if (value == null || !Number.isFinite(value)) {
      setProgressValue(null);
      return;
    }
    setProgressValue(Math.max(0, Math.min(1, value)));
  }, []);

  const clearProgress = useCallback(() => {
    setProgress(null);
    setProgressValue(null);
  }, []);

  const logReliableRenderProfile = useCallback((label: string, stats: Record<string, number | string | boolean | null>) => {
    console.info("[reliable-export]", label, stats);
  }, []);

  const logGifExportProfile = useCallback((label: string, stats: Record<string, number | string | boolean | null>) => {
    console.info("[gif-export]", label, stats);
  }, []);

  const setManualPause = useCallback((video: HTMLVideoElement | null, manualPause: boolean) => {
    if (!video) return;
    (video as ManagedVideoElement).__manualPause = manualPause;
  }, []);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (state.outputImage) {
      renderVersionRef.current += 1;
    }
  }, [state.outputImage]);

  useEffect(() => {
    const video = state.video as HTMLVideoElement | null;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    setReliableRangeStart(0);
    setReliableRangeEnd(video.duration);
    setLoopRangeStart(0);
    setLoopRangeEnd(video.duration);
  }, [state.video]);

  useEffect(() => {
    if (!state.video) {
      setIncludeVideoAudio(false);
      return;
    }
    setIncludeVideoAudio(true);
  }, [state.video]);

  const activeRecFormat = recordingFormats[selectedRecFormat] ?? recordingFormats[0];
  const activeEntry = state.chain?.[state.activeIndex] ?? null;
  const gifFilterPalette = getGifPaletteColorTable([
    activeEntry?.filter?.options?.palette,
    ...(state.chain || [])
      .filter((entry) => entry?.enabled !== false)
      .map((entry) => entry?.filter?.options?.palette),
  ]);
  const canUseGifFilterPalette = !!gifFilterPalette;
  const gifPalettePreview = gifFilterPalette?.slice(0, GIF_PALETTE_PREVIEW_LIMIT) ?? [];
  const gifPaletteOverflow = Math.max(0, (gifFilterPalette?.length ?? 0) - gifPalettePreview.length);

  useEffect(() => {
    if (gifPaletteSource === "filter" && !canUseGifFilterPalette) {
      setGifPaletteSource("auto");
    }
  }, [gifPaletteSource, canUseGifFilterPalette]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  // While recording with a video source, mirror its currentTime/duration for the seekbar
  useEffect(() => {
    if (!capturing) return;
    const vid = state.video as HTMLVideoElement | null;
    if (!vid) return;
    setSourceDuration(vid.duration || 0);
    const onUpdate = () => {
      setSourceTime(vid.currentTime);
      if (vid.duration && vid.duration !== sourceDuration) {
        setSourceDuration(vid.duration);
      }
    };
    vid.addEventListener("timeupdate", onUpdate);
    vid.addEventListener("durationchange", onUpdate);
    onUpdate();
    return () => {
      vid.removeEventListener("timeupdate", onUpdate);
      vid.removeEventListener("durationchange", onUpdate);
    };
  }, [capturing, state.video]);

  // Wire video element to live stream while recording, then to recorded blob URL
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (capturing && streamRef.current) {
      el.srcObject = streamRef.current;
      el.muted = true; // avoid feedback during recording
      el.play().catch(() => {});
    } else if (recordedUrl) {
      el.srcObject = null;
      el.src = recordedUrl;
      el.muted = false;
      el.play().catch(() => {});
    }
  }, [capturing, recordedUrl]);

  // Keyboard
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capturing && !exporting) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, capturing, exporting]);

  // -- Helpers --

  const canvas = outputCanvasRef.current;
  const canvasReady = canvas && canvas.width > 0 && canvas.height > 0;
  const mult = resolution === "custom" ? customMultiplier : parseInt(resolution);
  const exportW = (canvas?.width ?? 0) * mult;
  const exportH = (canvas?.height ?? 0) * mult;
  const largeExport = exportW > 4096 || exportH > 4096;

  const {
    getScaledCanvas,
    estimateVideoFps,
    waitForRenderedSeek,
    waitForRenderedPlaybackFrame,
    waitForVideoSeekSettled,
    createHiddenExportVideo,
  } = useSaveAsRenderSync({
    outputCanvasRef,
    scaledCanvasRef,
    latestStateRef,
    renderVersionRef,
    exportAbortRef,
    mult,
    gifFps,
  });

  useEffect(() => {
    let cancelled = false;

    const video = state.video as HTMLVideoElement | null;
    if (!video || !canvasReady) {
      setReliableVideoSupport(null);
      return () => {
        cancelled = true;
      };
    }

    const fps = autoRecordFps ? estimateVideoFps(video, recordFps) : recordFps;
    const needsAudio = includeVideoAudio;

    getReliableVideoSupport(exportW, exportH, fps, needsAudio)
      .then((support) => {
        if (!cancelled) {
          setReliableVideoSupport(support);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReliableVideoSupport({
            supported: false,
            reason: error instanceof Error ? error.message : "Reliable export support could not be determined.",
            audio: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.video, includeVideoAudio, canvasReady, exportW, exportH, autoRecordFps, recordFps, estimateVideoFps]);

  const {
    handleSave,
    handleCopy,
    handleRecord,
    handleSaveVideo,
    handleCopyVideo,
    handleSaveGif,
    handleCopyGif,
    handleSaveSequence,
    handleCopySequence,
    handleAbortExport,
    handleRecordLoop,
    handleExportLoop,
    handleVideoExport,
  } = useSaveAsExportHandlers({
    outputCanvasRef,
    stateVideo: state.video as HTMLVideoElement | null,
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
    clearRecordedResult,
    setRecordedResult,
    clearGifResult,
    setGifResult,
    clearSequenceResult,
    setSequenceResult,
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
  });

  const videoFormatOptions = {
    options: [
      ...(recordingFormats.length > 0 ? [{ name: "video", value: "recording" }] : []),
      { value: "gif" },
      { value: "sequence" },
    ],
  };

  const recFormatOptions = {
    options: recordingFormats.map(f => ({ value: f.label })),
  };

  const recordingPanelProps = {
    hasSourceVideo: !!state.video,
    sourceDuration,
    sourceTime,
    exporting,
    capturing,
    copySuccess,
    recordingTime,
    videoVolume: state.videoVolume,
    videoLoopMode,
    includeVideoAudio,
    reliableVideoSupport,
    recordingFormats,
    recFormatOptions,
    activeRecFormatLabel: activeRecFormat?.label || "",
    autoRecordFps,
    recordFps,
    reliableMaxFps,
    autoBitrate,
    bitrate,
    reliableSettleFrames,
    reliableStrictValidation,
    reliableScope,
    reliableRangeStart,
    reliableRangeEnd,
    videoDuration: state.video?.duration || 0,
    recordedUrl,
    recordedBlob,
    progress,
    progressValue,
    onSetVideoLoopMode: setVideoLoopMode,
    onSetIncludeVideoAudio: setIncludeVideoAudio,
    onSetSelectedRecFormat: (value: string) => {
      const idx = recordingFormats.findIndex((entry) => entry.label === value);
      if (idx >= 0) setSelectedRecFormat(idx);
    },
    onSetAutoRecordFps: setAutoRecordFps,
    onSetRecordFps: setRecordFps,
    onSetReliableMaxFps: setReliableMaxFps,
    onSetAutoBitrate: setAutoBitrate,
    onSetBitrate: setBitrate,
    onSetReliableSettleFrames: setReliableSettleFrames,
    onSetReliableStrictValidation: setReliableStrictValidation,
    onSetReliableScope: setReliableScope,
    onSetReliableRangeStart: setReliableRangeStart,
    onSetReliableRangeEnd: setReliableRangeEnd,
    onRecord: handleRecord,
    onRecordLoop: handleRecordLoop,
    videoPreviewRef: videoRef,
    onSaveVideo: handleSaveVideo,
    onCopyVideo: handleCopyVideo,
  };

  const frameExportPanelProps = {
    hasSourceVideo: !!state.video,
    exporting,
    copySuccess,
    videoFormat,
    frames,
    loopCaptureMode,
    loopAutoFps,
    gifFps,
    videoDuration: state.video?.duration || 0,
    loopExportScope,
    loopRangeStart,
    loopRangeEnd,
    canUseGifFilterPalette,
    gifPaletteSource,
    gifPalettePreview,
    gifPaletteOverflow,
    gifUrl,
    gifResultLabel,
    gifBlob,
    sequenceBlob,
    progress,
    progressValue,
    onSetFrames: setFrames,
    onSetLoopCaptureMode: setLoopCaptureMode,
    onSetLoopAutoFps: setLoopAutoFps,
    onSetGifFps: setGifFps,
    onSetGifPaletteSource: setGifPaletteSource,
    onSetLoopExportScope: setLoopExportScope,
    onSetLoopRangeStart: setLoopRangeStart,
    onSetLoopRangeEnd: setLoopRangeEnd,
    onAbortExport: handleAbortExport,
    onVideoExport: handleVideoExport,
    onExportLoop: handleExportLoop,
    onSaveGif: handleSaveGif,
    onCopyGif: handleCopyGif,
    onSaveSequence: handleSaveSequence,
    onCopySequence: handleCopySequence,
  };

  return (
      <div className={[controls.window, s.dialog].join(" ")}>
        <div className={["handle", controls.titleBar, s.titleBar].join(" ")}>
          <span>Save As</span>
          <button
            className={s.closeBtn}
            onMouseDown={e => e.stopPropagation()}
            onClick={!capturing && !exporting ? onClose : undefined}
            title="Close"
          >
            &#10005;
          </button>
        </div>

        {/* Tabs */}
        <div className={s.tabs}>
          <div
            className={[s.tab, activeTab === "image" ? s.tabActive : ""].join(" ")}
            onClick={() => setActiveTab("image")}
          >
            Image
          </div>
          {showVideoTab && (
            <div
              className={[s.tab, activeTab === "video" ? s.tabActive : ""].join(" ")}
              onClick={() => setActiveTab("video")}
            >
              Video
            </div>
          )}
        </div>

        <div className={s.tabContent}>
          {/* ---- Image Tab ---- */}
          {activeTab === "image" && (
            <ImageTab
              format={format}
              quality={quality}
              resolution={resolution}
              customMultiplier={customMultiplier}
              canvasWidth={canvas?.width ?? 0}
              canvasHeight={canvas?.height ?? 0}
              exportWidth={exportW}
              exportHeight={exportH}
              largeExport={largeExport}
              canvasReady={!!canvasReady}
              copySuccess={copySuccess}
              setFormat={setFormat}
              setQuality={setQuality}
              setResolution={setResolution}
              setCustomMultiplier={setCustomMultiplier}
              onSave={handleSave}
              onCopy={handleCopy}
            />
          )}

          {/* ---- Video Tab ---- */}
          {activeTab === "video" && (
            <VideoTab
              videoVolume={state.videoVolume}
              videoFormat={videoFormat}
              videoFormatOptions={videoFormatOptions.options}
              onSetVideoFormat={setVideoFormat}
              recordingPanel={recordingPanelProps}
              frameExportPanel={frameExportPanelProps}
            />
          )}
        </div>
      </div>
  );
};

export default SaveAs;
