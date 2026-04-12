import { useState, useRef, useEffect, useCallback } from "react";
import { zipSync } from "fflate";
import { useFilter } from "context/useFilter";
import { filterList, hasTemporalBehavior } from "filters";
import Range from "components/controls/Range";
import Enum from "components/controls/Enum";
import { createOfflineVideoEncoder, getReliableVideoSupport, type ReliableVideoSupport } from "./offlineVideoEncode";
import { renderOfflineFrames } from "./offlineRender";
import { buildDecodedTimeline, decodeTimelineFramesWithWebCodecs } from "./offlineWebCodecsDecode";
import { planLoopCaptureRouting, planReliableVideoRouting } from "./exportRouting";
import controls from "components/controls/styles.module.css";
import s from "./styles.module.css";

const makeFilename = (ext: string) => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `ditherer-${stamp}.${ext}`;
};

const IMAGE_FORMAT_OPTIONS = {
  options: [{ value: "png" }, { value: "jpeg" }, { value: "webp" }],
};

const LOOP_CAPTURE_MODE_OPTIONS = {
  options: [
    { name: "Realtime (Fastest)", value: "realtime" },
    { name: "Offline Render (Browser, Slower)", value: "offline" },
    { name: "Offline Render (WebCodecs, Speed Varies)", value: "webcodecs" },
  ],
};

const VIDEO_LOOP_MODE_OPTIONS = {
  options: [
    { name: "Realtime (Fastest)", value: "realtime" },
    { name: "Offline Render (Browser, Slower)", value: "offline" },
    { name: "Offline Render (WebCodecs, Speed Varies)", value: "webcodecs" },
  ],
};

const RELIABLE_SCOPE_OPTIONS = {
  options: [
    { name: "Whole video", value: "loop" },
    { name: "Timestamp range", value: "range" },
  ],
};

const GIF_PALETTE_SOURCE_OPTIONS = {
  options: [
    { name: "Auto from frames", value: "auto" },
    { name: "Current filter palette", value: "filter" },
  ],
};

const DEFAULT_RELIABLE_MAX_FPS = 12;
const DEFAULT_RELIABLE_SETTLE_FRAMES = 1;
const GIF_PALETTE_PREVIEW_LIMIT = 24;

