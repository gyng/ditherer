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
import { setupWebMCP } from "@src/webmcp";

import controls from "components/controls/styles.module.css";
import s from "./styles.module.css";

const TEST_IMAGE_ASSETS = [
  "/test-assets/image/BoatsColor.png",
  "/test-assets/image/DSCF0491.JPG@800.avif",
  "/test-assets/image/DSCF1248.JPG@1600.avif",
  "/test-assets/image/ZeldaColor.png",
  "/test-assets/image/airplane.png",
  "/test-assets/image/baboon.png",
  "/test-assets/image/barbara.png",
  "/test-assets/image/fruits.png",
  "/test-assets/image/goldhill.png",
  "/test-assets/image/lenna.png",
  "/test-assets/image/monarch.png",
  "/test-assets/image/pepper.png",
  "/test-assets/image/sailboat.png",
  "/test-assets/image/soccer.png",
];

const TEST_VIDEO_ASSETS = [
  "/test-assets/video/118-60i.mp4",
  "/test-assets/video/120-60i.mp4",
  "/test-assets/video/164-60i.mp4",
  "/test-assets/video/207-60p.mp4",
  "/test-assets/video/DSCF0159.MOV@1280.mp4",
  "/test-assets/video/akiyo.mp4",
  "/test-assets/video/badapple-trimp.mp4",
  "/test-assets/video/c01_Fireworks_willow_4K_960x540.mp4",
  "/test-assets/video/c06_Drama_standingup_4K_960x540.mp4",
  "/test-assets/video/c08_Drama_sunset_4K_960x540.mp4",
  "/test-assets/video/c17_HorseRace_homestretch_4K_960x540.mp4",
  "/test-assets/video/city_4cif.mp4",
  "/test-assets/video/crew_4cif.mp4",
  "/test-assets/video/degauss.webm",
  "/test-assets/video/ducks_take_off_420_720p50.mp4",
  "/test-assets/video/hall_objects_qcif.mp4",
  "/test-assets/video/ice_4cif.mp4",
  "/test-assets/video/kumiko.webm",
  "/test-assets/video/pamphlet_cif.mp4",
  "/test-assets/video/pedestrian_area_1080p25.mp4",
  "/test-assets/video/salesman_qcif.mp4",
  "/test-assets/video/suzie.mp4",
  "/test-assets/video/tempete_cif.mp4",
  "/test-assets/video/tt_sif.mp4",
  "/test-assets/video/waterfall_cif.mp4",
];

const pickRandom = <T,>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)];

const pickRandomDifferent = <T,>(items: T[], previous?: T | null): T => {
  if (items.length <= 1 || previous == null) return pickRandom(items);
  const choices = items.filter(item => item !== previous);
  return pickRandom(choices.length > 0 ? choices : items);
};

