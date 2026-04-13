import React, { useState, useRef, useEffect, useCallback } from "react";
import useDraggable from "./useDraggable";

import Controls from "components/controls";
import ChainList from "components/ChainList";
import { CHAIN_PRESETS, type PresetFilterEntry } from "components/ChainList/presets";
import Exporter from "components/App/Exporter";
import SaveAs from "components/SaveAs";
import Range from "components/controls/Range";
import Enum from "components/controls/Enum";
import CollapsibleSection from "components/CollapsibleSection";

import { useFilter } from "context/useFilter";
import { SCALING_ALGORITHM } from "constants/optionTypes";
import { SCALING_ALGORITHM_OPTIONS } from "constants/controlTypes";
import {
  dispatchScreensaverCycleSeconds,
  getLastScreensaverCycleSeconds,
  setRememberedScreensaverCycleSeconds,
} from "utils/randomCycleBridge";
import { setupWebMCP } from "@src/webmcp";

import controls from "components/controls/styles.module.css";
import s from "./styles.module.css";

const testAssetUrl = (kind: "image" | "video", file: string) =>
  `${import.meta.env.BASE_URL}test-assets/${kind}/${file}`;

const TEST_IMAGE_ASSETS = [
  "BoatsColor.png",
  "DSCF0491.JPG@800.avif",
  "DSCF1248.JPG@1600.avif",
  "ZeldaColor.png",
  "airplane.png",
  "baboon.png",
  "barbara.png",
  "fruits.png",
  "goldhill.png",
  "lenna.png",
  "monarch.png",
  "pepper.png",
  "sailboat.png",
  "soccer.png",
].map((file) => testAssetUrl("image", file));

const TEST_VIDEO_ASSETS = [
  "118-60i.mp4",
  "120-60i.mp4",
  "164-60i.mp4",
  "207-60p.mp4",
  "DSCF0159.MOV@1280.mp4",
  "akiyo.mp4",
  "badapple-trimp.mp4",
  "bowing_cif.mp4",
  "c01_Fireworks_willow_4K_960x540.mp4",
  "carphone_qcif.mp4",
  "city_4cif.mp4",
  "degauss.webm",
  "highway_cif.mp4",
  "ice_4cif.mp4",
  "kumiko.webm",
  "pamphlet_cif.mp4",
  "rush_hour_1080p25.mp4",
  "salesman_qcif.mp4",
  "stefan_sif.mp4",
  "suzie.mp4",
  "tempete_cif.mp4",
  "tt_sif.mp4",
  "vtc1nw_422_cif.mp4",
  "waterfall_cif.mp4",
].map((file) => testAssetUrl("video", file));

const pickRandom = <T,>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)];

const pickRandomDifferent = <T,>(items: T[], previous?: T | null): T => {
  if (items.length <= 1 || previous == null) return pickRandom(items);
  const choices = items.filter(item => item !== previous);
  return pickRandom(choices.length > 0 ? choices : items);
};

const DEFAULT_TEST_IMAGE_ASSET = testAssetUrl("image", "pepper.png");
const DEFAULT_TEST_VIDEO_ASSET = testAssetUrl("video", "akiyo.mp4");
const basename = (path: string) => path.split("/").pop() || path;
const SCREENSAVER_IDLE_DELAY_MS = 10000;
const DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH = 250;
const FULLSCREEN_CURSOR_IDLE_MS = 1500;

const secondsToBpm = (seconds: number) => 240 / seconds;
const bpmToSeconds = (bpm: number) => 240 / bpm;

type PreviousCanvasProps = {
  inputImage?: CanvasImageSource | null;
  outputImage?: CanvasImageSource | null;
  scale?: number;
  time?: number | null;
};
const TEST_IMAGE_OPTIONS = TEST_IMAGE_ASSETS.map((src) => ({ value: src, label: basename(src) }));
const TEST_VIDEO_OPTIONS = TEST_VIDEO_ASSETS.map((src) => ({ value: src, label: basename(src) }));
const cloneImageToCanvas = (image: HTMLImageElement) => {
  const canvas = document.createElement("canvas");
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(image, 0, 0, width, height);
  return canvas;
};