const rgbToCss = (color: number[]) => `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
const quantizeGifDelay = (delayMs: number) => Math.max(10, Math.round(Math.max(10, delayMs) / 10) * 10);
const areFrameBuffersEqual = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};
const toGifBuffer = (data: Uint8ClampedArray) => new Uint8Array(data);

type RecordingFormat = {
  label: string;       // e.g. "webm (vp9)"
  container: string;   // e.g. "webm"
  mimeType: string;    // e.g. "video/webm; codecs=vp9"
  ext: string;         // file extension
};

const detectRecordingFormats = (): RecordingFormat[] => {
  const codecCandidates: { container: string; codec: string; mime: string; ext: string }[] = [
    { container: "webm", codec: "vp9",  mime: "video/webm; codecs=vp9",  ext: "webm" },
    { container: "webm", codec: "vp8",  mime: "video/webm; codecs=vp8",  ext: "webm" },
    { container: "webm", codec: "av1",  mime: "video/webm; codecs=av01", ext: "webm" },
    { container: "mp4",  codec: "h264", mime: "video/mp4; codecs=avc1",  ext: "mp4" },
    { container: "mp4",  codec: "h265", mime: "video/mp4; codecs=hvc1",  ext: "mp4" },
  ];
  const fallbacks: { container: string; mime: string; ext: string }[] = [
    { container: "webm", mime: "video/webm", ext: "webm" },
    { container: "mp4",  mime: "video/mp4",  ext: "mp4" },
  ];

  const formats: RecordingFormat[] = [];
  const containersWithCodec = new Set<string>();

  for (const c of codecCandidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) {
      formats.push({
        label: `${c.container} (${c.codec})`,
        container: c.container,
        mimeType: c.mime,
        ext: c.ext,
      });
      containersWithCodec.add(c.container);
    }
  }

  // Only add a bare-container fallback if no codec-specific variant was found
  for (const f of fallbacks) {
    if (!containersWithCodec.has(f.container) && MediaRecorder.isTypeSupported(f.mime)) {
      formats.push({
        label: f.container,
        container: f.container,
        mimeType: f.mime,
        ext: f.ext,
      });
    }
  }

  return formats;
};

interface SaveAsProps {
  outputCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  onClose: () => void;
}

type ManagedVideoElement = HTMLVideoElement & { __manualPause?: boolean };
type SourceVideoWithObjectUrl = HTMLVideoElement & { __objectUrl?: string };
type PaletteOptionWithColors = {
  options?: {
    colors?: unknown;
  };
};
type VideoFrameMetadata = { mediaTime?: number };
type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameMetadata) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
  captureStream?: (fps?: number) => MediaStream;
};

const canWriteClipboard = () => typeof navigator !== "undefined" && navigator.clipboard != null;

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
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [gifBlob, setGifBlob] = useState<Blob | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifResultLabel, setGifResultLabel] = useState<string | null>(null);
  const [sequenceBlob, setSequenceBlob] = useState<Blob | null>(null);
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

  useEffect(() => {
    if (videoFormat === "gif" && loopCaptureMode === "offline") {
      setLoopCaptureMode("webcodecs");
    }
  }, [videoFormat, loopCaptureMode]);

  const activeRecFormat = recordingFormats[selectedRecFormat] ?? recordingFormats[0];
  const activeEntry = state.chain?.[state.activeIndex] ?? null;
  const getPaletteOptions = (palette: unknown): PaletteOptionWithColors | null =>
    typeof palette === "object" && palette !== null ? (palette as PaletteOptionWithColors) : null;

  const getGifPaletteColorTable = useCallback(() => {
    const paletteCandidates = [
      activeEntry?.filter?.options?.palette,
      ...(state.chain || [])
        .filter((entry) => entry?.enabled !== false)
        .map((entry) => entry?.filter?.options?.palette),
    ];

    for (const palette of paletteCandidates) {
      const rawColors = getPaletteOptions(palette)?.options?.colors;
      if (!Array.isArray(rawColors) || rawColors.length === 0) continue;
      const deduped = rawColors
        .map((color: number[]) => [color[0], color[1], color[2]].map((channel) => {
          const n = Number(channel);
          if (!Number.isFinite(n)) return 0;
          return Math.max(0, Math.min(255, Math.round(n)));
        }))
        .filter((color: number[]) => color.length === 3)
        .filter((color: number[], index: number, all: number[][]) =>
          all.findIndex(candidate => (
            candidate[0] === color[0] &&
            candidate[1] === color[1] &&
            candidate[2] === color[2]
          )) === index
        )
        .slice(0, 256);

      if (deduped.length >= 2) {
        return deduped as number[][];
      }
    }

    return null;
  }, [activeEntry, state.chain]);

  const gifFilterPalette = getGifPaletteColorTable();
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
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      if (gifUrl) URL.revokeObjectURL(gifUrl);
    };
  }, [recordedUrl, gifUrl]);

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

  const getScaledCanvas = useCallback((): HTMLCanvasElement | null => {
    const source = outputCanvasRef.current;
    if (!source) return null;
    let scaled = scaledCanvasRef.current;
    if (!scaled) {
      scaled = document.createElement("canvas");
      scaledCanvasRef.current = scaled;
    }
    const targetWidth = source.width * mult;
    const targetHeight = source.height * mult;
    if (scaled.width !== targetWidth) scaled.width = targetWidth;
    if (scaled.height !== targetHeight) scaled.height = targetHeight;
    const ctx = scaled.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, scaled.width, scaled.height);
    ctx.drawImage(source, 0, 0, scaled.width, scaled.height);
    return scaled;
  }, [outputCanvasRef, mult]);

  const estimateVideoFps = useCallback((vid: HTMLVideoElement, fallback: number) => {
    const duration = vid.duration || 0;
    const anyVid = vid as HTMLVideoElement & {
      webkitDecodedFrameCount?: number;
      mozPresentedFrames?: number;
      getVideoPlaybackQuality?: () => { totalVideoFrames?: number };
    };
    const qualityFrames = anyVid.getVideoPlaybackQuality?.().totalVideoFrames;
    if (qualityFrames && duration > 0) return Math.max(1, Math.min(60, Math.round(qualityFrames / duration)));
    if (anyVid.webkitDecodedFrameCount && duration > 0) return Math.max(1, Math.min(60, Math.round(anyVid.webkitDecodedFrameCount / duration)));
    if (anyVid.mozPresentedFrames && duration > 0) return Math.max(1, Math.min(60, Math.round(anyVid.mozPresentedFrames / duration)));
    return fallback;
  }, []);

  const waitForRenderedSeek = useCallback(async (
    vid: HTMLVideoElement,
    targetTime: number,
    expectedFrameMs = 1000 / Math.max(1, gifFps),
    strictValidation = false,
    settleFrames = DEFAULT_RELIABLE_SETTLE_FRAMES
  ) => {
    const previousInputFrameToken = latestStateRef.current.inputFrameToken ?? 0;
    const previousRenderVersion = renderVersionRef.current;
    const targetTolerance = strictValidation
      ? Math.max(0.003, Math.min(0.012, (expectedFrameMs / 1000) * 0.35))
      : Math.max(0.008, Math.min(0.03, (expectedFrameMs / 1000) * 0.9));
    if (Math.abs((vid.currentTime || 0) - targetTime) > 0.0005) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          vid.removeEventListener("seeked", onSeeked);
          resolve();
        };
        vid.addEventListener("seeked", onSeeked);
        vid.currentTime = targetTime;
      });
    }

    const settleCount = strictValidation ? Math.max(1, settleFrames) : Math.max(1, Math.min(2, settleFrames));
    for (let i = 0; i < settleCount; i += 1) {
      await new Promise(r => requestAnimationFrame(r));
    }

    let decodedMediaTime: number | null = null;
    if (strictValidation && "requestVideoFrameCallback" in vid) {
      await Promise.race([
        new Promise<void>((resolve) => {
          const callbackId = (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.((_now: number, metadata: VideoFrameMetadata) => {
            decodedMediaTime = metadata?.mediaTime ?? null;
            resolve();
          });
          window.setTimeout(() => {
            if (typeof (vid as VideoFrameCallbackVideo).cancelVideoFrameCallback === "function" && callbackId != null) {
              try {
                (vid as VideoFrameCallbackVideo).cancelVideoFrameCallback?.(callbackId);
              } catch {
                // ignore cancel races
              }
            }
            resolve();
          }, Math.max(32, Math.round(expectedFrameMs * 2)));
        }),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, Math.max(32, Math.round(expectedFrameMs * 2)));
        }),
      ]);
    }

    const deadline = performance.now() + 1500;
    let warned = false;
    while (performance.now() < deadline) {
      if (exportAbortRef.current) {
        return;
      }
      const latestState = latestStateRef.current;
      const decodedMatches = decodedMediaTime == null || Math.abs(decodedMediaTime - targetTime) <= targetTolerance;
      const videoMatches = Math.abs((vid.currentTime || 0) - targetTime) <= targetTolerance;
      const inputTimeMatches = latestState.time != null && Math.abs(latestState.time - targetTime) <= targetTolerance;
      const outputTimeMatches = latestState.outputTime != null && Math.abs(latestState.outputTime - targetTime) <= targetTolerance;
      const inputFrameToken = latestState.inputFrameToken ?? 0;
      const outputFrameToken = latestState.outputFrameToken ?? 0;
      const inputCaughtUp = inputFrameToken > previousInputFrameToken;
      const outputTokenCaughtUp = outputFrameToken === inputFrameToken && outputFrameToken > previousInputFrameToken;
      const hasOutput = !!latestState.outputImage;
      const renderCaughtUp = outputTokenCaughtUp || (renderVersionRef.current > previousRenderVersion && hasOutput);
      if (decodedMatches && videoMatches && inputTimeMatches && outputTimeMatches && inputCaughtUp && renderCaughtUp) {
        await new Promise(r => requestAnimationFrame(r));
        return;
      }
      if (!warned && performance.now() + 250 >= deadline) {
        warned = true;
        console.warn("[reliable-export] frame-ready timeout fallback", {
          targetTime,
          videoTime: vid.currentTime || 0,
          stateTime: latestState.time,
          outputTime: latestState.outputTime,
          previousInputFrameToken,
          inputFrameToken,
          outputFrameToken,
          decodedMediaTime,
          previousRenderVersion,
          currentRenderVersion: renderVersionRef.current,
        });
      }
      await new Promise(r => requestAnimationFrame(r));
    }

    await new Promise(r => requestAnimationFrame(r));
  }, [gifFps]);

  const waitForRenderedPlaybackFrame = useCallback(async (
    targetTime: number,
    previousRenderVersion: number,
    expectedFrameMs = 1000 / Math.max(1, gifFps),
  ) => {
    const previousInputFrameToken = latestStateRef.current.inputFrameToken ?? 0;
    const targetTolerance = Math.max(0.01, Math.min(0.04, (expectedFrameMs / 1000) * 0.9));
    const deadline = performance.now() + Math.max(120, Math.round(expectedFrameMs * 8));

    while (performance.now() < deadline) {
      if (exportAbortRef.current) return;
      const latestState = latestStateRef.current;
      const stateTime = latestState.time;
      const outputTime = latestState.outputTime;
      const inputFrameToken = latestState.inputFrameToken ?? 0;
      const outputFrameToken = latestState.outputFrameToken ?? 0;
      const renderAdvanced = renderVersionRef.current > previousRenderVersion || outputFrameToken > previousInputFrameToken;
      const hasOutput = !!latestState.outputImage;
      const inputTimeMatches = stateTime != null && Math.abs(stateTime - targetTime) <= targetTolerance;
      const outputTimeMatches = outputTime != null && Math.abs(outputTime - targetTime) <= targetTolerance;
      const outputMatchesInput = outputFrameToken === inputFrameToken && outputFrameToken > previousInputFrameToken;
      if (renderAdvanced && hasOutput && inputTimeMatches && outputTimeMatches && outputMatchesInput) {
        await new Promise(r => requestAnimationFrame(r));
        return {
          renderedTime: outputTime,
          renderVersion: renderVersionRef.current,
          frameToken: outputFrameToken,
        };
      }
      await new Promise(r => requestAnimationFrame(r));
    }

    await new Promise(r => requestAnimationFrame(r));
    const latestState = latestStateRef.current;
    return {
      renderedTime: latestState.outputTime ?? null,
      renderVersion: renderVersionRef.current,
      frameToken: latestState.outputFrameToken ?? 0,
    };
  }, [gifFps]);

  const waitForVideoSeekSettled = useCallback(async (
    vid: HTMLVideoElement,
    targetTime: number,
    expectedFrameMs = 1000 / Math.max(1, gifFps),
  ) => {
    if (Math.abs((vid.currentTime || 0) - targetTime) > 0.0005) {
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          vid.removeEventListener("seeked", onSeeked);
          resolve();
        };
        vid.addEventListener("seeked", onSeeked);
        vid.currentTime = targetTime;
      });
    }

    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    if ("requestVideoFrameCallback" in vid) {
      await Promise.race([
        new Promise<void>((resolve) => {
          const callbackId = (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.(() => resolve());
          window.setTimeout(() => {
            if (typeof (vid as VideoFrameCallbackVideo).cancelVideoFrameCallback === "function" && callbackId != null) {
              try {
                (vid as VideoFrameCallbackVideo).cancelVideoFrameCallback?.(callbackId);
              } catch {
                // ignore cancel races
              }
            }
            resolve();
          }, Math.max(32, Math.round(expectedFrameMs * 2)));
        }),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, Math.max(32, Math.round(expectedFrameMs * 2)));
        }),
      ]);
    }
  }, [gifFps]);

  const createHiddenExportVideo = useCallback(async (video: HTMLVideoElement) => {
    const source = (video as SourceVideoWithObjectUrl).__objectUrl || video.currentSrc || video.src;
    if (!source) {
      throw new Error("No source video URL is available for export.");
    }

    const clone = document.createElement("video");
    clone.muted = true;
    clone.playsInline = true;
    clone.preload = "auto";
    clone.crossOrigin = "anonymous";
    clone.src = source;

    await new Promise<void>((resolve, reject) => {
      const onLoadedMetadata = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Failed to initialize export video source."));
      };
      const cleanup = () => {
        clone.removeEventListener("loadedmetadata", onLoadedMetadata);
        clone.removeEventListener("error", onError);
      };
      clone.addEventListener("loadedmetadata", onLoadedMetadata);
      clone.addEventListener("error", onError);
      clone.load();
    });

    return clone;
  }, []);

  const normalizeGifFrames = useCallback((framesToNormalize: { data: Uint8ClampedArray; width: number; height: number; delay: number }[]) => {
    const normalized: { data: Uint8ClampedArray; width: number; height: number; delay: number }[] = [];

    for (const frame of framesToNormalize) {
      const normalizedDelay = quantizeGifDelay(frame.delay);
      const previous = normalized[normalized.length - 1];
      if (
        previous &&
        previous.width === frame.width &&
        previous.height === frame.height &&
        areFrameBuffersEqual(previous.data, frame.data)
      ) {
        previous.delay = quantizeGifDelay(previous.delay + normalizedDelay);
        continue;
      }
      normalized.push({
        data: new Uint8ClampedArray(frame.data),
        width: frame.width,
        height: frame.height,
        delay: normalizedDelay,
      });
    }

    return normalized;
  }, []);

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

  const download = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // -- Image export --

  const handleSave = useCallback(() => {
    const c = getScaledCanvas();
    if (!c) return;
    const mimeType = `image/${format}`;
    c.toBlob(
      blob => { if (blob) download(blob, makeFilename(format)); },
      mimeType,
      format === "png" ? undefined : quality
    );
  }, [getScaledCanvas, format, quality]);

  const handleCopy = useCallback(async () => {
    const c = getScaledCanvas();
    if (!c) return;
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        c.toBlob(b => (b ? resolve(b) : reject()), "image/png");
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // clipboard not available or denied
    }
  }, [getScaledCanvas]);

  // -- WebM recording --

  const handleRecord = useCallback(() => {
    if (capturing) {
      // Stop recorder first — this triggers ondataavailable then onstop
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
    const stream = fps != null ? source.captureStream(fps) : source.captureStream();
    streamRef.current = stream;

    // Mix audio from video source if available
    if (state.video && includeVideoAudio) {
      const vid = state.video as VideoFrameCallbackVideo;
      if (vid.captureStream) {
        const vidStream = fps != null ? vid.captureStream(fps) : vid.captureStream();
        if (vidStream) {
          vidStream.getAudioTracks().forEach((t: MediaStreamTrack) => stream.addTrack(t.clone()));
        }
      }
    }

    const recorderOpts: MediaRecorderOptions = {
      mimeType: activeRecFormat?.mimeType || "video/webm",
    };
    if (!autoBitrate) {
      recorderOpts.videoBitsPerSecond = bitrate * 1_000_000;
    }
    const recorder = new MediaRecorder(stream, recorderOpts);
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = e => chunksRef.current.push(e.data);
    recorder.onstop = () => {
      // Stop tracks after recorder has flushed all data
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const blob = new Blob(chunksRef.current, { type: activeRecFormat?.mimeType || "video/webm" });
      setRecordedBlob(blob);
      setRecordedUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      clearProgress();
    };

    recorder.start(100); // timeslice: flush data every 100ms
    setCapturing(true);
    setRecordingTime(0);
    setRecordedBlob(null);
    clearProgress();
    timerRef.current = window.setInterval(() => {
      setRecordingTime(t => t + 1);
    }, 1000);
  }, [capturing, outputCanvasRef, state.video, includeVideoAudio, activeRecFormat, bitrate, autoBitrate, autoRecordFps, recordFps, clearProgress]);

  const handleSaveVideo = useCallback(() => {
    if (!recordedBlob) return;
    const ext = recordedBlob.type.includes("mp4")
      ? "mp4"
      : recordedBlob.type.includes("webm")
        ? "webm"
        : (activeRecFormat?.ext || "webm");
    download(recordedBlob, makeFilename(ext));
  }, [recordedBlob, activeRecFormat]);

  const handleCopyVideo = useCallback(async () => {
    if (!recordedBlob) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ [recordedBlob.type]: recordedBlob }),
      ]);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.warn("Video clipboard copy failed (browser may not support video mime type):", err);
    }
  }, [recordedBlob]);

  const handleSaveGif = useCallback(() => {
    if (gifBlob) download(gifBlob, makeFilename("gif"));
  }, [gifBlob]);

  const handleCopyGif = useCallback(async () => {
    if (!gifBlob) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ [gifBlob.type]: gifBlob }),
      ]);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.warn("GIF clipboard copy failed:", err);
    }
  }, [gifBlob]);

  const handleSaveSequence = useCallback(() => {
    if (sequenceBlob) download(sequenceBlob, makeFilename("zip"));
  }, [sequenceBlob]);

  const handleCopySequence = useCallback(async () => {
    if (!sequenceBlob) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ [sequenceBlob.type]: sequenceBlob }),
      ]);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.warn("Sequence clipboard copy failed:", err);
    }
  }, [sequenceBlob]);

  const handleAbortExport = useCallback(() => {
    exportAbortRef.current = true;
    updateProgress("Stopping...", null);
  }, [updateProgress]);

  // Record exactly one loop of the source video, starting from t=0
  const handleRecordLoop = useCallback(() => {
    const vid = state.video as HTMLVideoElement | null;
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
      setRecordedBlob(null);
      setRecordedUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      updateProgress("Preparing reliable offline render...", 0.02);

      const run = async () => {
        const scaled = getScaledCanvas();
        if (!scaled) {
          throw new Error("Reliable export requires a rendered output canvas.");
        }

        const support = await getReliableVideoSupport(scaled.width, scaled.height, reliableFps, includeAudio);
        if (!support.supported) {
          throw new Error(support.reason || "Reliable offline video export is unavailable in this browser.");
        }

        const estimatedFrameCount = Math.max(1, Math.ceil(exportDurationSec * Math.max(1, reliableFps)));
        updateProgress(`Preparing reliable offline render (${estimatedFrameCount} frames at ${reliableFps} fps${reliableScope === "range" ? `, ${rangeStartSec.toFixed(2)}s-${rangeEndSec.toFixed(2)}s` : ""})...`, 0.04);

        const encoder = await createOfflineVideoEncoder({
          width: scaled.width,
          height: scaled.height,
          fps: reliableFps,
          durationUs: Math.round(exportDurationSec * 1_000_000),
          sourceVideo: vid,
          includeAudio,
          isAborted: () => exportAbortRef.current,
          onProgress: (message) => updateProgress(message, 0.92),
        });

        try {
          let renderResult: {
            aborted: boolean;
            frameCount: number;
            metrics: { seekMs: number; captureMs: number; encodeMs: number };
            sourcePath: "browser-seek" | "webcodecs";
            fallbackReason?: string;
          };

          const sourceUrl = (vid as SourceVideoWithObjectUrl).__objectUrl || vid.currentSrc || vid.src;
          const routingPlan = planReliableVideoRouting({
            preferredMode: videoLoopMode,
            sourceUrl: sourceUrl || null,
            hasVideoDecoder: typeof VideoDecoder !== "undefined",
          });
          if (routingPlan.shouldAttemptWebCodecs) {
            const exportSessionId = crypto.randomUUID();
            try {
              const timeline = buildDecodedTimeline(vid.duration, reliableFps, rangeStartSec, rangeEndSec);
              const decodeStartedAt = performance.now();
              const decoded = await decodeTimelineFramesWithWebCodecs({
                source: sourceUrl,
                timeline,
                isAborted: () => exportAbortRef.current,
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
                if (exportAbortRef.current) break;
                const timelineFrame = timeline[i];
                const decodedFrame = decoded.frames[i];
                updateProgress(
                  `Rendering frame ${i + 1}/${decoded.frames.length} (${timelineFrame.timeSec.toFixed(2)}s / ${rangeEndSec.toFixed(2)}s)`,
                  0.1 + ((i + 1) / Math.max(1, decoded.frames.length)) * 0.76,
                );
                sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
                sourceCtx.drawImage(decodedFrame.frame, 0, 0, sourceCanvas.width, sourceCanvas.height);
                const rendered = actions.renderFrameForExport(sourceCanvas, {
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
                aborted: exportAbortRef.current,
                frameCount: decoded.frames.length,
                metrics: { seekMs: Math.round(seekMs), captureMs: Math.round(captureMs), encodeMs: 0 },
                sourcePath: "webcodecs",
              };
            } catch (error) {
              console.warn("Reliable WebCodecs source path failed, falling back to browser seek:", error);
              const fallbackReason = error instanceof Error ? error.message : String(error);
              const fallbackRenderResult = await renderOfflineFrames({
                video: vid,
                fps: reliableFps,
                startTimeSec: rangeStartSec,
                endTimeSec: rangeEndSec,
                getFrameCanvas: getScaledCanvas,
                waitForFrame: (video, time, frameMs) =>
                  waitForRenderedSeek(video, time, frameMs, reliableStrictValidation, reliableSettleFrames),
                isAborted: () => exportAbortRef.current,
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
              actions.clearExportSession(exportSessionId);
            }
          } else {
            const fallbackRenderResult = await renderOfflineFrames({
              video: vid,
              fps: reliableFps,
              startTimeSec: rangeStartSec,
              endTimeSec: rangeEndSec,
              getFrameCanvas: getScaledCanvas,
              waitForFrame: (video, time, frameMs) =>
                waitForRenderedSeek(video, time, frameMs, reliableStrictValidation, reliableSettleFrames),
              isAborted: () => exportAbortRef.current,
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
              ...(routingPlan.fallbackReason
                ? { fallbackReason: routingPlan.fallbackReason }
                : {}),
            };
          }

          if (renderResult.aborted || exportAbortRef.current) {
            if (renderResult.frameCount === 0) {
              encoder.dispose();
              logReliableRenderProfile("aborted-before-first-frame", {
                sourceDecode: videoLoopMode,
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
              return { blob: null, aborted: true, audioIncluded: encoder.audioIncluded, audioUnavailableReason: encoder.audioUnavailableReason };
            }
            updateProgress("Finalizing partial preview...", 0.97);
            const finalized = await encoder.finalize();
            logReliableRenderProfile("aborted-partial", {
              sourceDecode: videoLoopMode,
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
            return { blob: finalized.blob, aborted: true, audioIncluded: encoder.audioIncluded, audioUnavailableReason: encoder.audioUnavailableReason };
          }

          updateProgress(encoder.audioIncluded ? "Encoding video + audio..." : "Encoding video...", 0.92);
          const finalized = await encoder.finalize();
          logReliableRenderProfile("completed", {
            sourceDecode: videoLoopMode,
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
          return { blob: finalized.blob, aborted: false, audioIncluded: encoder.audioIncluded, audioUnavailableReason: encoder.audioUnavailableReason };
        } catch (error) {
          encoder.dispose();
          throw error;
        }
      };

      run()
        .then((result) => {
          if (!result?.blob) {
            updateProgress("Reliable render stopped.", null);
            return;
          }
          setRecordedBlob(result.blob);
          setRecordedUrl(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(result.blob);
          });
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

    const startRecording = () => {
      const fps = autoRecordFps ? undefined : recordFps;
      const stream = fps != null ? source.captureStream(fps) : source.captureStream();
      streamRef.current = stream;

      // Mix audio
      if (includeVideoAudio && (vid as VideoFrameCallbackVideo).captureStream) {
        const vidStream = fps != null
          ? (vid as VideoFrameCallbackVideo).captureStream?.(fps)
          : (vid as VideoFrameCallbackVideo).captureStream?.();
        if (vidStream) {
          vidStream.getAudioTracks().forEach((t: MediaStreamTrack) => stream.addTrack(t.clone()));
        }
      }

      const recorderOpts: MediaRecorderOptions = {
        mimeType: activeRecFormat?.mimeType || "video/webm",
      };
      if (!autoBitrate) recorderOpts.videoBitsPerSecond = bitrate * 1_000_000;
      const recorder = new MediaRecorder(stream, recorderOpts);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = e => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: activeRecFormat?.mimeType || "video/webm" });
        setRecordedBlob(blob);
        setRecordedUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setCapturing(false);
      };

      recorder.start(100);
      setCapturing(true);
      setRecordingTime(0);
      setRecordedBlob(null);
      timerRef.current = window.setInterval(() => setRecordingTime(t => t + 1), 1000);

      // Auto-stop after one loop. Use timeupdate to detect wrap-around as a backup.
      const durationMs = (vid.duration / (vid.playbackRate || 1)) * 1000;
      const startedAt = performance.now();
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        vid.removeEventListener("timeupdate", onTimeUpdate);
        if (recorder.state !== "inactive") recorder.stop();
      };
      const onTimeUpdate = () => {
        // Detect loop: currentTime jumps back near 0 after playing for a bit
        if (performance.now() - startedAt > 500 && vid.currentTime < 0.1) {
          stop();
        }
      };
      vid.addEventListener("timeupdate", onTimeUpdate);
      window.setTimeout(stop, durationMs + 200);
    };

    // Pause, rewind to t=0, wait for seek + canvas to catch up, then play & record
    const wasPaused = vid.paused;
    vid.pause();
    const onSeeked = () => {
      vid.removeEventListener("seeked", onSeeked);
      // Give the filter pipeline a couple of rAF ticks to render the new frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          startRecording();
          vid.play().catch(() => {});
        });
      });
    };
    vid.addEventListener("seeked", onSeeked);
    if (vid.currentTime === 0) {
      // Already at start — fire onSeeked manually since setting currentTime=0 won't trigger seeked
      onSeeked();
    } else {
      vid.currentTime = 0;
    }
    // Suppress unused-var warning
    void wasPaused;
  }, [state.video, includeVideoAudio, capturing, outputCanvasRef, activeRecFormat, bitrate, autoBitrate, autoRecordFps, recordFps, videoLoopMode, exporting, handleAbortExport, estimateVideoFps, getScaledCanvas, waitForRenderedSeek, logReliableRenderProfile, setManualPause, reliableStrictValidation, reliableMaxFps, reliableSettleFrames, reliableScope, reliableRangeStart, reliableRangeEnd, updateProgress, actions]);

  // -- GIF export --

  const handleExportGif = useCallback(async () => {
    const source = outputCanvasRef.current;
    if (!source) return;

    exportAbortRef.current = false;
    setExporting(true);
    setGifBlob(null);
    setGifResultLabel(null);
    setGifUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    const delay = quantizeGifDelay(1000 / gifFps);
    const capturedFrames: { data: Uint8ClampedArray; width: number; height: number }[] = [];
    const captureStartedAt = performance.now();
    let aborted = false;

    for (let i = 0; i < frames; i++) {
      if (exportAbortRef.current) {
        aborted = true;
        break;
      }
      const elapsedMs = performance.now() - captureStartedAt;
      const avgMs = i > 0 ? elapsedMs / i : 0;
      const etaMs = i > 0 ? avgMs * (frames - i) : 0;
      updateProgress(`Capturing frame ${i + 1}/${frames}${i > 0 ? ` · ETA ${formatEta(etaMs)}` : ""}`, ((i + 1) / Math.max(1, frames)) * 0.86);
      await new Promise(r => requestAnimationFrame(r));
      const scaled = getScaledCanvas()!;
      const ctx = scaled.getContext("2d")!;
      const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);
      capturedFrames.push({ data: imageData.data, width: scaled.width, height: scaled.height });
    }

    if (capturedFrames.length === 0) {
      setExporting(false);
      clearProgress();
      return;
    }

    const normalizedFrames = normalizeGifFrames(
      capturedFrames.map(f => ({
        data: f.data,
        width: f.width,
        height: f.height,
        delay,
      }))
    );

    updateProgress(`Encoding GIF (${normalizedFrames.length} frame${normalizedFrames.length === 1 ? "" : "s"}${aborted ? ", partial" : ""})...`, 0.94);
    try {
      const { encode } = await import("modern-gif");
      const colorTable = gifPaletteSource === "filter" ? gifFilterPalette : null;
        const output = await encode({
          width: normalizedFrames[0].width,
          height: normalizedFrames[0].height,
          frames: normalizedFrames.map(f => ({
          data: toGifBuffer(f.data),
          delay: f.delay,
        })),
          ...(colorTable ? { colorTable } : {}),
        });
      const blob = new Blob([output], { type: "image/gif" });
      setGifBlob(blob);
      setGifUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setGifResultLabel(aborted ? `Partial GIF preview ready (${capturedFrames.length} captured).` : "GIF ready to save or copy.");
    } catch (err) {
      console.error("GIF export failed:", err);
    }

    exportAbortRef.current = false;
    setExporting(false);
    clearProgress();
  }, [outputCanvasRef, getScaledCanvas, frames, gifFps, gifPaletteSource, gifFilterPalette, updateProgress, clearProgress, normalizeGifFrames]);

  // Record exactly one source-video loop. Output format: "gif" or "sequence".
  // If loopAutoFps is on, use requestVideoFrameCallback for native source framerate.
  const handleExportLoop = useCallback(async (mode: "gif" | "sequence") => {
    const vid = state.video as HTMLVideoElement | null;
    if (!vid) return;
    const source = outputCanvasRef.current;
    if (!source) return;
    const rangeStartSec = loopExportScope === "range"
      ? Math.max(0, Math.min(vid.duration, loopRangeStart))
      : 0;
    const rangeEndSec = loopExportScope === "range"
      ? Math.max(rangeStartSec + 0.001, Math.min(vid.duration, loopRangeEnd))
      : vid.duration;
    const exportDuration = Math.max(0.001, rangeEndSec - rangeStartSec);

    exportAbortRef.current = false;
    setExporting(true);
    updateProgress(loopExportScope === "range" ? `Seeking start (${rangeStartSec.toFixed(2)}s)...` : "Rewinding...", 0.04);
    if (mode === "gif") {
      setGifBlob(null);
      setGifResultLabel(null);
      setGifUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } else {
      setSequenceBlob(null);
    }

    // Pause + seek to start
    vid.pause();
    if (Math.abs((vid.currentTime || 0) - rangeStartSec) > 0.0005) {
      await new Promise<void>(resolve => {
        const onSeeked = () => { vid.removeEventListener("seeked", onSeeked); resolve(); };
        vid.addEventListener("seeked", onSeeked);
        vid.currentTime = rangeStartSec;
      });
    }
    // Wait a couple of rAF ticks for the filter pipeline to render the t=0 frame
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    const capturedFrames: { data: Uint8ClampedArray; width: number; height: number; delay: number }[] = [];
    const duration = rangeEndSec;
    const captureFps = loopAutoFps ? estimateVideoFps(vid, gifFps) : gifFps;
    const sourceUrl = (vid as SourceVideoWithObjectUrl).__objectUrl || vid.currentSrc || vid.src;
    const loopRoutingPlan = planLoopCaptureRouting({
      captureMode: loopCaptureMode,
      sourceUrl: sourceUrl || null,
      hasVideoDecoder: typeof VideoDecoder !== "undefined",
    });
    const usePlaybackCapture = loopRoutingPlan.usesPlaybackCapture;
    const useWebCodecsCapture = loopRoutingPlan.shouldAttemptWebCodecs;
    const useVFC = usePlaybackCapture && loopAutoFps && "requestVideoFrameCallback" in vid;
    let aborted = false;
    const gifProfile = mode === "gif" ? {
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
      const exportSessionId = crypto.randomUUID();

      try {
        let renderedViaWebCodecs = false;
        if (useWebCodecsCapture && sourceUrl) {
          let decodedFramesToClose: { frame: VideoFrame }[] = [];
          try {
            const timeline = buildDecodedTimeline(vid.duration, captureFps, rangeStartSec, rangeEndSec);
            const decoded = await decodeTimelineFramesWithWebCodecs({
              source: sourceUrl,
              timeline,
              isAborted: () => exportAbortRef.current,
              onProgress: ({ message, fraction }) => updateProgress(message, fraction ?? 0.08),
            });
            if (gifProfile) {
              gifProfile.path = "webcodecs-demux";
              gifProfile.fallbackReason = "";
              gifProfile.decodeLoadMs = Math.round(decoded.metrics.loadMs);
              gifProfile.decodeConfigMs = Math.round(decoded.metrics.configMs);
              gifProfile.demuxMs = Math.round(decoded.metrics.demuxMs);
              gifProfile.decodeMs = Math.round(decoded.metrics.decodeMs);
              gifProfile.decodedChunks = decoded.metrics.decodedChunks;
              gifProfile.decodedFrames = decoded.frames.length;
              gifProfile.selectedFrames = decoded.frames.length;
            }
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

            for (let i = 0; i < decoded.frames.length; i += 1) {
              if (exportAbortRef.current) {
                aborted = true;
                break;
              }
              const decodedFrame = decoded.frames[i];
              const timelineFrame = timeline[i];
              const elapsedMs = performance.now() - renderStartedAt;
              const avgMs = i > 0 ? elapsedMs / i : 0;
              const etaMs = i > 0 ? avgMs * (decoded.frames.length - i) : null;
              updateProgress(
                `Rendering ${i + 1}/${decoded.frames.length} (${timelineFrame.timeSec.toFixed(2)}s / ${duration.toFixed(2)}s)${etaMs ? ` · ETA ${formatEta(etaMs)}` : ""}`,
                0.08 + ((i + 1) / Math.max(1, decoded.frames.length)) * 0.72,
              );
              sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
              sourceCtx.drawImage(decodedFrame.frame, 0, 0, sourceCanvas.width, sourceCanvas.height);
              const rendered = actions.renderFrameForExport(sourceCanvas, {
                sessionId: exportSessionId,
                time: timelineFrame.timeSec,
                video: null,
              });
              if (!rendered) {
                throw new Error(`Failed to render WebCodecs-decoded ${mode} frame.`);
              }
              scaledCtx.imageSmoothingEnabled = false;
              scaledCtx.clearRect(0, 0, scaledCanvas.width, scaledCanvas.height);
              scaledCtx.drawImage(rendered, 0, 0, scaledCanvas.width, scaledCanvas.height);
              const imageData = scaledCtx.getImageData(0, 0, scaledCanvas.width, scaledCanvas.height);
              capturedFrames.push({
                data: new Uint8ClampedArray(imageData.data),
                width: scaledCanvas.width,
                height: scaledCanvas.height,
                delay: quantizeGifDelay(timelineFrame.durationUs / 1000),
              });
            }
            if (gifProfile) {
              gifProfile.renderMs = Math.round(performance.now() - renderStartedAt);
            }
            renderedViaWebCodecs = true;
          } catch (error) {
            if (gifProfile) {
              gifProfile.fallbackReason = error instanceof Error ? error.message : String(error);
            }
            console.warn(`WebCodecs demux ${mode.toUpperCase()} path failed, falling back to hidden export video:`, error);
          } finally {
            decodedFramesToClose.forEach(({ frame }) => frame.close());
          }
        } else if (useWebCodecsCapture && !sourceUrl) {
          if (gifProfile) {
            gifProfile.fallbackReason = "No source URL available for WebCodecs demux.";
          }
        } else if (useWebCodecsCapture) {
          if (gifProfile) {
            gifProfile.fallbackReason = "WebCodecs VideoDecoder is unavailable in this browser.";
          }
        }

        if (!renderedViaWebCodecs) {
          const exportVideo = await createHiddenExportVideo(vid);
          try {
            const sourceCanvas = document.createElement("canvas");
            sourceCanvas.width = exportVideo.videoWidth || source.width;
            sourceCanvas.height = exportVideo.videoHeight || source.height;
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
                const rendered = actions.renderFrameForExport(sourceCanvas, {
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
              isAborted: () => exportAbortRef.current,
              onProgress: ({ frameIndex, frameCount, targetTime, etaMs }) => {
                updateProgress(
                  `Rendering ${frameIndex + 1}/${frameCount} (${targetTime.toFixed(2)}s / ${duration.toFixed(2)}s)${etaMs ? ` · ETA ${formatEta(etaMs)}` : ""}`,
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
            if (gifProfile) {
              gifProfile.renderMs = Math.round(performance.now() - renderStartedAt);
              gifProfile.selectedFrames = capturedFrames.length;
            }
          } finally {
            exportVideo.pause();
            exportVideo.removeAttribute("src");
            exportVideo.load();
          }
        }
      } finally {
        actions.clearExportSession(exportSessionId);
      }

    }

    const captureFrame = () => {
      const scaled = getScaledCanvas();
      if (!scaled) return;
      const ctx = scaled.getContext("2d")!;
      const imageData = ctx.getImageData(0, 0, scaled.width, scaled.height);
      capturedFrames.push({
        data: imageData.data,
        width: scaled.width,
        height: scaled.height,
        delay: quantizeGifDelay(1000 / Math.max(1, gifFps)),
      });
    };

    const commitDelayToPreviousFrame = (delayMs: number) => {
      if (capturedFrames.length === 0) return;
      capturedFrames[capturedFrames.length - 1].delay = quantizeGifDelay(delayMs);
    };

    if (usePlaybackCapture) {
      const intervalMs = 1000 / Math.max(1, captureFps);
      const sampleCount = Math.max(1, Math.ceil(exportDuration * Math.max(1, captureFps)));
      const captureStartedAt = performance.now();

      for (let i = 0; i < sampleCount; i += 1) {
        if (exportAbortRef.current) {
          aborted = true;
          break;
        }
        const targetTime = Math.min(duration - 0.0005, rangeStartSec + (i / Math.max(1, captureFps)));
        const elapsedMs = performance.now() - captureStartedAt;
        const avgMs = i > 0 ? elapsedMs / i : 0;
        const etaMs = i > 0 ? avgMs * (sampleCount - i) : 0;
        updateProgress(`Capturing ${i + 1}/${sampleCount} (${targetTime.toFixed(2)}s / ${duration.toFixed(2)}s)${i > 0 ? ` · ETA ${formatEta(etaMs)}` : ""}`, 0.08 + ((i + 1) / Math.max(1, sampleCount)) * 0.72);
        await waitForRenderedSeek(vid, targetTime, intervalMs);
        if (capturedFrames.length > 0) {
          commitDelayToPreviousFrame(intervalMs);
        }
        captureFrame();
      }
      const coveredMs = Math.max(0, (sampleCount - 1) * intervalMs);
      commitDelayToPreviousFrame(Math.max(10, exportDuration * 1000 - coveredMs));
    } else {
      captureFrame();

      await new Promise<void>(resolve => {
        let lastMediaTime = 0;
        let lastCapturedRenderedTime = rangeStartSec;
        let lastCapturedRenderVersion = renderVersionRef.current;
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
            if (lastMediaTime > 0 && Number.isFinite(duration) && duration > lastMediaTime) {
              commitDelayToPreviousFrame((duration - lastMediaTime) * 1000);
            }
            vid.pause();
            resolve();
          }
        };

        if (useVFC) {
          // Native framerate path: requestVideoFrameCallback fires per decoded frame
          const onFrame = async (_now: number, metadata: VideoFrameMetadata) => {
            if (stopped) return;
            if (exportAbortRef.current) {
              aborted = true;
              stop();
              return;
            }
            const t = metadata.mediaTime;
            if (t == null) {
              if (!stopped) (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
              return;
            }
            if (t < lastMediaTime - 0.05 || t >= duration) {
              stop();
              return;
            }
            if (t <= 0.001 && lastMediaTime === 0) {
              if (!stopped) (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
              return;
            }
            if (lastMediaTime > 0) {
              commitDelayToPreviousFrame((t - lastMediaTime) * 1000);
            }
            lastMediaTime = t;
            const previousRenderVersion = renderVersionRef.current;
            const rendered = await waitForRenderedPlaybackFrame(t, previousRenderVersion, 1000 / Math.max(1, gifFps));
            if (stopped || exportAbortRef.current) {
              if (exportAbortRef.current) {
                aborted = true;
                stop();
              }
              return;
            }
            if (!rendered || rendered.renderedTime == null) {
              if (!stopped) (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
              return;
            }
            if (rendered.renderVersion <= lastCapturedRenderVersion || rendered.renderedTime <= lastCapturedRenderedTime + 0.0005) {
              if (!stopped) (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
              return;
            }
            const capturedCount = Math.max(1, capturedFrames.length);
            const elapsedMs = performance.now() - captureStartedAt;
            const avgMs = elapsedMs / capturedCount;
            const approxRemaining = Math.max(0, duration - t);
            const etaMs = duration > 0 ? avgMs * ((approxRemaining / duration) * Math.max(1, capturedCount)) : 0;
            const playbackProgress = exportDuration > 0 ? Math.min(1, Math.max(0, (t - rangeStartSec) / exportDuration)) : 0;
            updateProgress(`Capturing ${capturedFrames.length + 1} (${t.toFixed(2)}s / ${duration.toFixed(2)}s)${capturedFrames.length > 0 ? ` · ETA ${formatEta(etaMs)}` : ""}`, 0.08 + playbackProgress * 0.72);
            captureFrame();
            lastCapturedRenderedTime = rendered.renderedTime;
            lastCapturedRenderVersion = rendered.renderVersion;
            if (!stopped) (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
          };
          (vid as VideoFrameCallbackVideo).requestVideoFrameCallback?.(onFrame);
        } else {
          const fps = gifFps;
          const intervalMs = Math.round(1000 / fps);
          let lastTime = vid.currentTime;
          handle = window.setInterval(async () => {
            if (stopped || capturePending) return;
            if (exportAbortRef.current) {
              aborted = true;
              stop();
              return;
            }
            if (vid.currentTime < lastTime - 0.05 || vid.currentTime >= duration) {
              stop();
              return;
            }
            const currentTime = vid.currentTime;
            if (currentTime <= lastTime + 0.0005) return;
            commitDelayToPreviousFrame((currentTime - lastTime) * 1000);
            lastTime = currentTime;
            capturePending = true;
            const previousRenderVersion = renderVersionRef.current;
            const rendered = await waitForRenderedPlaybackFrame(currentTime, previousRenderVersion, intervalMs);
            capturePending = false;
            if (stopped || exportAbortRef.current) {
              if (exportAbortRef.current) {
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
            const approxRemaining = Math.max(0, duration - currentTime);
            const etaMs = duration > 0 ? avgMs * ((approxRemaining / duration) * Math.max(1, capturedCount)) : 0;
            const playbackProgress = exportDuration > 0 ? Math.min(1, Math.max(0, (currentTime - rangeStartSec) / exportDuration)) : 0;
            updateProgress(`Capturing ${capturedFrames.length + 1} (${vid.currentTime.toFixed(2)}s / ${duration.toFixed(2)}s)${capturedFrames.length > 0 ? ` · ETA ${formatEta(etaMs)}` : ""}`, 0.08 + playbackProgress * 0.72);
            captureFrame();
            lastCapturedRenderedTime = rendered.renderedTime;
            lastCapturedRenderVersion = rendered.renderVersion;
          }, intervalMs);
        }

        if (rangeStartSec > 0) {
          lastMediaTime = rangeStartSec;
        }
        vid.play().catch(() => {});
        stopTimeout = window.setTimeout(stop, (exportDuration / (vid.playbackRate || 1)) * 1000 + 500);
      });
    }

    if (capturedFrames.length === 0) {
      setExporting(false);
      clearProgress();
      return;
    }

    if (mode === "gif") {
      const normalizedFrames = normalizeGifFrames(capturedFrames);
      updateProgress(`Encoding GIF (${normalizedFrames.length} frame${normalizedFrames.length === 1 ? "" : "s"}${aborted ? ", partial" : ""})...`, 0.9);
      try {
        const encodeStartedAt = performance.now();
        const { encode } = await import("modern-gif");
        const colorTable = gifPaletteSource === "filter" ? gifFilterPalette : null;
        const output = await encode({
          width: normalizedFrames[0].width,
          height: normalizedFrames[0].height,
          frames: normalizedFrames.map(f => ({
            data: toGifBuffer(f.data),
            delay: f.delay,
          })),
          ...(colorTable ? { colorTable } : {}),
        });
        const blob = new Blob([output], { type: "image/gif" });
        setGifBlob(blob);
        setGifUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setGifResultLabel(aborted ? `Partial GIF preview ready (${capturedFrames.length} captured).` : "GIF ready to save or copy.");
        if (gifProfile) {
          gifProfile.encodeMs = Math.round(performance.now() - encodeStartedAt);
          logGifExportProfile("completed", {
            path: gifProfile.path,
            ...(gifProfile.fallbackReason ? { fallbackReason: gifProfile.fallbackReason } : {}),
            fps: captureFps,
            selectedFrames: gifProfile.selectedFrames || capturedFrames.length,
            normalizedFrames: normalizedFrames.length,
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
        }
      } catch (err) {
        console.error("GIF loop export failed:", err);
      }
    } else {
      // Sequence: encode each frame as PNG and bundle into a zip
      const zipFiles: Record<string, Uint8Array> = {};
      for (let i = 0; i < capturedFrames.length; i++) {
        if (exportAbortRef.current) {
          setExporting(false);
          clearProgress();
          return;
        }
        updateProgress(`Encoding frame ${i + 1}/${capturedFrames.length}`, 0.82 + ((i + 1) / Math.max(1, capturedFrames.length)) * 0.12);
        const f = capturedFrames[i];
        const canvas = document.createElement("canvas");
        canvas.width = f.width;
        canvas.height = f.height;
        const ctx = canvas.getContext("2d")!;
        ctx.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), 0, 0);
        const blob = await new Promise<Blob | null>(resolve => {
          canvas.toBlob(b => resolve(b), "image/png");
        });
        if (blob) {
          zipFiles[`ditherer-seq-${String(i).padStart(4, "0")}.png`] = new Uint8Array(await blob.arrayBuffer());
        }
      }
      updateProgress(`Zipping ${Object.keys(zipFiles).length} frames...`, 0.96);
      try {
        if (exportAbortRef.current) {
          setExporting(false);
          clearProgress();
          return;
        }
        const zipped = zipSync(zipFiles, { level: 0 });
        setSequenceBlob(new Blob([new Uint8Array(zipped)], { type: "application/zip" }));
      } catch (err) {
        console.error("Sequence zip failed:", err);
      }
    }

    setExporting(false);
    clearProgress();
  }, [state.video, outputCanvasRef, getScaledCanvas, loopAutoFps, gifFps, loopCaptureMode, estimateVideoFps, waitForRenderedSeek, waitForRenderedPlaybackFrame, waitForVideoSeekSettled, loopExportScope, loopRangeStart, loopRangeEnd, gifPaletteSource, gifFilterPalette, updateProgress, clearProgress, normalizeGifFrames, mult, actions, logGifExportProfile]);

  // -- Sequence export --

  const handleExportSequence = useCallback(async () => {
    const source = outputCanvasRef.current;
    if (!source) return;

    exportAbortRef.current = false;
    setExporting(true);
    setSequenceBlob(null);

    const zipFiles: Record<string, Uint8Array> = {};

    for (let i = 0; i < frames; i++) {
      if (exportAbortRef.current) {
        setExporting(false);
        clearProgress();
        return;
      }
      updateProgress(`Capturing frame ${i + 1}/${frames}`, ((i + 1) / Math.max(1, frames)) * 0.86);
      await new Promise(r => requestAnimationFrame(r));
      const scaled = getScaledCanvas()!;
      const blob = await new Promise<Blob | null>(resolve => {
        scaled.toBlob(b => resolve(b), "image/png");
      });
      if (blob) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        zipFiles[`ditherer-seq-${String(i).padStart(4, "0")}.png`] = buf;
      }
    }

    updateProgress(`Zipping ${Object.keys(zipFiles).length} frames...`, 0.96);
    try {
      if (exportAbortRef.current) {
        setExporting(false);
        clearProgress();
        return;
      }
      // Store mode (level 0) — PNGs are already compressed, no point recompressing
      const zipped = zipSync(zipFiles, { level: 0 });
      // Copy into a fresh Uint8Array so the buffer is a plain ArrayBuffer (not SharedArrayBuffer)
      setSequenceBlob(new Blob([new Uint8Array(zipped)], { type: "application/zip" }));
    } catch (err) {
      console.error("Sequence zip failed:", err);
    }

    setExporting(false);
    clearProgress();
  }, [outputCanvasRef, getScaledCanvas, frames, updateProgress, clearProgress]);

  // -- Video tab export dispatch --

  const handleVideoExport = useCallback(() => {
    if (videoFormat === "gif") handleExportGif();
    else if (videoFormat === "sequence") handleExportSequence();
  }, [videoFormat, handleExportGif, handleExportSequence]);

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

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const ss = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  };

  const formatEta = (ms: number) => {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return mins > 0 ? `${mins}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;
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
            <>
              <div className={s.row}>
                <span className={s.rowLabel}>Format</span>
                <Enum
                  name="Format"
                  types={IMAGE_FORMAT_OPTIONS}
                  value={format}
                  hideLabel
                  onSetFilterOption={(_, v) => setFormat(String(v))}
                />
              </div>

              {format !== "png" && (
                <Range
                  name="Quality"
                  types={{ range: [0.01, 1] }}
                  step={0.01}
                  value={quality}
                  onSetFilterOption={(_, v) => setQuality(Number(v))}
                />
              )}

              <div className={s.row}>
                <span className={s.rowLabel}>Resolution</span>
                <div className={s.radioGroup}>
                  {["1", "2", "4"].map(v => (
                    <label key={v}>
                      <input
                        type="radio"
                        name="resolution"
                        value={v}
                        checked={resolution === v}
                        onChange={() => setResolution(v)}
                      />
                      {v}x
                    </label>
                  ))}
                  <label>
                    <input
                      type="radio"
                      name="resolution"
                      value="custom"
                      checked={resolution === "custom"}
                      onChange={() => setResolution("custom")}
                    />
                    Custom
                  </label>
                  {resolution === "custom" && (
                    <input
                      type="number"
                      className={s.customInput}
                      min={1}
                      max={8}
                      step={1}
                      value={customMultiplier}
                      onChange={e => setCustomMultiplier(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
                    />
                  )}
                </div>
              </div>

              <div className={s.dims}>
                {canvas?.width ?? 0} x {canvas?.height ?? 0} → {exportW} x {exportH}
              </div>

              {largeExport && (
                <div className={s.warning}>
                  Large export dimensions may fail or use excessive memory.
                </div>
              )}

              <div className={s.buttons}>
                <button className={s.btn} disabled={!canvasReady} onClick={handleSave}>
                  Save
                </button>
                {canWriteClipboard() && (
                  <button className={s.btn} disabled={!canvasReady} onClick={handleCopy}>
                    Copy to Clipboard
                    {copySuccess && <span className={s.copyFlash}> Copied!</span>}
                  </button>
                )}
              </div>
            </>
          )}

          {/* ---- Video Tab ---- */}
          {activeTab === "video" && (
            <div className={s.videoTab}>
              <div className={s.row}>
                <span className={s.rowLabel}>
                  Format
                  <span
                    className={s.inlineInfo}
                    title="Choose the export output type. Recording uses realtime capture, while GIF and sequence export sampled frames."
                  >
                    (i)
                  </span>
                </span>
                <div className={s.radioGroup}>
                  {videoFormatOptions.options.map((option) => (
                    <label key={option.value}>
                      <input
                        type="radio"
                        name="videoFormat"
                        value={option.value}
                        checked={videoFormat === option.value}
                        onChange={() => setVideoFormat(option.value)}
                      />
                      {option.name || option.value}
                    </label>
                  ))}
                </div>
              </div>

              {videoFormat === "recording" && (
                <>
                  {state.video && (
                    <>
                      <div className={s.row}>
                        <span className={s.rowLabel}>
                          Capture Mode
                          <span
                            className={s.inlineInfo}
                            title="Choose between realtime loop recording and deterministic reliable offline rendering."
                          >
                            (i)
                          </span>
                        </span>
                        <Enum
                          name="Capture Mode"
                          types={VIDEO_LOOP_MODE_OPTIONS}
                          value={videoLoopMode}
                          hideLabel
                          onSetFilterOption={(_, v) => setVideoLoopMode(v as "offline" | "realtime" | "webcodecs")}
                        />
                      </div>
                      <div className={s.helperText}>
                        {videoLoopMode === "realtime"
                          ? `Realtime recording is the fastest option. It captures the live filtered canvas${includeVideoAudio && state.videoVolume > 0 ? " and can keep source audio" : ""}, but can also reflect playback hiccups.`
                          : videoLoopMode === "offline"
                            ? (reliableVideoSupport?.supported
                                ? `Offline Render (Browser) is slower but steadier. It samples exact timestamps with browser seek and exports WebM${includeVideoAudio && state.videoVolume > 0 ? " with source audio" : ""} via WebCodecs.${reliableStrictValidation ? " Strict validation is slower but more conservative." : " Fast validation is on for quicker seeks."}`
                                : (reliableVideoSupport?.reason || "Offline Render (Browser) needs WebCodecs video encoding support in this browser."))
                            : (reliableVideoSupport?.supported
                                ? `Offline Render (WebCodecs) can be faster or slower depending on the source. It decodes source frames with WebCodecs before the offline render pass, then exports WebM${includeVideoAudio && state.videoVolume > 0 ? " with source audio" : ""}. It may fall back to the browser path if decode fails.`
                                : (reliableVideoSupport?.reason || "Offline Render (WebCodecs) needs WebCodecs video encoding support in this browser."))}
                      </div>
                      <div className={s.row}>
                        <span className={s.rowLabel}>
                          Audio
                          <span
                            className={s.inlineInfo}
                            title="Include or exclude audio from the source video in exported video files. This is separate from preview volume, so muted playback can still export audio."
                          >
                            (i)
                          </span>
                        </span>
                        <label className={s.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={includeVideoAudio}
                            disabled={!state.video}
                            onChange={e => setIncludeVideoAudio(e.target.checked)}
                          />
                          Include source audio
                        </label>
                      </div>
                      <div className={s.helperText}>
                        Preview volume and export audio are separate. You can mute playback and still include source audio in the final video.
                      </div>
                      {videoLoopMode !== "realtime" && reliableVideoSupport?.audio === false && includeVideoAudio && reliableVideoSupport?.supported && (
                        <div className={s.helperText}>
                          Source audio could not be verified for reliable export, so the render may fall back to silent video.
                        </div>
                      )}
                    </>
                  )}

                  {recordingFormats.length > 0 && (
                    <div className={s.row}>
                      <span className={s.rowLabel}>
                        Codec
                        <span
                          className={s.inlineInfo}
                          title="Select the browser-supported recording codec/container for realtime capture."
                        >
                          (i)
                        </span>
                      </span>
                      <Enum
                        name="Codec"
                        types={recFormatOptions}
                        value={activeRecFormat?.label || ""}
                        hideLabel
                        onSetFilterOption={(_, v) => {
                          const idx = recordingFormats.findIndex(f => f.label === v);
                          if (idx >= 0) setSelectedRecFormat(idx);
                        }}
                      />
                    </div>
                  )}

                  <div className={s.row}>
                    <span className={s.rowLabel}>
                      FPS
                      <span
                        className={s.inlineInfo}
                        title="Frames per second for export. Turn Auto off to choose a fixed FPS manually."
                      >
                        (i)
                      </span>
                    </span>
                    <div className={s.fpsControls}>
                      <label className={s.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={autoRecordFps}
                          onChange={e => setAutoRecordFps(e.target.checked)}
                        />
                        Auto
                      </label>
                      {state.video && videoLoopMode !== "realtime" && autoRecordFps && (
                        <div className={s.inlineSliderGroup}>
                          <span className={s.inlineSliderLabel}>
                            Max Encoding FPS
                            <span
                              className={s.inlineInfo}
                              title="When Auto FPS is on, reliable export uses the lower of the source-estimated FPS and this cap. Lower values speed up export by encoding fewer frames."
                            >
                              (i)
                            </span>
                          </span>
                          <div className={s.inlineSliderRow}>
                            <input
                              className={s.slider}
                              type="range"
                              min={6}
                              max={30}
                              step={1}
                              value={reliableMaxFps}
                              onChange={e => setReliableMaxFps(parseInt(e.target.value) || DEFAULT_RELIABLE_MAX_FPS)}
                            />
                            <span className={s.sliderValue}>{reliableMaxFps}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {!autoRecordFps && (
                    <Range
                      name="fps"
                      types={{ range: [1, 60] }}
                      step={1}
                      value={recordFps}
                      onSetFilterOption={(_, v) => setRecordFps(Number(v))}
                    />
                  )}

                  <div className={s.row}>
                    <span className={s.rowLabel}>
                      Bitrate
                      <span
                        className={s.inlineInfo}
                        title="Controls output quality and file size for realtime recording. Higher bitrate usually means larger files and fewer compression artifacts."
                      >
                        (i)
                      </span>
                    </span>
                    <label className={s.checkboxLabel}>
                      <input
                        type="checkbox"
                        checked={autoBitrate}
                        onChange={e => setAutoBitrate(e.target.checked)}
                      />
                      Auto
                      <span
                        className={s.inlineInfo}
                        title="When enabled, the browser chooses the recording bitrate automatically."
                      >
                        (i)
                      </span>
                    </label>
                  </div>
                  {!autoBitrate && (
                    <div className={s.row}>
                      <span className={s.rowLabel}>
                        Mbps
                        <span
                          className={s.inlineInfo}
                          title="Manual recording bitrate in megabits per second."
                        >
                          (i)
                        </span>
                      </span>
                      <div className={s.sliderRow}>
                        <input
                          className={s.slider}
                          type="range"
                          min={0.5}
                          max={20}
                          step={0.5}
                          value={bitrate}
                          onChange={e => setBitrate(parseFloat(e.target.value) || 0.5)}
                        />
                        <span className={s.sliderValue}>{bitrate}</span>
                      </div>
                    </div>
                  )}

                  {state.video && (
                    <>
                      {videoLoopMode !== "realtime" && (
                        <div className={s.row}>
                          <span className={s.rowLabel}>
                            Settle
                            <span
                              className={s.inlineInfo}
                              title="How many animation frames to wait after each seek before capturing. Lower is faster; higher is safer if you see wrong-frame captures."
                            >
                              (i)
                            </span>
                          </span>
                          <div className={s.sliderRow}>
                            <input
                              className={s.slider}
                              type="range"
                              min={1}
                              max={2}
                              step={1}
                              value={reliableSettleFrames}
                              onChange={e => setReliableSettleFrames(parseInt(e.target.value) || DEFAULT_RELIABLE_SETTLE_FRAMES)}
                            />
                            <span className={s.sliderValue}>{reliableSettleFrames}</span>
                          </div>
                        </div>
                      )}
                      {videoLoopMode !== "realtime" && (
                        <div className={s.row}>
                          <span className={s.rowLabel}>
                            Validation
                            <span
                              className={s.inlineInfo}
                              title={`Fast mode waits for \`seeked\` plus ${reliableSettleFrames} animation frame${reliableSettleFrames === 1 ? "" : "s"}. Turn strict validation on only if you see wrong-frame captures.`}
                            >
                              (i)
                            </span>
                          </span>
                          <label className={s.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={reliableStrictValidation}
                              onChange={e => setReliableStrictValidation(e.target.checked)}
                            />
                            Strict frame validation
                          </label>
                        </div>
                      )}
                      {videoLoopMode !== "realtime" && (
                        <div className={s.row}>
                          <span className={s.rowLabel}>
                            Export Range
                            <span
                              className={s.inlineInfo}
                              title="Choose whether reliable export covers the full loop or only a selected timestamp range."
                            >
                              (i)
                            </span>
                          </span>
                          <div className={s.radioGroup}>
                            {RELIABLE_SCOPE_OPTIONS.options.map((option) => (
                              <label key={option.value}>
                                <input
                                  type="radio"
                                  name="reliableExportRange"
                                  value={option.value}
                                  checked={reliableScope === option.value}
                                  onChange={() => setReliableScope(option.value as "loop" | "range")}
                                />
                                {option.name || option.value}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      {videoLoopMode !== "realtime" && reliableScope === "range" && state.video && (
                        <>
                          <div className={s.row}>
                            <span className={s.rowLabel}>
                              Start
                              <span
                                className={s.inlineInfo}
                                title="Start timestamp for reliable export."
                              >
                                (i)
                              </span>
                            </span>
                            <div className={s.sliderRow}>
                              <input
                                className={s.slider}
                                type="range"
                                min={0}
                                max={Math.max(0, state.video.duration || 0)}
                                step={0.01}
                                value={Math.min(reliableRangeStart, Math.max(0, reliableRangeEnd - 0.01))}
                                onChange={e => setReliableRangeStart(Math.min(parseFloat(e.target.value) || 0, Math.max(0, reliableRangeEnd - 0.01)))}
                              />
                              <span className={s.sliderValue}>{reliableRangeStart.toFixed(2)}</span>
                            </div>
                          </div>
                          <div className={s.row}>
                            <span className={s.rowLabel}>
                              End
                              <span
                                className={s.inlineInfo}
                                title="End timestamp for reliable export."
                              >
                                (i)
                              </span>
                            </span>
                            <div className={s.sliderRow}>
                              <input
                                className={s.slider}
                                type="range"
                                min={0.01}
                                max={Math.max(0.01, state.video.duration || 0)}
                                step={0.01}
                                value={Math.max(reliableRangeEnd, Math.min(state.video.duration || 0, reliableRangeStart + 0.01))}
                                onChange={e => setReliableRangeEnd(Math.max(parseFloat(e.target.value) || 0.01, Math.min((state.video?.duration || 0), reliableRangeStart + 0.01)))}
                              />
                              <span className={s.sliderValue}>{reliableRangeEnd.toFixed(2)}</span>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  <div className={s.buttons}>
                    {videoLoopMode === "realtime" && (
                      <button className={s.btn} disabled={exporting} onClick={handleRecord}>
                        {capturing ? "\u25A0 Stop" : "\u25CF Record"}
                      </button>
                    )}
                    {state.video && (
                      <button
                        className={s.btn}
                        disabled={capturing || (videoLoopMode !== "realtime" && !exporting && reliableVideoSupport?.supported === false)}
                        onClick={handleRecordLoop}
                        title={videoLoopMode === "realtime"
                          ? "Seek to start and record one full loop"
                          : (reliableVideoSupport?.reason || "Start offline rendering")}
                      >
                        {videoLoopMode === "realtime" ? "⟲ Record loop" : exporting ? "Stop render" : "Start rendering"}
                      </button>
                    )}
                  </div>
                  {capturing && (
                    <>
                      <div className={s.rec}>
                        ● REC {formatTime(recordingTime)}
                        {state.video && sourceDuration > 0 && (
                          <span className={s.sourceTimecode}>
                            {" "}· source {formatTime(Math.floor(sourceTime))} / {formatTime(Math.floor(sourceDuration))}
                          </span>
                        )}
                      </div>
                      {state.video && sourceDuration > 0 && (
                        <div className={s.seekbar}>
                          <div
                            className={s.seekbarFill}
                            style={{ width: `${Math.min(100, (sourceTime / sourceDuration) * 100)}%` }}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {(capturing || recordedUrl) && (
                    <video
                      ref={videoRef}
                      className={s.videoPreview}
                      controls={!capturing}
                      autoPlay
                      loop
                      playsInline
                    />
                  )}
                  <div className={s.buttons}>
                    <button className={s.btn} disabled={!recordedBlob} onClick={handleSaveVideo}>
                      Save
                    </button>
                    {canWriteClipboard() && (
                      <button className={s.btn} disabled={!recordedBlob} onClick={handleCopyVideo}>
                        Copy
                        {copySuccess && <span className={s.copyFlash}> Copied!</span>}
                      </button>
                    )}
                  </div>
                  {progress && (
                    <>
                      {progressValue != null && (
                        <div className={s.progressBar} aria-hidden="true">
                          <div
                            className={s.progressBarFill}
                            style={{ width: `${Math.max(0, Math.min(100, progressValue * 100))}%` }}
                          />
                        </div>
                      )}
                      <div className={s.progress}>{progress}</div>
                    </>
                  )}
                </>
              )}

              {(videoFormat === "gif" || videoFormat === "sequence") && (
                <>
                  {!state.video && (
                    <div className={s.row}>
                      <span className={s.rowLabel}>
                        Frames
                        <span
                          className={s.inlineInfo}
                          title="Number of frames to export when rendering from the current live output instead of a source video loop."
                        >
                          (i)
                        </span>
                      </span>
                      <div className={s.sliderRow}>
                        <input
                          className={s.slider}
                          type="range"
                          min={1}
                          max={120}
                          step={1}
                          value={frames}
                          onChange={e => setFrames(parseInt(e.target.value) || 1)}
                        />
                        <span className={s.sliderValue}>{frames}</span>
                      </div>
                    </div>
                  )}

                  <div className={s.row}>
                    <span className={s.rowLabel}>
                      Capture Mode
                      <span
                        className={s.inlineInfo}
                        title={videoFormat === "gif"
                          ? "Choose between realtime playback, Offline Render (Browser), or Offline Render (WebCodecs)."
                          : "Choose between realtime playback, Offline Render (Browser), or Offline Render (WebCodecs)."}
                      >
                        (i)
                      </span>
                    </span>
                    <Enum
                      name="Capture Mode"
                      types={LOOP_CAPTURE_MODE_OPTIONS}
                      value={loopCaptureMode}
                      hideLabel
                      onSetFilterOption={(_, v) => setLoopCaptureMode(v as "offline" | "realtime" | "webcodecs")}
                    />
                  </div>
                  <div className={s.row}>
                    <span className={s.rowLabel}>
                      FPS
                      <span
                        className={s.inlineInfo}
                        title={videoFormat === "gif"
                          ? "Frames per second for GIF export. Match source uses the source video's estimated cadence for offline frame sampling."
                          : "Frames per second for GIF or sequence export. Match source uses the source video's estimated cadence when exporting a loop."}
                      >
                        (i)
                      </span>
                    </span>
                    <div className={s.fpsControls}>
                      <label className={s.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={loopAutoFps}
                          onChange={e => setLoopAutoFps(e.target.checked)}
                        />
                        Match source
                      </label>
                    </div>
                  </div>
                  {!loopAutoFps && (
                    <div className={s.row}>
                      <span className={s.rowLabel}>Manual FPS</span>
                      <div className={s.sliderRow}>
                        <input
                          className={s.slider}
                          type="range"
                          min={1}
                          max={60}
                          step={1}
                          value={gifFps}
                          onChange={e => setGifFps(parseInt(e.target.value) || 1)}
                        />
                        <span className={s.sliderValue}>{gifFps}</span>
                      </div>
                    </div>
                  )}
                  <div className={s.helperText}>
                    {videoFormat === "gif"
                      ? (loopCaptureMode === "realtime"
                        ? "Realtime GIF export is the fastest option. It follows the visible player, but it is more likely to reflect playback hiccups or timing drift."
                        : loopCaptureMode === "offline"
                          ? "Offline Render (Browser) is slower but steadier. It samples source timestamps with browser seek, runs each frame through the offline renderer, and then encodes the GIF."
                          : "Offline Render (WebCodecs) can be faster or slower depending on the source. It decodes source frames with WebCodecs before the offline render pass, then encodes the GIF. It may fall back automatically if decode fails.")
                      : (loopCaptureMode === "realtime"
                        ? "Realtime playback is the fastest option. It follows the playing source and can use decoded frame callbacks when available, but it can still reflect playback hiccups."
                        : loopCaptureMode === "offline"
                          ? "Offline Render (Browser) is slower but steadier. It samples the loop at exact timestamps with browser seek and stays the default because it is the safer choice for matching a loop precisely."
                          : "Offline Render (WebCodecs) can be faster or slower depending on the source. It decodes source frames before the offline render pass and avoids relying on browser seek for source-frame access.")}
                    {loopAutoFps ? " Match source is on." : " Manual FPS is on."}
                  </div>
                  {videoFormat === "gif" && (
                    <>
                      <div className={s.row}>
                        <span className={s.rowLabel}>
                          Palette Source
                          <span
                            className={s.inlineInfo}
                            title="Auto builds a GIF palette from the offline-rendered export frames. Current filter palette reuses the active filter's explicit color list when available."
                          >
                            (i)
                          </span>
                        </span>
                        <Enum
                          name="Palette Source"
                          types={{
                            options: canUseGifFilterPalette
                              ? GIF_PALETTE_SOURCE_OPTIONS.options
                              : [GIF_PALETTE_SOURCE_OPTIONS.options[0]],
                          }}
                          value={canUseGifFilterPalette ? gifPaletteSource : "auto"}
                          hideLabel
                          onSetFilterOption={(_, v) => setGifPaletteSource(v as "filter" | "auto")}
                        />
                      </div>
                      <div className={s.helperText}>
                        {canUseGifFilterPalette
                          ? "Current filter palette is available, so the GIF can reuse your active palette instead of deriving one from the rendered frames."
                          : "No explicit filter palette is active right now, so GIF export will derive a palette from the offline-rendered frames."}
                      </div>
                      {canUseGifFilterPalette && (
                        <div className={s.palettePreview} title="GIF palette preview from the current filter palette.">
                          {gifPalettePreview.map((color, index) => (
                            <span
                              key={`${color.join("-")}-${index}`}
                              className={s.paletteSwatch}
                              style={{ backgroundColor: rgbToCss(color) }}
                              title={rgbToCss(color)}
                            />
                          ))}
                          {gifPaletteOverflow > 0 && (
                            <span className={s.paletteMore}>+{gifPaletteOverflow} more</span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {state.video && (
                    <div className={s.row}>
                      <span className={s.rowLabel}>
                        Export Range
                        <span
                          className={s.inlineInfo}
                          title={videoFormat === "gif"
                            ? "Choose whether GIF export samples the whole video or only a selected timestamp range before encoding."
                            : "Choose whether GIF or sequence export covers the whole video or only a selected timestamp range."}
                        >
                          (i)
                        </span>
                      </span>
                      <div className={s.radioGroup}>
                        {RELIABLE_SCOPE_OPTIONS.options.map((option) => (
                          <label key={option.value}>
                            <input
                              type="radio"
                              name="loopExportRange"
                              value={option.value}
                              checked={loopExportScope === option.value}
                              onChange={() => setLoopExportScope(option.value as "loop" | "range")}
                            />
                            {option.name || option.value}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {state.video && loopExportScope === "range" && (
                    <>
                      <div className={s.row}>
                        <span className={s.rowLabel}>
                          Start
                          <span
                            className={s.inlineInfo}
                            title="Start timestamp for GIF or sequence export."
                          >
                            (i)
                          </span>
                        </span>
                        <div className={s.sliderRow}>
                          <input
                            className={s.slider}
                            type="range"
                            min={0}
                            max={Math.max(0, state.video.duration || 0)}
                            step={0.01}
                            value={Math.min(loopRangeStart, Math.max(0, loopRangeEnd - 0.01))}
                            onChange={e => setLoopRangeStart(Math.min(parseFloat(e.target.value) || 0, Math.max(0, loopRangeEnd - 0.01)))}
                          />
                          <span className={s.sliderValue}>{loopRangeStart.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className={s.row}>
                        <span className={s.rowLabel}>
                          End
                          <span
                            className={s.inlineInfo}
                            title="End timestamp for GIF or sequence export."
                          >
                            (i)
                          </span>
                        </span>
                        <div className={s.sliderRow}>
                          <input
                            className={s.slider}
                            type="range"
                            min={0.01}
                            max={Math.max(0.01, state.video.duration || 0)}
                            step={0.01}
                            value={Math.max(loopRangeEnd, Math.min(state.video.duration || 0, loopRangeStart + 0.01))}
                            onChange={e => setLoopRangeEnd(Math.max(parseFloat(e.target.value) || 0.01, Math.min((state.video?.duration || 0), loopRangeStart + 0.01)))}
                          />
                          <span className={s.sliderValue}>{loopRangeEnd.toFixed(2)}</span>
                        </div>
                      </div>
                    </>
                  )}

                  <div className={s.buttons}>
                    <button className={s.btn} onClick={exporting ? handleAbortExport : handleVideoExport}>
                      {exporting ? "Stop" : "Export"}
                    </button>
                    {state.video && (
                      <button
                        className={s.btn}
                        disabled={exporting}
                        onClick={() => handleExportLoop(videoFormat as "gif" | "sequence")}
                        title="Rewind source video and render one full loop"
                      >
                        ⟲ Render loop
                      </button>
                    )}
                  </div>

                  {videoFormat === "gif" && gifUrl && (
                    <>
                      <img
                        src={gifUrl}
                        className={s.videoPreview}
                        alt="GIF export preview"
                      />
                      {gifResultLabel && (
                        <div className={s.helperText}>
                          {gifResultLabel}
                        </div>
                      )}
                    </>
                  )}

                  {videoFormat === "gif" && (
                    <div className={s.buttons}>
                      <button className={s.btn} disabled={!gifBlob} onClick={handleSaveGif}>
                        Save
                      </button>
                      {canWriteClipboard() && (
                        <button className={s.btn} disabled={!gifBlob} onClick={handleCopyGif}>
                          Copy
                          {copySuccess && <span className={s.copyFlash}> Copied!</span>}
                        </button>
                      )}
                    </div>
                  )}

                  {videoFormat === "sequence" && sequenceBlob && (
                    <div className={s.helperText}>
                      Sequence ZIP ready to save or copy.
                    </div>
                  )}

                  {videoFormat === "sequence" && (
                    <div className={s.buttons}>
                      <button className={s.btn} disabled={!sequenceBlob} onClick={handleSaveSequence}>
                        Save
                      </button>
                      {canWriteClipboard() && (
                        <button className={s.btn} disabled={!sequenceBlob} onClick={handleCopySequence}>
                          Copy
                          {copySuccess && <span className={s.copyFlash}> Copied!</span>}
                        </button>
                      )}
                    </div>
                  )}

                  {progress && (
                    <>
                      {progressValue != null && (
                        <div className={s.progressBar} aria-hidden="true">
                          <div
                            className={s.progressBarFill}
                            style={{ width: `${Math.max(0, Math.min(100, progressValue * 100))}%` }}
                          />
                        </div>
                      )}
                      <div className={s.progress}>{progress}</div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
  );
};

export default SaveAs;