const DEFAULT_TEST_IMAGE_ASSET = "/test-assets/image/pepper.png";
const DEFAULT_TEST_VIDEO_ASSET = "/test-assets/video/akiyo.mp4";
const basename = (path: string) => path.split("/").pop() || path;

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
  const playPauseTimerRef = useRef<number | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);

  const flashPlayPause = (kind: "play" | "pause") => {
    setPlayPauseIndicator(kind);
    if (playPauseTimerRef.current) window.clearTimeout(playPauseTimerRef.current);
    playPauseTimerRef.current = window.setTimeout(() => setPlayPauseIndicator(null), 600);
  };

  const inputCanvasRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const zIndexRef = useRef(0);
  const inputDragRef = useRef(null);
  const outputDragRef = useRef(null);
  const saveAsDragRef = useRef(null);
  const dragScaleStart = useRef({ input: 1, output: 1 });
  const hasLoadedTestImageRef = useRef(false);
  const hasLoadedTestVideoRef = useRef(false);
  const lastTestImageAssetRef = useRef<string | null>(null);
  const lastTestVideoAssetRef = useRef<string | null>(null);
  const imageAssetPromiseCacheRef = useRef<Map<string, Promise<HTMLImageElement>>>(new Map());
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
  const prevPropsRef = useRef<any>({});
  useEffect(() => {
    const prev = prevPropsRef.current;

    const drawToCanvas = (canvas, image, scale) => {
      const finalWidth = image.width * scale;
      const finalHeight = image.height * scale;
      canvas.width = finalWidth;
      canvas.height = finalHeight;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = state.scalingAlgorithm === SCALING_ALGORITHM.AUTO;
      if (ctx) {
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

  const bringToTop = useCallback(e => {
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
    setInputFilename(file.name);
    void withInputLoading(label, () =>
      actions.loadMediaAsync(file, state.videoVolume, state.videoPlaybackRate)
    );
  }, [actions, state.videoPlaybackRate, state.videoVolume, withInputLoading]);

  const loadRandomTestImage = useCallback(() => {
    const src = hasLoadedTestImageRef.current
      ? pickRandomDifferent(TEST_IMAGE_ASSETS, lastTestImageAssetRef.current)
      : DEFAULT_TEST_IMAGE_ASSET;
    hasLoadedTestImageRef.current = true;
    lastTestImageAssetRef.current = src;
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
      actions.loadImage(img);
      logPerf("loadImage-dispatched");
      prefetchRandomImage(src);
    });
  }, [actions, loadImageAsset, prefetchRandomImage, withInputLoading]);

  useEffect(() => {
    void loadImageAsset(DEFAULT_TEST_IMAGE_ASSET).then(() => {
      prefetchRandomImage(DEFAULT_TEST_IMAGE_ASSET);
    }).catch(() => {});
  }, [loadImageAsset, prefetchRandomImage]);

  const loadRandomTestVideo = useCallback(() => {
    const src = hasLoadedTestVideoRef.current
      ? pickRandomDifferent(TEST_VIDEO_ASSETS, lastTestVideoAssetRef.current)
      : DEFAULT_TEST_VIDEO_ASSET;
    hasLoadedTestVideoRef.current = true;
    lastTestVideoAssetRef.current = src;
    setInputFilename(basename(src));
    void withInputLoading("LOADING VIDEO", async () => {
      const perfStart = performance.now();
      const logPerf = (stage: string, extra: Record<string, unknown> = {}) => {
        const elapsedMs = Math.round(performance.now() - perfStart);
        console.info(`[perf][random-video-load] ${stage} +${elapsedMs}ms`, { src, ...extra });
      };
      logPerf("click");
      await actions.loadVideoFromUrlAsync(src, state.videoVolume, state.videoPlaybackRate);
      logPerf("loadVideoFromUrlAsync-resolved");
    });
  }, [actions, state.videoPlaybackRate, state.videoVolume, withInputLoading]);

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
          <input
            className={[controls.file, dropping ? controls.dropping : null].join(" ")}
            type="file"
            accept="image/*,video/*"
            id="imageLoader"
            name="imageLoader"
            onChange={e => {
              loadUserFile(e.target.files?.[0] || null);
              e.target.value = "";
            }}
            onDragLeave={() => setDropping(false)}
            onDragOver={() => setDropping(true)}
            onDragEnter={() => setDropping(true)}
            onDrop={() => setDropping(false)}
          />
          <button
            onClick={loadRandomTestImage}
          >
            Random image
          </button>
          <button
            onClick={loadRandomTestVideo}
          >
            Random video
          </button>
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
            types={{ range: [0.05, 16] }}
            step={0.05}
            onSetFilterOption={(_, value) => actions.setScale(value)}
            value={state.scale}
          />
          {state.video && (<>
            <div className={controls.separator} />
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              <button onClick={() => { actions.toggleVideo(); const np = !videoPaused; setVideoPaused(np); flashPlayPause(np ? "pause" : "play"); }}>
                {videoPaused ? "\u25B6 Play" : "\u23F8 Pause"}
              </button>
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
            <Range
              name="Playback rate"
              types={{ range: [0, 2] }}
              step={0.05}
              onSetFilterOption={(_, value) => actions.setInputPlaybackRate(value)}
              value={state.videoPlaybackRate}
            />
          </>)}
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
            types={{ range: [0.05, 16] }}
            step={0.05}
            onSetFilterOption={(_, value) => actions.setOutputScale(value)}
            value={state.outputScale}
          />
          <Enum
            name="Scaling algorithm"
            onSetFilterOption={(_, algorithm) => actions.setScalingAlgorithm(algorithm)}
            value={state.scalingAlgorithm}
            types={SCALING_ALGORITHM_OPTIONS}
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
                  stream.getTracks().forEach(t => t.stop());
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
                  image.src = outputCanvasRef.current.toDataURL("image/png");
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

        <div ref={outputDragRef} role="presentation" onMouseDown={outputDrag.onMouseDown} onMouseDownCapture={bringToTop} onMouseMove={outputDrag.onMouseMove}>
          <div className={controls.window}>
            <div className={["handle", controls.titleBar].join(" ")}>
              {inputFilename ? `Output - ${inputFilename}` : "Output"}
            </div>
            <div className={s.menuBar}>
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
            </div>
            <canvas className={s.canvas} ref={outputCanvasRef} />
          </div>
        </div>

        <div
          ref={saveAsDragRef}
          role="presentation"
          onMouseDown={saveAsDrag.onMouseDown}
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