const formatVideoTime = (seconds?: number | null) => {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const InfoHint = ({ text }: { text: string }) => (
  <span className={controls.info} title={text}>
    (i)
  </span>
);

const INPUT_SCALE_HELP = "Scales the source image or video before filtering. Lower values reduce processing cost; higher values give the filter more pixels to work with.";
const OUTPUT_SCALE_HELP = "Scales the rendered output view. This changes display size only and does not change how the filter itself processes the source.";
const SCALING_ALGORITHM_HELP = "Controls how enlarged canvases are drawn on screen. Auto uses smooth browser scaling; Pixelated keeps hard nearest-neighbor edges.";
const GRAYSCALE_HELP = "Converts the source to grayscale before the chain runs. Useful for monochrome dithers or filters that should ignore color.";
const GAMMA_HELP = "Runs the pipeline in gamma-correct space for more perceptually accurate blending and brightness. It can look better, but may change results and cost a bit more work.";

const App = () => {
  const { state, actions, filterList } = useFilter();
  const [dropping, setDropping] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("ditherer-theme") || "default");
  const [canvasDropping, setCanvasDropping] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [videoPaused, setVideoPaused] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [playPauseIndicator, setPlayPauseIndicator] = useState<"play" | "pause" | null>(null);
  const [inputLoadingLabel, setInputLoadingLabel] = useState<string | null>(null);
  const [inputFilename, setInputFilename] = useState<string | null>(null);
  const [outputFullscreen, setOutputFullscreen] = useState(false);
  const [outputFullscreenMode, setOutputFullscreenMode] = useState<"contain" | "cover">("contain");
  const [fullscreenCursorHidden, setFullscreenCursorHidden] = useState(false);
  const [showFullscreenMenu, setShowFullscreenMenu] = useState(false);
  const [screensaverActive, setScreensaverActive] = useState(false);
  const [screensaverCountdownMs, setScreensaverCountdownMs] = useState(SCREENSAVER_IDLE_DELAY_MS);
  const [showScreensaverDialog, setShowScreensaverDialog] = useState(false);
  const [screensaverDialogPosition, setScreensaverDialogPosition] = useState({ x: 640, y: 120 });
  const [screensaverSwapSecondsDraft, setScreensaverSwapSecondsDraft] = useState("2");
  const [screensaverSwapBpmDraft, setScreensaverSwapBpmDraft] = useState("120");
  const [screensaverRandomVideoDraft, setScreensaverRandomVideoDraft] = useState(false);
  const [screensaverVideoSwapSecondsDraft, setScreensaverVideoSwapSecondsDraft] = useState("8");
  const [screensaverScalingAlgorithmDraft, setScreensaverScalingAlgorithmDraft] = useState(state.scalingAlgorithm);
  const [screensaverVideoMaxWidthDraft, setScreensaverVideoMaxWidthDraft] = useState(String(DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH));
  const [seekDraftTime, setSeekDraftTime] = useState<number | null>(null);
  const playPauseTimerRef = useRef<number | null>(null);
  const seekCommitTimerRef = useRef<number | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const estimatedFrameStepRef = useRef(1 / 30);
  const screensaverRestoreRef = useRef<{ fullscreenMode: "contain" | "cover"; scale: number; scalingAlgorithm: string } | null>(null);
  const screensaverHasEnteredFullscreenRef = useRef(false);
  const screensaverConfigRef = useRef<{ swapSeconds: number; randomVideo: boolean; videoSwapSeconds: number; scalingAlgorithm: string; videoMaxWidth: number }>({
    swapSeconds: 2,
    randomVideo: false,
    videoSwapSeconds: 8,
    scalingAlgorithm: SCALING_ALGORITHM.PIXELATED,
    videoMaxWidth: DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH,
  });
  const screensaverVideoSwapTimerRef = useRef<number | null>(null);
  const currentInputIsRandomTestVideoRef = useRef(false);
  const warmedTestVideoRef = useRef<HTMLVideoElement | null>(null);
  const warmedTestVideoSrcRef = useRef<string | null>(null);
  const warmedTestVideoPromiseRef = useRef<Promise<string | null> | null>(null);

  const stopScreensaverVideoSwapLoop = useCallback(() => {
    if (screensaverVideoSwapTimerRef.current != null) {
      window.clearTimeout(screensaverVideoSwapTimerRef.current);
      screensaverVideoSwapTimerRef.current = null;
    }
  }, []);

  const clearWarmedTestVideo = useCallback(() => {
    const warmedVideo = warmedTestVideoRef.current;
    if (warmedVideo) {
      warmedVideo.pause();
      warmedVideo.removeAttribute("src");
      warmedVideo.load();
    }
    warmedTestVideoRef.current = null;
    warmedTestVideoSrcRef.current = null;
    warmedTestVideoPromiseRef.current = null;
  }, []);

  const flashPlayPause = (kind: "play" | "pause") => {
    setPlayPauseIndicator(kind);
    if (playPauseTimerRef.current) window.clearTimeout(playPauseTimerRef.current);
    playPauseTimerRef.current = window.setTimeout(() => setPlayPauseIndicator(null), 600);
  };

  const inputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputWindowRef = useRef<HTMLDivElement | null>(null);
  const fullscreenMenuRef = useRef<HTMLDivElement | null>(null);
  const screensaverButtonRef = useRef<HTMLButtonElement | null>(null);
  const screensaverDialogRef = useRef<HTMLDivElement | null>(null);
  const zIndexRef = useRef(0);
  const inputDragRef = useRef(null);
  const outputDragRef = useRef(null);
  const saveAsDragRef = useRef(null);
  const dragScaleStart = useRef({ input: 1, output: 1 });
  const hasLoadedTestImageRef = useRef(false);
  const hasLoadedTestVideoRef = useRef(false);
  const hasAutoLoadedDefaultMediaRef = useRef(false);
  const lastTestImageAssetRef = useRef<string | null>(null);
  const lastTestVideoAssetRef = useRef<string | null>(null);
  const imageAssetPromiseCacheRef = useRef<Map<string, Promise<HTMLImageElement>>>(new Map());
  const pendingLoadedMediaFilterRef = useRef(false);
  const webmcpRefs = useRef({ state, actions, filterList });
  webmcpRefs.current = { state, actions, filterList };

  const inputDrag = useDraggable(inputDragRef, {
    onScale: (delta) => {
      const newScale = Math.round(Math.max(0.05, Math.min(16, state.scale + delta)) * 10) / 10;
      actions.setScale(newScale);
    },
    onScaleAbsolute: (ratio) => {
      // ratio=1.0 at start → capture; subsequent calls use captured start
      if (Math.abs(ratio - 1) < 0.005) dragScaleStart.current.input = state.scale;
      const newScale = Math.max(0.05, Math.min(16, dragScaleStart.current.input * ratio));
      actions.setScale(Math.round(newScale * 100) / 100);
    }
  });
  const outputDrag = useDraggable(outputDragRef, {
    defaultPosition: { x: 320, y: 20 },
    onScale: (delta) => {
      const newScale = Math.round(Math.max(0.05, Math.min(16, state.outputScale + delta)) * 10) / 10;
      actions.setOutputScale(newScale);
    },
    onScaleAbsolute: (ratio) => {
      if (Math.abs(ratio - 1) < 0.005) dragScaleStart.current.output = state.outputScale;
      const newScale = Math.max(0.05, Math.min(16, dragScaleStart.current.output * ratio));
      actions.setOutputScale(Math.round(newScale * 100) / 100);
    }
  });
  const saveAsDrag = useDraggable(saveAsDragRef, { defaultPosition: { x: 160, y: 400 } });
  const screensaverDrag = useDraggable(screensaverDialogRef, { defaultPosition: screensaverDialogPosition });

  useEffect(() => {
    const video = state.video;
    if (!video) {
      setVideoPaused(false);
      estimatedFrameStepRef.current = 1 / 30;
      setSeekDraftTime(null);
      if (seekCommitTimerRef.current) {
        window.clearTimeout(seekCommitTimerRef.current);
        seekCommitTimerRef.current = null;
      }
      return;
    }

    const syncPaused = () => setVideoPaused(video.paused);
    syncPaused();
    video.addEventListener("play", syncPaused);
    video.addEventListener("pause", syncPaused);
    video.addEventListener("loadedmetadata", syncPaused);

    return () => {
      video.removeEventListener("play", syncPaused);
      video.removeEventListener("pause", syncPaused);
      video.removeEventListener("loadedmetadata", syncPaused);
    };
  }, [state.video]);

  useEffect(() => {
    return () => {
      if (seekCommitTimerRef.current) {
        window.clearTimeout(seekCommitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => clearWarmedTestVideo, [clearWarmedTestVideo]);

  useEffect(() => () => {
    dispatchScreensaverCycleSeconds(null);
  }, []);

  useEffect(() => {
    const syncOutputFullscreen = () => {
      setOutputFullscreen(document.fullscreenElement === outputWindowRef.current);
    };

    syncOutputFullscreen();
    document.addEventListener("fullscreenchange", syncOutputFullscreen);

    return () => {
      document.removeEventListener("fullscreenchange", syncOutputFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!outputFullscreen) {
      setFullscreenCursorHidden(false);
      return undefined;
    }

    let idleTimer: number | null = null;
    const resetIdleTimer = () => {
      setFullscreenCursorHidden(false);
      if (idleTimer != null) {
        window.clearTimeout(idleTimer);
      }
      idleTimer = window.setTimeout(() => {
        setFullscreenCursorHidden(true);
      }, FULLSCREEN_CURSOR_IDLE_MS);
    };

    resetIdleTimer();
    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "touchstart", "keydown", "wheel"];
    for (const eventName of events) {
      window.addEventListener(eventName, resetIdleTimer, { passive: true });
    }

    return () => {
      if (idleTimer != null) {
        window.clearTimeout(idleTimer);
      }
      for (const eventName of events) {
        window.removeEventListener(eventName, resetIdleTimer);
      }
      setFullscreenCursorHidden(false);
    };
  }, [outputFullscreen]);

  useEffect(() => {
    if (!showFullscreenMenu) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (fullscreenMenuRef.current?.contains(target)) return;
      setShowFullscreenMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowFullscreenMenu(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showFullscreenMenu]);

  useEffect(() => {
    if (screensaverActive && outputFullscreen) {
      screensaverHasEnteredFullscreenRef.current = true;
    }

    if (!screensaverHasEnteredFullscreenRef.current) return;
    if (outputFullscreen || !screensaverActive) return;
    const restore = screensaverRestoreRef.current;
    setScreensaverActive(false);
    screensaverHasEnteredFullscreenRef.current = false;
    if (!restore) return;
    stopScreensaverVideoSwapLoop();
    clearWarmedTestVideo();
    dispatchScreensaverCycleSeconds(null);
    setOutputFullscreenMode(restore.fullscreenMode);
    actions.setScale(restore.scale);
    actions.setScalingAlgorithm(restore.scalingAlgorithm);
    screensaverRestoreRef.current = null;
  }, [actions, clearWarmedTestVideo, outputFullscreen, screensaverActive, stopScreensaverVideoSwapLoop]);

  const buildScreensaverConfig = useCallback(() => {
    const swapSeconds = Number.parseFloat(screensaverSwapSecondsDraft.trim());
    if (!Number.isFinite(swapSeconds) || swapSeconds <= 0) {
      window.alert("Please enter a positive screensaver swap interval.");
      return null;
    }

    let videoSwapSeconds = Number.parseFloat(screensaverVideoSwapSecondsDraft.trim());
    let videoMaxWidth = Number.parseFloat(screensaverVideoMaxWidthDraft.trim());
    if (screensaverRandomVideoDraft) {
      if (!Number.isFinite(videoSwapSeconds) || videoSwapSeconds <= 0) {
        window.alert("Please enter a positive random video swap interval.");
        return null;
      }
      if (!Number.isFinite(videoMaxWidth) || videoMaxWidth <= 0) {
        window.alert("Please enter a positive max video width.");
        return null;
      }
    } else {
      videoSwapSeconds = swapSeconds * 4;
      videoMaxWidth = screensaverConfigRef.current.videoMaxWidth || DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH;
    }

    return {
      swapSeconds,
      randomVideo: screensaverRandomVideoDraft,
      videoSwapSeconds,
      scalingAlgorithm: screensaverScalingAlgorithmDraft,
      videoMaxWidth,
    };
  }, [screensaverRandomVideoDraft, screensaverScalingAlgorithmDraft, screensaverSwapSecondsDraft, screensaverVideoMaxWidthDraft, screensaverVideoSwapSecondsDraft]);

  useEffect(() => {
    if (!screensaverActive || !screensaverConfigRef.current.randomVideo) return;
    if (!state.video || !state.inputImage || !currentInputIsRandomTestVideoRef.current) return;

    const targetScale = Math.max(0.05, Math.min(16, screensaverConfigRef.current.videoMaxWidth / state.inputImage.width));
    const rounded = Math.round(targetScale * 100) / 100;
    if (Math.abs(rounded - state.scale) > 0.001) {
      actions.setScale(rounded);
    }
  }, [actions, screensaverActive, state.inputImage, state.scale, state.video]);

  useEffect(() => {
    if (seekDraftTime == null) return;
    if (state.time == null) return;
    if (Math.abs(state.time - seekDraftTime) < 0.02) {
      setSeekDraftTime(null);
    }
  }, [seekDraftTime, state.time]);

  useEffect(() => {
    const video = state.video as (HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    }) | null;
    if (!video || typeof video.requestVideoFrameCallback !== "function") return;

    let frameHandle: number | null = null;
    let lastMediaTime: number | null = null;
    let cancelled = false;

    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (cancelled) return;
      if (lastMediaTime != null) {
        const delta = metadata.mediaTime - lastMediaTime;
        if (delta > 0 && Number.isFinite(delta) && delta < 0.25) {
          estimatedFrameStepRef.current = delta;
        }
      }
      lastMediaTime = metadata.mediaTime;
      frameHandle = video.requestVideoFrameCallback?.(onFrame) ?? null;
    };

    frameHandle = video.requestVideoFrameCallback(onFrame);

    return () => {
      cancelled = true;
      if (frameHandle != null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameHandle);
      }
    };
  }, [state.video]);

  const toggleOutputFullscreen = useCallback(async (mode: "contain" | "cover") => {
    const outputWindow = outputWindowRef.current;
    if (!outputWindow) return;

    setOutputFullscreenMode(mode);

    if (document.fullscreenElement === outputWindow) {
      return;
    }

    await outputWindow.requestFullscreen();
  }, []);

  // Apply saved theme on mount
  useEffect(() => {
    if (theme === "rainy-day") {
      document.documentElement.setAttribute("data-theme", "rainy-day");
    }
  }, []);

  // Register WebMCP tools once (if the browser exposes navigator.modelContext).
  // Tool handlers read latest app state/actions via refs.
  useEffect(() => {
    return setupWebMCP({
      getState: () => webmcpRefs.current.state,
      getActions: () => webmcpRefs.current.actions,
      getFilterList: () => webmcpRefs.current.filterList,
      getOutputCanvas: () => outputCanvasRef.current,
    });
  }, []);

  // Register input canvas with state
  useEffect(() => {
    if (inputCanvasRef.current) {
      actions.setInputCanvas(inputCanvasRef.current);
    }
  }, []);

  // Draw to canvas when input/output changes
  const prevPropsRef = useRef<PreviousCanvasProps>({});
  useEffect(() => {
    const prev = prevPropsRef.current;

    const drawToCanvas = (
      canvas: HTMLCanvasElement,
      image: CanvasImageSource & { width: number; height: number },
      scale: number,
    ) => {
      const finalWidth = image.width * scale;
      const finalHeight = image.height * scale;
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = state.scalingAlgorithm === SCALING_ALGORITHM.AUTO;
        ctx.drawImage(image, 0, 0, finalWidth, finalHeight);
      }
    };

    const newInput = state.inputImage !== prev.inputImage;
    const newScale = state.scale !== prev.scale;
    const newTime = state.time !== prev.time;

    if (inputCanvasRef.current && state.inputImage && (newTime || newInput || newScale)) {
      drawToCanvas(inputCanvasRef.current, state.inputImage, state.scale);
    }

    if (outputCanvasRef.current && state.outputImage && state.outputImage !== prev.outputImage) {
      drawToCanvas(outputCanvasRef.current, state.outputImage, state.outputScale);
    }

    prevPropsRef.current = {
      inputImage: state.inputImage,
      outputImage: state.outputImage,
      scale: state.scale,
      time: state.time,
    };
  }, [state.inputImage, state.outputImage, state.scale, state.outputScale, state.time, state.scalingAlgorithm]);

  // Auto-filter when settings change and realtimeFiltering is on
  useEffect(() => {
    if (!state.realtimeFiltering || !inputCanvasRef.current || !state.inputImage) return;
    requestAnimationFrame(() => {
      actions.filterImageAsync(inputCanvasRef.current);
    });
  }, [
    state.chain, state.linearize, state.wasmAcceleration,
    state.convertGrayscale, state.realtimeFiltering, state.inputImage,
    state.scale, state.outputScale, state.time,
  ]);

  const bringToTop = useCallback((e: React.MouseEvent<HTMLElement>) => {
    zIndexRef.current += 1;
    e.currentTarget.style.zIndex = `${zIndexRef.current}`;
  }, []);

  const withInputLoading = useCallback(async (label: string, loader: () => Promise<void> | void) => {
    setInputLoadingLabel(label);
    try {
      await loader();
    } catch (error) {
      console.error("Failed to load input asset:", error);
    } finally {
      setInputLoadingLabel(null);
    }
  }, []);

  const queueLoadedMediaFilter = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (inputCanvasRef.current) {
          actions.filterImageAsync(inputCanvasRef.current);
        }
      });
    });
  }, [actions]);

  // After a new media source is loaded, run one filter pass once the first
  // input frame has reached the canvas, even if auto-apply is off.
  useEffect(() => {
    if (!pendingLoadedMediaFilterRef.current || !inputCanvasRef.current || !state.inputImage) return;
    pendingLoadedMediaFilterRef.current = false;
    queueLoadedMediaFilter();
  }, [queueLoadedMediaFilter, state.inputImage, state.time]);

  const loadImageAsset = useCallback((src: string) => {
    const cached = imageAssetPromiseCacheRef.current.get(src);
    if (cached) return cached;

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        imageAssetPromiseCacheRef.current.delete(src);
        reject(new Error(`Failed to load image asset: ${src}`));
      };
      img.src = src;
    });

    imageAssetPromiseCacheRef.current.set(src, promise);
    return promise;
  }, []);

  const prefetchRandomImage = useCallback((excludeSrc?: string | null) => {
    const src = pickRandomDifferent(TEST_IMAGE_ASSETS, excludeSrc ?? null);
    void loadImageAsset(src).catch(() => {});
  }, [loadImageAsset]);

  const loadUserFile = useCallback((file?: File | null) => {
    if (!file) return;
    const label = file.type.startsWith("video/") ? "LOADING VIDEO" : "LOADING IMAGE";
    pendingLoadedMediaFilterRef.current = true;
    currentInputIsRandomTestVideoRef.current = false;
    setInputFilename(file.name);
    void withInputLoading(label, () =>
      actions.loadMediaAsync(file, state.videoVolume, state.videoPlaybackRate)
    );
  }, [actions, state.videoPlaybackRate, state.videoVolume, withInputLoading]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      const items = Array.from(clipboardData.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;

      const target = event.target as HTMLElement | null;
      const isEditableTarget = !!target && (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      );

      const pastedFile = imageItem.getAsFile();
      if (!pastedFile) return;

      event.preventDefault();
      if (!isEditableTarget || pastedFile.size > 0) {
        loadUserFile(
          pastedFile.name
            ? pastedFile
            : new File([pastedFile], `pasted-image.${pastedFile.type.split("/")[1] || "png"}`, {
                type: pastedFile.type || "image/png",
              })
        );
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadUserFile]);

  const commitSeekVideo = useCallback((nextTime: number) => {
    const video = state.video;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const clampedTime = Math.max(0, Math.min(video.duration, nextTime));
    setSeekDraftTime(clampedTime);
    video.currentTime = clampedTime;
  }, [state.video]);

  const seekVideo = useCallback((nextTime: number) => {
    const video = state.video;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const clampedTime = Math.max(0, Math.min(video.duration, nextTime));
    setSeekDraftTime(clampedTime);
    if (seekCommitTimerRef.current) {
      window.clearTimeout(seekCommitTimerRef.current);
    }
    seekCommitTimerRef.current = window.setTimeout(() => {
      seekCommitTimerRef.current = null;
      commitSeekVideo(clampedTime);
    }, 40);
  }, [commitSeekVideo, state.video]);

  const flushSeekVideo = useCallback((nextTime: number) => {
    if (seekCommitTimerRef.current) {
      window.clearTimeout(seekCommitTimerRef.current);
      seekCommitTimerRef.current = null;
    }
    commitSeekVideo(nextTime);
  }, [commitSeekVideo]);

  const getEstimatedFrameStep = useCallback(() => {
    const video = state.video as (HTMLVideoElement & {
      webkitDecodedFrameCount?: number;
      mozPresentedFrames?: number;
      getVideoPlaybackQuality?: () => { totalVideoFrames?: number };
    }) | null;
    if (!video) return 1 / 30;

    const observed = estimatedFrameStepRef.current;
    if (observed > 0 && Number.isFinite(observed)) return observed;

    const elapsed = video.currentTime;
    const qualityFrames = video.getVideoPlaybackQuality?.().totalVideoFrames;
    if (elapsed > 0.1 && qualityFrames && qualityFrames > 0) return elapsed / qualityFrames;

    const webkitFrames = video.webkitDecodedFrameCount;
    if (elapsed > 0.1 && webkitFrames && webkitFrames > 0) return elapsed / webkitFrames;

    const mozFrames = video.mozPresentedFrames;
    if (elapsed > 0.1 && mozFrames && mozFrames > 0) return elapsed / mozFrames;

    return 1 / 30;
  }, [state.video]);

  const stepVideoFrame = useCallback((direction: -1 | 1) => {
    const video = state.video;
    if (!video) return;
    (video as HTMLVideoElement & { __manualPause?: boolean }).__manualPause = true;
    video.pause();
    setVideoPaused(true);
    flushSeekVideo((video.currentTime || 0) + getEstimatedFrameStep() * direction);
  }, [flushSeekVideo, getEstimatedFrameStep, state.video]);

  const loadTestImageFromSrc = useCallback((src: string) => {
    hasLoadedTestImageRef.current = true;
    lastTestImageAssetRef.current = src;
    pendingLoadedMediaFilterRef.current = true;
    currentInputIsRandomTestVideoRef.current = false;
    setInputFilename(basename(src));
    void withInputLoading("LOADING IMAGE", async () => {
      const perfStart = performance.now();
      const hadCache = imageAssetPromiseCacheRef.current.has(src);
      const logPerf = (stage: string, extra: Record<string, unknown> = {}) => {
        const elapsedMs = Math.round(performance.now() - perfStart);
        console.info(`[perf][random-image-load] ${stage} +${elapsedMs}ms`, { src, ...extra });
      };
      logPerf("click", { cache: hadCache ? "hit" : "miss" });
      const img = await loadImageAsset(src);
      logPerf("image-ready", { width: img.naturalWidth, height: img.naturalHeight });
      actions.loadImage(cloneImageToCanvas(img));
      logPerf("loadImage-dispatched");
      queueLoadedMediaFilter();
      prefetchRandomImage(src);
    });
  }, [actions, loadImageAsset, prefetchRandomImage, queueLoadedMediaFilter, withInputLoading]);

  const loadRandomTestImage = useCallback(() => {
    const src = hasLoadedTestImageRef.current
      ? pickRandomDifferent(TEST_IMAGE_ASSETS, lastTestImageAssetRef.current)
      : DEFAULT_TEST_IMAGE_ASSET;
    loadTestImageFromSrc(src);
  }, [loadTestImageFromSrc]);

  useEffect(() => {
    void loadImageAsset(DEFAULT_TEST_IMAGE_ASSET).then(() => {
      prefetchRandomImage(DEFAULT_TEST_IMAGE_ASSET);
    }).catch(() => {});
  }, [loadImageAsset, prefetchRandomImage]);

  const loadTestVideoFromSrc = useCallback((src: string, options?: { isRandomPick?: boolean; forceScreensaverScale?: boolean }) => {
    hasLoadedTestVideoRef.current = true;
    lastTestVideoAssetRef.current = src;
    pendingLoadedMediaFilterRef.current = true;
    currentInputIsRandomTestVideoRef.current = Boolean(options?.isRandomPick);
    setInputFilename(basename(src));
    return withInputLoading("LOADING VIDEO", async () => {
      const perfStart = performance.now();
      const logPerf = (stage: string, extra: Record<string, unknown> = {}) => {
        const elapsedMs = Math.round(performance.now() - perfStart);
        console.info(`[perf][random-video-load] ${stage} +${elapsedMs}ms`, { src, ...extra });
      };
      logPerf("click");
      await actions.loadVideoFromUrlAsync(
        src,
        state.videoVolume,
        state.videoPlaybackRate,
        options?.forceScreensaverScale ? { preserveScale: true } : undefined
      );
      if (options?.forceScreensaverScale) {
        const loadedVideo = webmcpRefs.current.state.video;
        if (loadedVideo?.videoWidth) {
          const forcedScale = Math.max(0.05, Math.min(16, screensaverConfigRef.current.videoMaxWidth / loadedVideo.videoWidth));
          actions.setScale(Math.round(forcedScale * 100) / 100);
        }
      }
      logPerf("loadVideoFromUrlAsync-resolved");
      queueLoadedMediaFilter();
    });
  }, [actions, queueLoadedMediaFilter, state.videoPlaybackRate, state.videoVolume, withInputLoading]);

  useEffect(() => {
    if (hasAutoLoadedDefaultMediaRef.current) return;
    if (state.inputImage || state.video) return;
    hasAutoLoadedDefaultMediaRef.current = true;
    loadTestVideoFromSrc(DEFAULT_TEST_VIDEO_ASSET);
  }, [loadTestVideoFromSrc, state.inputImage, state.video]);

  const loadRandomTestVideo = useCallback(() => {
    const src = hasLoadedTestVideoRef.current
      ? pickRandomDifferent(TEST_VIDEO_ASSETS, lastTestVideoAssetRef.current)
      : DEFAULT_TEST_VIDEO_ASSET;
    return loadTestVideoFromSrc(src, { isRandomPick: true });
  }, [loadTestVideoFromSrc]);

  const getNextRandomTestVideoSrc = useCallback((excludeSrc?: string | null) => {
    const previous = excludeSrc ?? lastTestVideoAssetRef.current;
    return hasLoadedTestVideoRef.current
      ? pickRandomDifferent(TEST_VIDEO_ASSETS, previous)
      : DEFAULT_TEST_VIDEO_ASSET;
  }, []);

  const warmTestVideoSrc = useCallback((src: string) => {
    if (warmedTestVideoSrcRef.current === src && warmedTestVideoPromiseRef.current) {
      return warmedTestVideoPromiseRef.current;
    }

    clearWarmedTestVideo();

    const warmedVideo = document.createElement("video");
    warmedVideo.preload = "auto";
    warmedVideo.muted = true;
    warmedVideo.loop = true;
    warmedVideo.playsInline = true;

    const warmedPromise = new Promise<string | null>((resolve) => {
      let settled = false;
      const finalize = (value: string | null) => {
        if (settled) return;
        settled = true;
        warmedVideo.onloadeddata = null;
        warmedVideo.onerror = null;
        resolve(value);
      };

      warmedVideo.onloadeddata = () => finalize(src);
      warmedVideo.onerror = () => finalize(null);
      warmedVideo.src = src;
      const playPromise = warmedVideo.play();
      if (playPromise) {
        playPromise
          .then(() => {
            warmedVideo.pause();
          })
          .catch(() => {
            // Some browsers won't autoplay the detached preloader even when muted.
            // Keeping the src loaded is still useful for cache warmup.
          });
      }
    }).then((warmedSrc) => {
      if (warmedSrc !== src) {
        if (warmedTestVideoRef.current === warmedVideo) {
          warmedTestVideoRef.current = null;
        }
        if (warmedTestVideoSrcRef.current === src) {
          warmedTestVideoSrcRef.current = null;
        }
        if (warmedTestVideoPromiseRef.current === warmedPromise) {
          warmedTestVideoPromiseRef.current = null;
        }
        warmedVideo.pause();
        warmedVideo.removeAttribute("src");
        warmedVideo.load();
        return null;
      }

      warmedTestVideoRef.current = warmedVideo;
      warmedTestVideoSrcRef.current = src;
      if (warmedTestVideoPromiseRef.current === warmedPromise) {
        warmedTestVideoPromiseRef.current = null;
      }
      return src;
    });

    warmedTestVideoPromiseRef.current = warmedPromise;
    return warmedPromise;
  }, [clearWarmedTestVideo]);

  const warmNextRandomTestVideo = useCallback((excludeSrc?: string | null) => {
    const nextSrc = getNextRandomTestVideoSrc(excludeSrc);
    return warmTestVideoSrc(nextSrc);
  }, [getNextRandomTestVideoSrc, warmTestVideoSrc]);

  const startScreensaverVideoSwapLoop = useCallback((videoSwapSeconds: number) => {
    stopScreensaverVideoSwapLoop();
    void warmNextRandomTestVideo(lastTestVideoAssetRef.current);

    const scheduleNextSwap = () => {
      screensaverVideoSwapTimerRef.current = window.setTimeout(async () => {
        const warmedSrc = warmedTestVideoSrcRef.current;
        const nextSrc = warmedSrc || getNextRandomTestVideoSrc(lastTestVideoAssetRef.current);
        clearWarmedTestVideo();
        await loadTestVideoFromSrc(nextSrc, { isRandomPick: true, forceScreensaverScale: true });
        void warmNextRandomTestVideo(nextSrc);
        scheduleNextSwap();
      }, videoSwapSeconds * 1000);
    };

    scheduleNextSwap();
  }, [clearWarmedTestVideo, getNextRandomTestVideoSrc, loadTestVideoFromSrc, stopScreensaverVideoSwapLoop, warmNextRandomTestVideo]);

  const startScreensaver = useCallback(async (config: { swapSeconds: number; randomVideo: boolean; videoSwapSeconds: number; scalingAlgorithm: string; videoMaxWidth: number }) => {
    const outputWindow = outputWindowRef.current;
    if (!outputWindow) return;

    screensaverRestoreRef.current = {
      fullscreenMode: outputFullscreenMode,
      scale: state.scale,
      scalingAlgorithm: state.scalingAlgorithm,
    };
    screensaverHasEnteredFullscreenRef.current = false;
    setScreensaverActive(true);
    setOutputFullscreenMode("cover");
    screensaverConfigRef.current = config;
    dispatchScreensaverCycleSeconds(config.swapSeconds);
    actions.setScalingAlgorithm(config.scalingAlgorithm);
    if (config.randomVideo) {
      startScreensaverVideoSwapLoop(config.videoSwapSeconds);
    } else {
      stopScreensaverVideoSwapLoop();
      clearWarmedTestVideo();
    }

    if (document.fullscreenElement !== outputWindow) {
      await outputWindow.requestFullscreen();
    }
  }, [actions, clearWarmedTestVideo, outputFullscreenMode, startScreensaverVideoSwapLoop, state.scale, state.scalingAlgorithm, stopScreensaverVideoSwapLoop]);

  useEffect(() => {
    if (!showScreensaverDialog || screensaverActive) return undefined;

    let deadline = Date.now() + SCREENSAVER_IDLE_DELAY_MS;
    setScreensaverCountdownMs(SCREENSAVER_IDLE_DELAY_MS);

    let timeoutId = window.setTimeout(() => {
      const config = buildScreensaverConfig();
      if (!config) return;
      setShowScreensaverDialog(false);
      setScreensaverCountdownMs(SCREENSAVER_IDLE_DELAY_MS);
      void startScreensaver(config);
    }, SCREENSAVER_IDLE_DELAY_MS);
    let intervalId = window.setInterval(() => {
      setScreensaverCountdownMs(Math.max(0, deadline - Date.now()));
    }, 100);

    const resetTimer = () => {
      deadline = Date.now() + SCREENSAVER_IDLE_DELAY_MS;
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      setScreensaverCountdownMs(SCREENSAVER_IDLE_DELAY_MS);
      timeoutId = window.setTimeout(() => {
        const config = buildScreensaverConfig();
        if (!config) return;
        setShowScreensaverDialog(false);
        setScreensaverCountdownMs(SCREENSAVER_IDLE_DELAY_MS);
        void startScreensaver(config);
      }, SCREENSAVER_IDLE_DELAY_MS);
      intervalId = window.setInterval(() => {
        setScreensaverCountdownMs(Math.max(0, deadline - Date.now()));
      }, 100);
    };

    const events: Array<keyof WindowEventMap> = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"];
    for (const eventName of events) {
      window.addEventListener(eventName, resetTimer, { passive: true });
    }

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      setScreensaverCountdownMs(SCREENSAVER_IDLE_DELAY_MS);
      for (const eventName of events) {
        window.removeEventListener(eventName, resetTimer);
      }
    };
  }, [buildScreensaverConfig, screensaverActive, showScreensaverDialog, startScreensaver]);

  const openScreensaverDialog = useCallback(() => {
    const currentSwapSeconds = getLastScreensaverCycleSeconds() ?? screensaverConfigRef.current.swapSeconds ?? 2;
    const randomVideoDefault = currentInputIsRandomTestVideoRef.current || screensaverConfigRef.current.randomVideo;
    const videoSwapSeconds = screensaverConfigRef.current.videoSwapSeconds > 0
      ? screensaverConfigRef.current.videoSwapSeconds
      : currentSwapSeconds * 4;
    const buttonRect = screensaverButtonRef.current?.getBoundingClientRect();
    const estimatedWidth = 420;
    const estimatedHeight = 360;
    const nextX = buttonRect
      ? Math.min(Math.max(16, buttonRect.left - 24), Math.max(16, window.innerWidth - estimatedWidth - 16))
      : screensaverDialogPosition.x;
    const nextY = buttonRect
      ? Math.min(Math.max(16, buttonRect.bottom + 8), Math.max(16, window.innerHeight - estimatedHeight - 16))
      : screensaverDialogPosition.y;
    setScreensaverDialogPosition({ x: nextX, y: nextY });
    setScreensaverSwapSecondsDraft(currentSwapSeconds.toString());
    setScreensaverSwapBpmDraft(secondsToBpm(currentSwapSeconds).toFixed(2).replace(/\.?0+$/, ""));
    setScreensaverRandomVideoDraft(randomVideoDefault);
    setScreensaverVideoSwapSecondsDraft(videoSwapSeconds.toString());
    setScreensaverScalingAlgorithmDraft(screensaverConfigRef.current.scalingAlgorithm || state.scalingAlgorithm);
    setScreensaverVideoMaxWidthDraft((screensaverConfigRef.current.videoMaxWidth || DEFAULT_SCREENSAVER_MAX_VIDEO_WIDTH).toString());
    setShowScreensaverDialog(true);
  }, [screensaverDialogPosition.x, screensaverDialogPosition.y, state.scalingAlgorithm]);

  const handleScreensaverSwapSecondsChange = useCallback((value: string) => {
    setScreensaverSwapSecondsDraft(value);
    const seconds = Number.parseFloat(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    setScreensaverSwapBpmDraft(secondsToBpm(seconds).toFixed(2).replace(/\.?0+$/, ""));
  }, []);

  const handleScreensaverSwapBpmChange = useCallback((value: string) => {
    setScreensaverSwapBpmDraft(value);
    const bpm = Number.parseFloat(value);
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    setScreensaverSwapSecondsDraft(bpmToSeconds(bpm).toFixed(3).replace(/\.?0+$/, ""));
  }, []);

  const confirmScreensaverDialog = useCallback(() => {
    const config = buildScreensaverConfig();
    if (!config) return;
    screensaverConfigRef.current = config;
    setRememberedScreensaverCycleSeconds(config.swapSeconds);
    setShowScreensaverDialog(false);
    setScreensaverCountdownMs(SCREENSAVER_IDLE_DELAY_MS);
    void startScreensaver(config);
  }, [buildScreensaverConfig, startScreensaver]);

  const fitInputToWindow = useCallback(() => {
    if (!state.inputImage) return;

    const sidebarRight = chromeRef.current?.getBoundingClientRect().right ?? 0;
    const horizontalPadding = 36;
    const verticalPadding = 48;
    const frameAllowance = 24; // input window chrome around the canvas

    const availableWidth = Math.max(
      120,
      window.innerWidth - sidebarRight - horizontalPadding - frameAllowance
    );
    const availableHeight = Math.max(
      120,
      window.innerHeight - verticalPadding - frameAllowance
    );

    const fitScale = Math.min(
      availableWidth / state.inputImage.width,
      availableHeight / state.inputImage.height
    );

    const clampedScale = Math.max(0.05, Math.min(16, fitScale));
    actions.setScale(Math.round(clampedScale * 100) / 100);
  }, [actions, state.inputImage]);

  const resolvePresetFilter = useCallback((entry: PresetFilterEntry) => {
    const match = filterList.find((f) => f && f.displayName === entry.name);
    if (!match) return null;
    return {
      displayName: entry.name,
      filter: {
        ...match.filter,
        options: {
          ...(match.filter.defaults || match.filter.options || {}),
          ...(entry.options || {}),
        },
      },
    };
  }, [filterList]);

  const loadPresetFromFilters = useCallback((presetFilters: PresetFilterEntry[]) => {
    if (!presetFilters.length) return;
    const first = resolvePresetFilter(presetFilters[0]);
    if (!first) return;
    actions.selectFilter(first.displayName, first.filter);
    for (let i = 1; i < presetFilters.length; i++) {
      const resolved = resolvePresetFilter(presetFilters[i]);
      if (resolved) actions.chainAdd(resolved.displayName, resolved.filter);
    }
  }, [actions, resolvePresetFilter]);

  const findPresetsForActiveFilter = useCallback(() => {
    const activeName = state.chain[state.activeIndex]?.displayName;
    if (!activeName) return;

    const matches = CHAIN_PRESETS.filter((preset) =>
      preset.filters.some((entry) => entry.name === activeName)
    );

    if (matches.length === 0) {
      window.alert(`No presets currently use "${activeName}".`);
      return;
    }

    const promptText = [
      `Presets using "${activeName}":`,
      ...matches.map((preset, idx) => `${idx + 1}. ${preset.name}`),
      "",
      "Enter number to load preset (Cancel to keep current chain).",
    ].join("\n");

    const raw = window.prompt(promptText, "1");
    if (!raw) return;
    const picked = Number.parseInt(raw, 10);
    if (!Number.isFinite(picked) || picked < 1 || picked > matches.length) {
      window.alert("Invalid selection.");
      return;
    }
    loadPresetFromFilters(matches[picked - 1].filters);
  }, [loadPresetFromFilters, state.activeIndex, state.chain]);

  return (
    <div className={s.app}>
      <div className={s.chrome} ref={chromeRef}>
        <h1>ＤＩＴＨＥＲＥＲ ▓▒░</h1>

        {/* Input section */}
        <div>
          <h2>Input</h2>
          <div
            className={[controls.group, dropping ? controls.dropping : null].join(" ")}
            onDragLeave={() => setDropping(false)}
            onDragOver={() => setDropping(true)}
            onDragEnter={() => setDropping(true)}
            onDrop={() => setDropping(false)}
          >
            <span className={controls.name}>File</span>
            <input
              className={[controls.file, s.nativeFileInput].join(" ")}
              type="file"
              accept="image/*,video/*"
              onChange={e => {
                loadUserFile(e.target.files?.[0] || null);
                e.target.value = "";
              }}
              title="Load an image or video file"
            />
            <p className={s.inputHelpText}>
              Paste, drag, or choose an image or video to get started.
            </p>
          </div>
          <div className={[controls.group, s.testMediaPicker].join(" ")}>
            <span className={controls.name}>Test Media</span>
            <div className={s.testMediaToolbar}>
              <select
                id="test-image-select"
                className={s.testMediaTrigger}
                value=""
                onChange={(e) => loadTestImageFromSrc(e.target.value)}
                title="Load a test image"
              >
                <option value="" disabled>Image...</option>
                {TEST_IMAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className={s.testMediaButton}
                onClick={loadRandomTestImage}
                title="Load a random test image"
              >
                Img?
              </button>
              <select
                id="test-video-select"
                className={s.testMediaTrigger}
                value=""
                onChange={(e) => loadTestVideoFromSrc(e.target.value)}
                title="Load a test video"
              >
                <option value="" disabled>Video...</option>
                {TEST_VIDEO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className={s.testMediaButton}
                onClick={loadRandomTestVideo}
                title="Load a random test video"
              >
                Vid?
              </button>
            </div>
          </div>
          {(state.inputImage || state.video) && (
            <CollapsibleSection title="Input Tweaks">
              <div className={s.inputTweaks}>
                {state.video && state.inputImage && (
                  <button
                    onClick={fitInputToWindow}
                    title="Scale the input video to comfortably fit the browser area right of the sidebar"
                  >
                    Fit to window
                  </button>
                )}
                <Range
                  name="Input Scale"
                  types={{ range: [0.05, 16], desc: INPUT_SCALE_HELP }}
                  step={0.05}
                  onSetFilterOption={(_, value) => actions.setScale(Number(value))}
                  value={state.scale}
                />
                {state.video && (<>
                  <div className={controls.separator} />
                  <div className={s.videoSeekRow}>
                    <span className={controls.label}>Position</span>
                    <button
                      className={s.videoFrameStep}
                      onClick={() => stepVideoFrame(-1)}
                      title="Step backward by roughly one frame"
                    >
                      &lt;
                    </button>
                    <input
                      className={s.videoSeek}
                      type="range"
                      min={0}
                      max={Number.isFinite(state.video?.duration) && state.video && state.video.duration > 0 ? state.video.duration : 0}
                      step={0.01}
                      value={Math.min(
                        seekDraftTime ?? state.time ?? 0,
                        Number.isFinite(state.video?.duration) ? state.video?.duration || 0 : 0
                      )}
                      onInput={(e) => seekVideo(Number((e.target as HTMLInputElement).value))}
                      onChange={(e) => flushSeekVideo(Number(e.target.value))}
                      disabled={!state.video || !Number.isFinite(state.video.duration) || state.video.duration <= 0}
                      title="Seek through the loaded video"
                    />
                    <button
                      className={s.videoFrameStep}
                      onClick={() => stepVideoFrame(1)}
                      title="Step forward by roughly one frame"
                    >
                      &gt;
                    </button>
                    <span className={s.videoSeekTime}>{formatVideoTime(state.time)} / {formatVideoTime(state.video?.duration)}</span>
                  </div>
                  <div className={s.videoControlRow}>
                    <button onClick={() => { actions.toggleVideo(); flashPlayPause(videoPaused ? "play" : "pause"); }}>
                      {videoPaused ? "\u25B6 Play" : "\u23F8 Pause"}
                    </button>
                    <label className={[controls.label, s.videoRateInline].join(" ")} htmlFor="playback-rate-inline">
                      <span>Rate</span>
                      <input
                        id="playback-rate-inline"
                        className={s.videoRateSlider}
                        type="range"
                        min={0}
                        max={2}
                        step={0.05}
                        value={state.videoPlaybackRate}
                        onChange={(e) => actions.setInputPlaybackRate(Number(e.target.value))}
                        title="Adjust playback rate"
                      />
                      <span className={s.videoRateValue}>{state.videoPlaybackRate.toFixed(2)}x</span>
                    </label>
                    <label className={controls.label} htmlFor="mute">
                      <input
                        id="mute"
                        type="checkbox"
                        checked={state.videoVolume === 0}
                        onChange={() => {
                          const newVol = state.videoVolume > 0 ? 0 : 1;
                          actions.setInputVolume(newVol);
                          localStorage.setItem("ditherer-mute", newVol === 0 ? "1" : "0");
                        }}
                      />
                      Mute
                    </label>
                  </div>
                </>)}
              </div>
            </CollapsibleSection>
          )}
        </div>

        {/* Algorithm section */}
        <CollapsibleSection title="Algorithm" defaultOpen>
          <div className={["filterOptions", s.filterOptions].join(" ")}>
            <ChainList />
            <div className={controls.group}>
              <span className={controls.name}>
                {state.chain[state.activeIndex]?.displayName ?? "Options"}
              </span>
              <Controls inputCanvas={inputCanvasRef.current} />
              {state.selected?.filter?.defaults && (
                <button
                  onClick={() => {
                    const name = state.selected.displayName || state.selected.name;
                    const filter = filterList.find(f => f && f.displayName === name);
                    if (filter) {
                      const entry = state.chain[state.activeIndex];
                      if (entry) actions.chainReplace(entry.id, name, filter.filter);
                    }
                  }}
                >
                  Reset defaults
                </button>
              )}
              {state.chain[state.activeIndex] && (
                <button
                  onClick={findPresetsForActiveFilter}
                  title="Find presets that include the active filter"
                >
                  Find presets
                </button>
              )}
            </div>
            <div className={controls.separator} />
            <div className={controls.checkbox}>
              <input
                name="convertGrayscale"
                type="checkbox"
                checked={state.convertGrayscale}
                onChange={e => actions.setConvertGrayscale(e.target.checked)}
              />
              <span
                role="presentation"
                onClick={() => actions.setConvertGrayscale(!state.convertGrayscale)}
                className={controls.label}
              >
                Pre-convert to grayscale
                <InfoHint text={GRAYSCALE_HELP} />
              </span>
            </div>
            <div className={controls.checkbox}>
              <input
                name="linearize"
                type="checkbox"
                checked={state.linearize}
                onChange={e => actions.setLinearize(e.target.checked)}
              />
              <span
                role="presentation"
                onClick={() => actions.setLinearize(!state.linearize)}
                className={controls.label}
              >
                Gamma-correct input
                <InfoHint text={GAMMA_HELP} />
              </span>
            </div>
          </div>
        </CollapsibleSection>

        {/* Filter button — always visible, sticky on mobile */}
        <div className={s.filterBar}>
          <button
            className={[s.filterButton, s.waitButton].join(" ")}
            disabled={filtering}
            onClick={() => {
              setFiltering(true);
              document.body.style.cursor = "wait";
              requestAnimationFrame(() => {
                actions.filterImageAsync(inputCanvasRef.current);
                setFiltering(false);
                document.body.style.cursor = "";
              });
            }}
          >
            {filtering ? "▓░ Processing…" : "Filter"}
          </button>
        </div>

        {/* Output section */}
        <CollapsibleSection title="Output" defaultOpen>
          <Range
            name="Output Scale"
            types={{ range: [0.05, 16], desc: OUTPUT_SCALE_HELP }}
            step={0.05}
            onSetFilterOption={(_, value) => actions.setOutputScale(Number(value))}
            value={state.outputScale}
          />
          <Enum
            name="Scaling algorithm"
            onSetFilterOption={(_, algorithm) => actions.setScalingAlgorithm(String(algorithm))}
            value={state.scalingAlgorithm}
            types={{ ...SCALING_ALGORITHM_OPTIONS, desc: SCALING_ALGORITHM_HELP }}
          />
          <button
            className={s.copyButton}
            onClick={async () => {
              // For video sources: record the filtered output canvas for one full
              // loop of the source video, then load it back as a new video input.
              // This bakes the current filter chain into the video.
              if (state.video && outputCanvasRef.current) {
                const canvas = outputCanvasRef.current;
                const stream = canvas.captureStream(30);
                // Pick a supported mime type
                const mimeCandidates = [
                  "video/webm;codecs=vp9",
                  "video/webm;codecs=vp8",
                  "video/webm",
                ];
                const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || "video/webm";
                const chunks: BlobPart[] = [];
                const recorder = new MediaRecorder(stream, { mimeType });
                recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
                recorder.onstop = () => {
                  const blob = new Blob(chunks, { type: mimeType });
                  const file = new File([blob], "filtered.webm", { type: mimeType });
                  setInputFilename(file.name);
                  void withInputLoading("LOADING VIDEO", () =>
                    actions.loadMediaAsync(file, state.videoVolume, state.videoPlaybackRate)
                  );
                };

                // Restart video from beginning so we capture a full loop
                const v = state.video;
                const wasPaused = v.paused;
                try { v.currentTime = 0; } catch { /* ignore */ }
                if (wasPaused) await v.play().catch(() => {});

                const duration = isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
                recorder.start();
                window.setTimeout(() => {
                  if (recorder.state !== "inactive") recorder.stop();
                  stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
                }, duration * 1000 + 100);
                return;
              }

              // For static images: copy the current filtered frame
              if (outputCanvasRef.current) {
                void withInputLoading("LOADING IMAGE", () => new Promise<void>((resolve, reject) => {
                  const image = new Image();
                  image.onload = () => {
                    actions.loadImage(image);
                    actions.setScale(1);
                    setInputFilename("filtered-output.png");
                    resolve();
                  };
                  image.onerror = () => reject(new Error("Failed to copy output image to input"));
                  image.src = outputCanvasRef.current?.toDataURL("image/png") ?? "";
                }));
              }
            }}
          >
            {"<< Copy output to input"}
          </button>
        </CollapsibleSection>

        {/* Settings section */}
        <CollapsibleSection title="Settings" collapsible>
          <div className={controls.checkbox}>
            <input
              name="realtimeFiltering"
              type="checkbox"
              checked={state.realtimeFiltering}
              onChange={e => actions.setRealtimeFiltering(e.target.checked)}
            />
            <span
              role="presentation"
              onClick={() => actions.setRealtimeFiltering(!state.realtimeFiltering)}
              className={controls.label}
            >
              Apply automatically
            </span>
          </div>
          <div className={controls.checkbox}>
            <input
              name="wasmAcceleration"
              type="checkbox"
              checked={state.wasmAcceleration}
              onChange={e => actions.setWasmAcceleration(e.target.checked)}
            />
            <span
              role="presentation"
              onClick={() => actions.setWasmAcceleration(!state.wasmAcceleration)}
              className={controls.label}
            >
              WASM acceleration
            </span>
          </div>
          <div className={controls.separator} />
          <div className={controls.checkbox}>
            <input
              name="theme"
              type="checkbox"
              checked={theme === "rainy-day"}
              onChange={e => {
                const newTheme = e.target.checked ? "rainy-day" : "default";
                setTheme(newTheme);
                localStorage.setItem("ditherer-theme", newTheme);
                if (newTheme === "rainy-day") {
                  document.documentElement.setAttribute("data-theme", "rainy-day");
                } else {
                  document.documentElement.removeAttribute("data-theme");
                }
              }}
            />
            <span
              role="presentation"
              onClick={() => {
                const newTheme = theme === "rainy-day" ? "default" : "rainy-day";
                setTheme(newTheme);
                localStorage.setItem("ditherer-theme", newTheme);
                if (newTheme === "rainy-day") {
                  document.documentElement.setAttribute("data-theme", "rainy-day");
                } else {
                  document.documentElement.removeAttribute("data-theme");
                }
              }}
              className={controls.label}
            >
              Rainy Day theme
            </span>
          </div>
          <div className={controls.separator} />
          <Exporter />
        </CollapsibleSection>

        {state.frameTime != null && (
          <div className={s.perfStats}>
            {state.stepTimes && state.stepTimes.length > 1
              ? `${state.stepTimes.length} filters`
              : state.stepTimes?.[0]?.name ?? "Filter"
            } | {state.frameTime.toFixed(0)}ms | {(1000 / state.frameTime).toFixed(1)} fps
          </div>
        )}
        <div className={s.github}>
          <a href="https://github.com/gyng/ditherer/">GitHub</a>
        </div>
      </div>

      {/* Canvases */}
      <div className={s.canvases}>
        <div
          ref={inputDragRef}
          role="presentation"
          onMouseDown={inputDrag.onMouseDown}
          onMouseDownCapture={bringToTop}
          onMouseMove={inputDrag.onMouseMove}
          onDragOver={e => { e.preventDefault(); setCanvasDropping(true); }}
          onDragLeave={() => setCanvasDropping(false)}
          onDrop={e => {
            e.preventDefault();
            setCanvasDropping(false);
            const file = e.dataTransfer.files[0];
            loadUserFile(file);
          }}
        >
          <div
            className={[controls.window, s.inputWindow, canvasDropping ? s.dropping : ""].join(" ")}
            style={!state.inputImage ? { minWidth: Math.round(200 * state.scale), minHeight: Math.round(200 * state.scale) } : undefined}
          >
            <div className={["handle", controls.titleBar].join(" ")}>
              {inputFilename ? `Input - ${inputFilename}` : "Input"}
            </div>
            <div className={s.canvasArea}>
              {(!state.inputImage || canvasDropping) && (
                <div
                  className={s.dropPlaceholder}
                  onClick={() => !canvasDropping && !inputDrag.didDrag.current && document.getElementById("imageLoader")?.click()}
                  style={{ cursor: canvasDropping ? undefined : "pointer" }}
                >
                  <span>{canvasDropping ? "Drop to load" : "Drop or click to load image/video"}</span>
                </div>
              )}
              <canvas
                className={[s.canvas, s[state.scalingAlgorithm]].join(" ")}
                ref={inputCanvasRef}
                onClick={() => {
                  if (state.video && !inputDrag.didDrag.current) {
                    actions.toggleVideo();
                    const nowPaused = !videoPaused;
                    setVideoPaused(nowPaused);
                    flashPlayPause(nowPaused ? "pause" : "play");
                  }
                }}
                style={state.video ? { cursor: "pointer" } : undefined}
              />
              {playPauseIndicator && (
                <div className={s.playPauseOverlay}>
                  {playPauseIndicator === "play" ? "▶ PLAY" : "❚❚ PAUSE"}
                </div>
              )}
              {inputLoadingLabel && (
                <div className={[s.playPauseOverlay, s.inputLoadingOverlay].join(" ")}>
                  {inputLoadingLabel}
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          ref={outputDragRef}
          role="presentation"
          onMouseDown={outputFullscreen ? undefined : outputDrag.onMouseDown}
          onMouseDownCapture={bringToTop}
          onMouseMove={outputFullscreen ? undefined : outputDrag.onMouseMove}
        >
          <div
            className={[
              controls.window,
              s.outputWindow,
              outputFullscreen ? s.outputWindowFullscreen : "",
              outputFullscreen && fullscreenCursorHidden ? s.outputWindowFullscreenCursorHidden : "",
            ].join(" ")}
            ref={outputWindowRef}
          >
            <div className={["handle", controls.titleBar, s.windowChrome].join(" ")}>
              {inputFilename ? `Output - ${inputFilename}` : "Output"}
            </div>
            <div className={[s.menuBar, s.windowChrome].join(" ")}>
              <button
                className={s.menuItem}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => {
                  setShowSaveAs(true);
                  zIndexRef.current += 1;
                  if (saveAsDragRef.current) {
                    (saveAsDragRef.current as HTMLElement).style.zIndex = `${zIndexRef.current}`;
                  }
                }}
              >
                Save As...
              </button>
              <label className={s.menuSelectWrap} onMouseDown={e => e.stopPropagation()}>
                <select
                  className={s.menuSelect}
                  value={state.scalingAlgorithm}
                  onChange={(e) => actions.setScalingAlgorithm(e.target.value)}
                  title="Set output display scaling"
                >
                  {SCALING_ALGORITHM_OPTIONS.options.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <div
                ref={fullscreenMenuRef}
                className={s.menuPopupWrap}
                onMouseDown={e => e.stopPropagation()}
              >
                <button
                  className={[s.menuItem, outputFullscreen || showFullscreenMenu ? s.menuItemActive : ""].join(" ")}
                  onClick={() => setShowFullscreenMenu((value) => !value)}
                  title="Choose fullscreen mode"
                >
                  Fullscreen
                </button>
                {showFullscreenMenu && (
                  <div className={s.menuPopup}>
                    <button
                      className={[s.menuPopupItem, outputFullscreenMode === "contain" ? s.menuPopupItemActive : ""].join(" ")}
                      onClick={() => {
                        setShowFullscreenMenu(false);
                        void toggleOutputFullscreen("contain");
                      }}
                    >
                      Contain
                    </button>
                    <button
                      className={[s.menuPopupItem, outputFullscreenMode === "cover" ? s.menuPopupItemActive : ""].join(" ")}
                      onClick={() => {
                        setShowFullscreenMenu(false);
                        void toggleOutputFullscreen("cover");
                      }}
                    >
                      Cover
                    </button>
                  </div>
                )}
              </div>
              <button
                ref={screensaverButtonRef}
                className={[s.menuItem, screensaverActive || showScreensaverDialog ? s.menuItemActive : ""].join(" ")}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => {
                  openScreensaverDialog();
                }}
                title={screensaverActive
                  ? "Screensaver active."
                  : showScreensaverDialog
                    ? `Screensaver window open. Auto-starts in ${(screensaverCountdownMs / 1000).toFixed(1)}s unless there is input.`
                    : "Configure and start screensaver. Opening the window also auto-starts after 10 seconds of no input."}
              >
                {showScreensaverDialog && !screensaverActive
                  ? `Screensaver ${Math.ceil(screensaverCountdownMs / 1000)}`
                  : "Screensaver"}
              </button>
            </div>
            <div className={s.outputCanvasStage}>
              <canvas
                className={[
                  s.canvas,
                  s[state.scalingAlgorithm],
                  outputFullscreen ? s.outputCanvasFullscreen : "",
                  outputFullscreenMode === "cover" ? s.outputCanvasCover : s.outputCanvasContain,
                ].join(" ")}
                ref={outputCanvasRef}
              />
            </div>
          </div>
        </div>

        {showScreensaverDialog && (
          <div className={s.screensaverOverlay} onMouseDown={() => setShowScreensaverDialog(false)}>
            <div
              ref={screensaverDialogRef}
              role="presentation"
              className={s.screensaverFloat}
              style={{ transform: `translate(${screensaverDialogPosition.x}px, ${screensaverDialogPosition.y}px)` }}
              onMouseDown={(e) => {
                e.stopPropagation();
                const target = e.target as HTMLElement | null;
                if (!target?.closest(".handle")) return;
                screensaverDrag.onMouseDown(e);
              }}
              onMouseMove={screensaverDrag.onMouseMove}
            >
            <div className={s.screensaverDialog} onMouseDown={e => e.stopPropagation()}>
              <div className={["handle", s.screensaverTitleBar].join(" ")}>
                <span>Screensaver</span>
                <button
                  className={s.screensaverClose}
                  onClick={() => setShowScreensaverDialog(false)}
                >
                  x
                </button>
              </div>
              <div className={s.screensaverBody}>
                <label className={s.screensaverField}>
                  <span>Swap seconds</span>
                  <input
                    className={s.screensaverInput}
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={screensaverSwapSecondsDraft}
                    onChange={(e) => handleScreensaverSwapSecondsChange(e.target.value)}
                  />
                </label>
                <label className={s.screensaverField}>
                  <span>Swap BPM</span>
                  <input
                    className={s.screensaverInput}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={screensaverSwapBpmDraft}
                    onChange={(e) => handleScreensaverSwapBpmChange(e.target.value)}
                  />
                </label>
                <label className={s.screensaverField}>
                  <span>Video scaling</span>
                  <select
                    className={s.screensaverInput}
                    value={screensaverScalingAlgorithmDraft}
                    onChange={(e) => setScreensaverScalingAlgorithmDraft(e.target.value)}
                  >
                    {SCALING_ALGORITHM_OPTIONS.options.map((option) => (
                      <option key={String(option.value)} value={String(option.value)}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={s.screensaverCheck}>
                  <input
                    type="checkbox"
                    checked={screensaverRandomVideoDraft}
                    onChange={(e) => {
                      const nextChecked = e.target.checked;
                      setScreensaverRandomVideoDraft(nextChecked);
                      if (nextChecked) {
                        const swapSeconds = Number.parseFloat(screensaverSwapSecondsDraft);
                        if (Number.isFinite(swapSeconds) && swapSeconds > 0) {
                          setScreensaverVideoSwapSecondsDraft((swapSeconds * 4).toFixed(3).replace(/\.?0+$/, ""));
                        }
                      }
                    }}
                  />
                  <span>Auto swap random video</span>
                </label>
                {screensaverRandomVideoDraft && (
                  <>
                    <label className={s.screensaverField}>
                      <span>Video swap seconds</span>
                      <input
                        className={s.screensaverInput}
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={screensaverVideoSwapSecondsDraft}
                        onChange={(e) => setScreensaverVideoSwapSecondsDraft(e.target.value)}
                      />
                    </label>
                    <label className={s.screensaverField}>
                      <span>Video width (px)</span>
                      <input
                        className={s.screensaverInput}
                        type="number"
                        min="1"
                        step="1"
                        value={screensaverVideoMaxWidthDraft}
                        onChange={(e) => setScreensaverVideoMaxWidthDraft(e.target.value)}
                      />
                    </label>
                  </>
                )}
                <div className={s.screensaverHint}>
                  4 beats = 1 chain swap. If auto swap random video is enabled, the input scale is clamped to the video width above for performance. This window auto-starts after 10 seconds of no input.
                </div>
              </div>
              <div className={s.screensaverButtons}>
                <button className={s.screensaverButton} onClick={confirmScreensaverDialog}>
                  Start
                </button>
                <button className={s.screensaverButton} onClick={() => setShowScreensaverDialog(false)}>
                  Cancel
                </button>
              </div>
            </div>
            </div>
          </div>
        )}

        <div
          ref={saveAsDragRef}
          role="presentation"
          onMouseDown={(e) => {
            const target = e.target as HTMLElement | null;
            if (!target?.closest(".handle")) return;
            saveAsDrag.onMouseDown(e);
          }}
          onMouseDownCapture={bringToTop}
          onMouseMove={saveAsDrag.onMouseMove}
          style={showSaveAs ? undefined : { display: "none" }}
        >
          {showSaveAs && (
            <SaveAs
              outputCanvasRef={outputCanvasRef}
              onClose={() => setShowSaveAs(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
