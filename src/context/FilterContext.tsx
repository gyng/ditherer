import React, { useReducer, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import filterReducer, {
  initialState,
  ChainEntry,
  type FilterReducerAction,
  type FilterReducerState,
} from "reducers/filters";
import {
  clearMotionVectorsState,
  createReadbackCanvas,
  disposeSharedFilterResources,
  filterIndex,
  filterList,
  getReadbackContext,
  getWorkerPrevOutputFrame,
  PALETTE,
  releaseJpegArtifactFloatTextures,
  releasePooledCanvas,
  runFilterChain,
  getFilterHistory,
  serializePalette,
  takePooledCanvas,
  THEMES,
  type FilterChainEntry,
  type TemporalFilterState,
  type WorkerPrevOutputPayload,
} from "@gyng/ditherer-filters";
import { decodeShareState } from "utils/shareState";
import { syncRandomCycleSeconds } from "utils/randomCycleBridge";
import {
  getActiveAudioVizChannel,
  getActiveAudioVizSnapshot,
  getGlobalAudioVizModulation,
  setGlobalAudioVizModulation,
  subscribeGlobalAudioVizModulation,
  type AudioVizMetric,
  type EntryAudioModulation,
} from "utils/audioVizBridge";
import { applyAudioModulationToOptions as applyAudioModulationToOptionsPure } from "utils/autoViz";
import { recordFilterStepMs } from "utils/slowFilterRegistry";
import { disposeFilterWorker, workerRPC, USE_WORKER } from "@gyng/ditherer-filters/client";
import { FilterContext } from "./filterContextValue";
import type {
  AnimatedVideoElement,
  ExportFrameOptions,
  FilterActions,
  FilterOptionValue,
} from "./filterContextValue";
import { getAutoScale, roundScale } from "./autoScale";
import { getShareHash, getShareUrl } from "./shareUrl";
import { getShareableTestMediaSearch } from "utils/testMediaShare";
import { resolveRegisteredFilter } from "utils/registeredFilters";
import {
  hasV1SelectedState,
  isShareStateV2,
  type SerializedAudioVizModulation,
  type SerializedChainEntry,
  type SerializedFilterState,
  type ShareStateV1,
  type ShareStateV2,
} from "./shareStateTypes";

type SerializableOptions = Record<string, unknown>;
const grayscale = filterIndex.Grayscale;
type SerializedPaletteOption = { name?: string; options?: SerializableOptions };
type SerializablePalette = SerializedPaletteOption & {
  getColor?: (...args: unknown[]) => unknown;
};
const serializeAudioModulation = (
  audioMod: EntryAudioModulation | null | undefined,
): SerializedAudioVizModulation | undefined => {
  if (
    !audioMod ||
    ((!Array.isArray(audioMod.connections) || audioMod.connections.length === 0) &&
      (!Array.isArray(audioMod.normalizedMetrics) || audioMod.normalizedMetrics.length === 0))
  ) {
    return undefined;
  }
  return {
    c: audioMod.connections.map((connection) => ({
      k: connection.metric,
      o: connection.target,
      w: connection.weight,
    })),
    ...(audioMod.normalizedMetrics?.length ? { z: [...audioMod.normalizedMetrics] } : {}),
  };
};

// Audio modulation math lives in src/utils/autoViz.ts so it can be unit
// tested with a stub snapshot (no AudioContext / MediaDevices needed).
const applyAudioModulationToOptions = (
  options: Record<string, unknown>,
  optionTypes: NonNullable<ChainEntry["filter"]["optionTypes"]>,
  audioMod: EntryAudioModulation,
  entryId?: string,
) =>
  applyAudioModulationToOptionsPure(
    options,
    optionTypes as never,
    audioMod,
    getActiveAudioVizSnapshot(),
    entryId,
  );

const withAudioModulatedOptions = (entry: ChainEntry) => {
  if (!entry.filter.optionTypes || !entry.filter.options) return entry.filter.options;
  const snapshot = getActiveAudioVizSnapshot();
  if (!snapshot.enabled || snapshot.status !== "live") return entry.filter.options;
  let nextOptions: Record<string, unknown> = { ...entry.filter.options };
  if (entry.audioMod) {
    nextOptions = applyAudioModulationToOptions(
      nextOptions,
      entry.filter.optionTypes,
      entry.audioMod,
      entry.id,
    );
  }
  const globalMod = getGlobalAudioVizModulation(getActiveAudioVizChannel());
  if (globalMod) {
    nextOptions = applyAudioModulationToOptions(
      nextOptions,
      entry.filter.optionTypes,
      globalMod,
      entry.id,
    );
  }
  return nextOptions;
};
type FilterRunner = (input: HTMLCanvasElement | OffscreenCanvas | null) => void;
type AnimationParams = { inputCanvas: HTMLCanvasElement | null; fps: number };

// Serialize state to v2 format with delta encoding
const serializeState = (state: typeof initialState): SerializedFilterState => {
  const chain = state.chain;
  const chainGlobal = serializeAudioModulation(getGlobalAudioVizModulation("chain"));
  const screensaverGlobal = serializeAudioModulation(getGlobalAudioVizModulation("screensaver"));
  const singleEntryAudioMod =
    chain.length === 1 ? serializeAudioModulation(chain[0].audioMod) : null;
  // v1 has nowhere to store entry state or audio modulation. Keep its compact
  // shape only when the sole entry is fully representable by that format.
  if (
    chain.length === 1 &&
    chain[0].enabled === true &&
    !singleEntryAudioMod &&
    !chainGlobal &&
    !screensaverGlobal
  ) {
    const v1State: ShareStateV1 = {
      selected: state.selected,
      convertGrayscale: state.convertGrayscale,
      linearize: state.linearize,
      wasmAcceleration: state.wasmAcceleration,
      ...(state.randomCycleSeconds != null ? { r: state.randomCycleSeconds } : {}),
    };
    return v1State;
  }

  const serializedChain: SerializedChainEntry[] = chain.map((entry: ChainEntry) => {
    const result: SerializedChainEntry = { n: entry.filter.name, i: entry.id };
    if (entry.displayName !== entry.filter.name) {
      result.d = entry.displayName;
    }
    // Delta-encode options vs defaults
    const opts = entry.filter.options;
    const defaults = entry.filter.defaults;
    if (opts && defaults) {
      const delta: SerializableOptions = {};
      for (const [k, v] of Object.entries(opts)) {
        if (typeof v === "function") continue;
        if (k === "palette") {
          // Serialize palette with its options
          const paletteOption = v as SerializedPaletteOption | undefined;
          const pOpts = paletteOption?.options;
          const defaultPalette = defaults.palette as SerializedPaletteOption | undefined;
          const pDefaults = defaultPalette?.options;
          if (pOpts && JSON.stringify(pOpts) !== JSON.stringify(pDefaults)) {
            delta.palette = { name: paletteOption?.name, options: pOpts };
          }
        } else if (JSON.stringify(v) !== JSON.stringify(defaults[k])) {
          delta[k] = v;
        }
      }
      if (Object.keys(delta).length > 0) result.o = delta;
    } else if (opts) {
      // No defaults — serialize all non-function options
      const cleaned: SerializableOptions = {};
      for (const [k, v] of Object.entries(opts)) {
        if (typeof v !== "function") cleaned[k] = v;
      }
      result.o = cleaned;
    }
    if (!entry.enabled) result.e = false;
    const audioMod = serializeAudioModulation(entry.audioMod);
    if (audioMod) result.m = audioMod;
    return result;
  });

  const v2State: ShareStateV2 = {
    v: 2,
    chain: serializedChain,
    g: state.convertGrayscale,
    l: state.linearize,
    w: state.wasmAcceleration,
    ...(state.randomCycleSeconds != null ? { r: state.randomCycleSeconds } : {}),
  };
  const av: ShareStateV2["av"] = {};
  if (chainGlobal) av.chain = { m: chainGlobal };
  if (screensaverGlobal) av.screensaver = { m: screensaverGlobal };
  if (av.chain || av.screensaver) v2State.av = av;
  return v2State;
};

const deserializeAudioModulation = (data: unknown): EntryAudioModulation | null => {
  if (typeof data !== "object" || data === null) return null;
  const serialized = data as Record<string, unknown>;
  if (!Array.isArray(serialized.c)) return null;
  const connections = serialized.c.flatMap((connection) => {
    if (typeof connection !== "object" || connection === null) return [];
    const candidate = connection as Record<string, unknown>;
    if (
      typeof candidate.k !== "string" ||
      typeof candidate.o !== "string" ||
      typeof candidate.w !== "number" ||
      !Number.isFinite(candidate.w)
    )
      return [];
    return [
      {
        metric: candidate.k as AudioVizMetric,
        target: candidate.o,
        weight: candidate.w,
      },
    ];
  });
  if (connections.length === 0) return null;
  return {
    connections,
    normalizedMetrics: Array.isArray(serialized.z)
      ? serialized.z.filter((metric): metric is AudioVizMetric => typeof metric === "string")
      : [],
  };
};

const hasResolvableSerializedFilter = (data: unknown): data is SerializedFilterState => {
  if (isShareStateV2(data)) {
    return data.chain.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.n === "string" &&
        resolveRegisteredFilter(entry.n) !== undefined,
    );
  }
  return (
    hasV1SelectedState(data) && resolveRegisteredFilter(data.selected.filter.name) !== undefined
  );
};

const restoreAudioVizFromShareState = (data: unknown) => {
  if (!hasResolvableSerializedFilter(data)) return;
  const av = isShareStateV2(data) ? data.av : undefined;
  setGlobalAudioVizModulation("chain", deserializeAudioModulation(av?.chain?.m));
  setGlobalAudioVizModulation("screensaver", deserializeAudioModulation(av?.screensaver?.m));
};

// Produce JSON string for export
const serializeStateJson = (state: typeof initialState, pretty = false) => {
  const data = serializeState(state);
  const replacer = (k: string, v: unknown) => {
    if (k === "defaults" || k === "optionTypes" || typeof v === "function") return undefined;
    return v;
  };
  return pretty ? JSON.stringify(data, replacer, 2) : JSON.stringify(data, replacer);
};

const DEFAULT_SHARE_STATE_JSON = serializeStateJson(initialState);

export const FilterProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(
    filterReducer as React.Reducer<FilterReducerState, FilterReducerAction>,
    initialState,
  );
  const prevOutputMapRef = useRef<Map<string, Uint8ClampedArray>>(new Map());
  const prevInputMapRef = useRef<Map<string, Uint8ClampedArray>>(new Map());
  const emaMapRef = useRef<Map<string, Float32Array>>(new Map());
  const cachedOutputsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const deferredCanvasReleasesRef = useRef<Set<HTMLCanvasElement>>(new Set());
  const pinnedCanvasCountsRef = useRef<Map<HTMLCanvasElement, number>>(new Map());
  const providerUnmountedRef = useRef(false);
  const cachedChainOrderRef = useRef<string>("");
  const sourceCanvasIdsRef = useRef<WeakMap<object, number>>(new WeakMap());
  const nextSourceCanvasIdRef = useRef(1);
  const frameCountRef = useRef(0);
  const degaussFrameRef = useRef(-Infinity);
  const degaussAnimRef = useRef<number | null>(null);
  const animLoopRef = useRef<number | null>(null);
  const animLastTimeRef = useRef(0);
  const animParamsRef = useRef<AnimationParams | null>(null);
  // True when the current animation loop was started automatically by an
  // `autoAnimate` filter on chain add (rather than by the user clicking a
  // Play ACTION). When the last autoAnimate filter leaves the chain, we
  // stop the loop; user-started loops are never auto-stopped.
  const animLoopAutoStartedRef = useRef(false);
  const filteringRef = useRef(false);
  const pendingFilterRef = useRef(false);
  const workerRequestInFlightRef = useRef(false);
  const processingGenerationRef = useRef(0);
  const videoFrameTokenRef = useRef(0);
  const mediaLoadGenerationRef = useRef(0);
  const pendingMediaLoadRejectRef = useRef<((error: Error) => void) | null>(null);
  const exportSessionsRef = useRef<
    Map<
      string,
      {
        prevOutputMap: Map<string, Uint8ClampedArray>;
        prevInputMap: Map<string, Uint8ClampedArray>;
        emaMap: Map<string, Float32Array>;
        frameIndex: number;
        outputCanvas: HTMLCanvasElement | null;
      }
    >
  >(new Map());
  const stateRef = useRef<FilterReducerState>(state);
  stateRef.current = state;
  const filterImageAsyncRef = useRef<FilterRunner | null>(null);

  const canvasIsCached = useCallback(
    (canvas: HTMLCanvasElement) => Array.from(cachedOutputsRef.current.values()).includes(canvas),
    [],
  );

  const canvasIsPinned = useCallback(
    (canvas: HTMLCanvasElement) => (pinnedCanvasCountsRef.current.get(canvas) ?? 0) > 0,
    [],
  );

  const releaseOrDeferCanvas = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (canvasIsCached(canvas)) return;
      if (
        canvasIsPinned(canvas) ||
        (!providerUnmountedRef.current && canvas === stateRef.current.outputImage)
      ) {
        deferredCanvasReleasesRef.current.add(canvas);
        return;
      }
      deferredCanvasReleasesRef.current.delete(canvas);
      releasePooledCanvas(canvas);
    },
    [canvasIsCached, canvasIsPinned],
  );

  const flushDeferredCanvasReleases = useCallback(
    (
      displayedCanvas: HTMLCanvasElement | OffscreenCanvas | null = providerUnmountedRef.current
        ? null
        : stateRef.current.outputImage,
    ) => {
      for (const canvas of deferredCanvasReleasesRef.current) {
        if (canvas === displayedCanvas || canvasIsCached(canvas) || canvasIsPinned(canvas))
          continue;
        deferredCanvasReleasesRef.current.delete(canvas);
        releasePooledCanvas(canvas);
      }
    },
    [canvasIsCached, canvasIsPinned],
  );

  const pinCachedCanvas = useCallback((canvas: HTMLCanvasElement) => {
    pinnedCanvasCountsRef.current.set(canvas, (pinnedCanvasCountsRef.current.get(canvas) ?? 0) + 1);
  }, []);

  const unpinCachedCanvas = useCallback(
    (canvas: HTMLCanvasElement) => {
      const count = pinnedCanvasCountsRef.current.get(canvas) ?? 0;
      if (count <= 1) pinnedCanvasCountsRef.current.delete(canvas);
      else pinnedCanvasCountsRef.current.set(canvas, count - 1);
      flushDeferredCanvasReleases();
    },
    [flushDeferredCanvasReleases],
  );

  const clearCachedOutputs = useCallback(() => {
    const canvases = new Set(cachedOutputsRef.current.values());
    cachedOutputsRef.current.clear();
    for (const canvas of canvases) releaseOrDeferCanvas(canvas);
  }, [releaseOrDeferCanvas]);

  // A cached step depends on every enabled stage before it. Semantic changes
  // at one chain position therefore invalidate that entry and the complete
  // downstream suffix, while preserving reusable upstream work.
  const evictCachedOutputsFromChainIndex = useCallback(
    (chainIndex: number, chain: readonly ChainEntry[] = stateRef.current.chain) => {
      if (chainIndex < 0 || chainIndex >= chain.length) return;
      const removedCanvases = new Set<HTMLCanvasElement>();
      for (let index = chainIndex; index < chain.length; index += 1) {
        const canvas = cachedOutputsRef.current.get(chain[index].id);
        if (canvas) removedCanvases.add(canvas);
        cachedOutputsRef.current.delete(chain[index].id);
      }
      const retainedCanvases = new Set(cachedOutputsRef.current.values());
      for (const canvas of removedCanvases) {
        if (!retainedCanvases.has(canvas)) releaseOrDeferCanvas(canvas);
      }
    },
    [releaseOrDeferCanvas],
  );

  const commitCachedOutputs = useCallback(
    (staged: Map<string, HTMLCanvasElement>) => {
      const replacedCanvases = new Set<HTMLCanvasElement>();
      for (const [id, canvas] of staged) {
        const previous = cachedOutputsRef.current.get(id);
        if (previous && previous !== canvas) replacedCanvases.add(previous);
        cachedOutputsRef.current.set(id, canvas);
      }
      staged.clear();
      for (const canvas of replacedCanvases) releaseOrDeferCanvas(canvas);
      flushDeferredCanvasReleases();
    },
    [flushDeferredCanvasReleases, releaseOrDeferCanvas],
  );

  const discardStagedOutputs = useCallback(
    (
      staged: Map<string, HTMLCanvasElement>,
      originalInput: HTMLCanvasElement | OffscreenCanvas,
    ) => {
      const canvases = new Set(staged.values());
      staged.clear();
      for (const canvas of canvases) {
        if (canvas !== originalInput) releaseOrDeferCanvas(canvas);
      }
    },
    [releaseOrDeferCanvas],
  );

  const invalidateProcessingGeneration = useCallback(() => {
    processingGenerationRef.current += 1;
    filteringRef.current = false;
    pendingFilterRef.current = false;
    if (workerRequestInFlightRef.current) {
      workerRequestInFlightRef.current = false;
      disposeFilterWorker();
    }
  }, []);

  const disposeWorkerRealm = useCallback(() => {
    const workerWasActive = workerRequestInFlightRef.current;
    invalidateProcessingGeneration();
    if (!workerWasActive) disposeFilterWorker();
  }, [invalidateProcessingGeneration]);

  const resetProcessingState = useCallback(() => {
    filteringRef.current = false;
    pendingFilterRef.current = false;
    videoFrameTokenRef.current = 0;
    prevOutputMapRef.current.clear();
    prevInputMapRef.current.clear();
    emaMapRef.current.clear();
    clearCachedOutputs();
    cachedChainOrderRef.current = "";
    // Flush shared filter state and GPU targets so stale entries from removed
    // filters don't accumulate. Shader programs remain process-lifetime
    // singletons and are intentionally retained.
    disposeSharedFilterResources();
    disposeWorkerRealm();
  }, [clearCachedOutputs, disposeWorkerRealm]);

  useEffect(
    () => () => {
      providerUnmountedRef.current = true;
      resetProcessingState();
      flushDeferredCanvasReleases(null);
      for (const session of exportSessionsRef.current.values()) {
        if (session.outputCanvas) releasePooledCanvas(session.outputCanvas);
      }
      exportSessionsRef.current.clear();
    },
    [flushDeferredCanvasReleases, resetProcessingState],
  );

  useEffect(() => {
    flushDeferredCanvasReleases();
  }, [state.outputImage, flushDeferredCanvasReleases]);

  const codecActiveRef = useRef(
    state.chain.some(
      (entry) =>
        entry.enabled &&
        (entry.filter.name === "JPEG Artifact" || entry.filter.name === "Mavica FD7"),
    ),
  );
  useEffect(() => {
    const codecActive = state.chain.some(
      (entry) =>
        entry.enabled &&
        (entry.filter.name === "JPEG Artifact" || entry.filter.name === "Mavica FD7"),
    );
    if (codecActiveRef.current && !codecActive) {
      releaseJpegArtifactFloatTextures();
      disposeWorkerRealm();
    }
    codecActiveRef.current = codecActive;
  }, [state.chain, disposeWorkerRealm]);

  // Restore state from #! hash on initial load
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#!")) return;
    try {
      const json = decodeShareState(hash.slice(2));
      const data = JSON.parse(json) as SerializedFilterState;
      dispatch({ type: "LOAD_STATE", data });
      restoreAudioVizFromShareState(data);
    } catch (e) {
      console.warn("Failed to restore state from URL hash:", e);
    }
  }, []);

  // Sync filter state to URL hash so the address bar is always shareable
  const [audioVizSyncKey, setAudioVizSyncKey] = useState(0);
  useEffect(
    () =>
      subscribeGlobalAudioVizModulation((channel) => {
        if (channel === "chain") {
          invalidateProcessingGeneration();
          clearCachedOutputs();
          const current = stateRef.current;
          if (current.realtimeFiltering && current.inputCanvas) {
            requestAnimationFrame(() => {
              const latest = stateRef.current;
              if (latest.realtimeFiltering && latest.inputCanvas) {
                filterImageAsyncRef.current?.(latest.inputCanvas);
              }
            });
          }
        }
        setAudioVizSyncKey((value) => value + 1);
      }),
    [clearCachedOutputs, invalidateProcessingGeneration],
  );
  useEffect(() => {
    if (!state.chain || state.chain.length === 0) return;
    try {
      const json = serializeStateJson(state);
      const hash = getShareHash(json, DEFAULT_SHARE_STATE_JSON);
      const url = getShareUrl(window.location.pathname, window.location.search, hash);
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url) {
        history.replaceState(null, "", url);
      }
    } catch (e) {
      console.warn("Failed to sync state to URL hash:", e);
    }
  }, [
    state.chain,
    state.activeIndex,
    state.convertGrayscale,
    state.linearize,
    state.wasmAcceleration,
    state.randomCycleSeconds,
    audioVizSyncKey,
  ]);

  useEffect(() => {
    syncRandomCycleSeconds(state.randomCycleSeconds);
  }, [state.randomCycleSeconds]);

  // Async action: load image from file
  const loadImageAsync = useCallback(
    (file: File, options?: { preserveScale?: boolean }) =>
      new Promise<void>((resolve, reject) => {
        pendingMediaLoadRejectRef.current?.(
          new DOMException("Media load was superseded", "AbortError"),
        );
        const generation = ++mediaLoadGenerationRef.current;
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        const loadStartedScale = stateRef.current.scale;
        let settled = false;
        const settleReject = (error: Error) => {
          if (settled) return;
          settled = true;
          if (pendingMediaLoadRejectRef.current === settleReject)
            pendingMediaLoadRejectRef.current = null;
          URL.revokeObjectURL(objectUrl);
          reject(error);
        };
        const settleResolve = () => {
          if (settled) return;
          settled = true;
          if (pendingMediaLoadRejectRef.current === settleReject)
            pendingMediaLoadRejectRef.current = null;
          URL.revokeObjectURL(objectUrl);
          resolve();
        };
        pendingMediaLoadRejectRef.current = settleReject;
        image.onerror = () => settleReject(new Error("Failed to decode image"));
        image.onload = () => {
          if (generation !== mediaLoadGenerationRef.current) {
            settleReject(new DOMException("Media load was superseded", "AbortError"));
            return;
          }
          resetProcessingState();
          const frameToken = ++videoFrameTokenRef.current;
          dispatch({ type: "LOAD_IMAGE", image, time: null, frameToken, video: null, dispatch });
          if (
            !options?.preserveScale &&
            Math.abs(stateRef.current.scale - loadStartedScale) < 0.0001
          ) {
            const scale = roundScale(getAutoScale(image.width, image.height));
            dispatch({ type: "SET_SCALE", scale });
          }
          settleResolve();
        };
        image.src = objectUrl;
      }),
    [resetProcessingState],
  );

  const loadVideoSourceAsync = useCallback(
    (
      src: string,
      volume = 1,
      playbackRate = 1,
      perfMeta: Record<string, string> = {},
      objectUrlForCleanup?: string,
      options?: { preserveScale?: boolean },
    ) =>
      new Promise<void>((resolve, reject) => {
        pendingMediaLoadRejectRef.current?.(
          new DOMException("Media load was superseded", "AbortError"),
        );
        const generation = ++mediaLoadGenerationRef.current;
        resetProcessingState();

        // Tear down the previously playing video immediately — waiting for the
        // new video's first frame (LOAD_IMAGE reducer path) leaves the old video
        // decoding and occasionally auto-recovering its own playback, stacking up
        // multiple live decoders during rapid swaps.
        const previousVideo = stateRef.current.video as AnimatedVideoElement | null;
        if (previousVideo) {
          previousVideo.__manualPause = true;
          previousVideo.onplaying = null;
          previousVideo.onpause = null;
          previousVideo.onloadeddata = null;
          previousVideo.onseeked = null;
          previousVideo.onerror = null;
          previousVideo.onloadedmetadata = null;
          try {
            previousVideo.pause();
          } catch {
            /* ignore */
          }
          try {
            previousVideo.removeAttribute("src");
            previousVideo.load();
          } catch {
            /* ignore */
          }
          if (previousVideo.__objectUrl) {
            URL.revokeObjectURL(previousVideo.__objectUrl);
            delete previousVideo.__objectUrl;
          }
        }

        const loadStartedScale = stateRef.current.scale;
        const video = document.createElement("video") as AnimatedVideoElement;
        const perfStart = performance.now();
        const logPerf = (stage: string) => {
          const elapsedMs = Math.round(performance.now() - perfStart);
          console.info(`[perf][video-load] ${stage} +${elapsedMs}ms`, perfMeta);
        };
        logPerf("start");
        let settled = false;
        const settleResolve = () => {
          if (!settled) {
            settled = true;
            if (pendingMediaLoadRejectRef.current === settleReject)
              pendingMediaLoadRejectRef.current = null;
            resolve();
          }
        };
        const settleReject = (error: Error) => {
          if (!settled) {
            settled = true;
            if (pendingMediaLoadRejectRef.current === settleReject)
              pendingMediaLoadRejectRef.current = null;
            if (objectUrlForCleanup) {
              URL.revokeObjectURL(objectUrlForCleanup);
            }
            reject(error);
          }
        };
        pendingMediaLoadRejectRef.current = settleReject;

        const canvas = createReadbackCanvas();
        const ctx = getReadbackContext(canvas);
        if (!ctx) {
          settleReject(new Error("Failed to initialize video canvas"));
          return;
        }

        let rafId: number | null = null;
        const dispatchCurrentFrame = () => {
          if (generation !== mediaLoadGenerationRef.current) return;
          try {
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              ctx.drawImage(video, 0, 0);
              const frameToken = ++videoFrameTokenRef.current;
              dispatch({
                type: "LOAD_IMAGE",
                image: canvas,
                time: video.currentTime,
                frameToken,
                video,
                dispatch,
              });
            }
          } catch (error) {
            if (!video.__drawErrorLogged) {
              video.__drawErrorLogged = true;
              console.warn("[video-load] drawImage failed; continuing frame loop", error);
            }
          }
        };

        const loadFrame = () => {
          if (generation !== mediaLoadGenerationRef.current) {
            rafId = null;
            return;
          }
          if (!video.paused && video.src !== "") {
            if (!hasLoggedFirstFrame) {
              hasLoggedFirstFrame = true;
              logPerf("first-frame-dispatched");
            }
            // Some clips can transiently fail drawImage during decode starvation;
            // keep the loop alive instead of silently stalling playback updates.
            dispatchCurrentFrame();
            rafId = requestAnimationFrame(loadFrame);
          } else {
            rafId = null;
          }
        };

        let hasLoggedFirstFrame = false;
        video.onerror = () => settleReject(new Error("Failed to decode video"));
        video.onloadedmetadata = () => {
          if (generation !== mediaLoadGenerationRef.current) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          if (
            !options?.preserveScale &&
            Math.abs(stateRef.current.scale - loadStartedScale) < 0.0001
          ) {
            const scale = roundScale(getAutoScale(video.videoWidth, video.videoHeight));
            dispatch({ type: "SET_SCALE", scale });
          }
          logPerf("loadedmetadata");
          settleResolve();
        };
        video.onseeked = () => {
          dispatchCurrentFrame();
        };
        video.onloadeddata = () => {
          dispatchCurrentFrame();
        };
        video.onplaying = () => {
          if (generation !== mediaLoadGenerationRef.current) return;
          logPerf("playing");
          // Restart the frame loop every time playback resumes
          video.__manualPause = false;
          if (rafId == null) {
            rafId = requestAnimationFrame(loadFrame);
          }
        };
        video.onpause = () => {
          rafId = null;
          if (generation !== mediaLoadGenerationRef.current) return;
          // Recover from unexpected pauses caused by decode/buffering edge cases.
          // Respect explicit user pauses and teardown state (empty src).
          if (!video.__manualPause && video.src !== "" && !video.ended) {
            video.play().catch(() => {});
          }
        };

        video.volume = volume;
        video.muted = volume === 0;
        video.playbackRate = playbackRate;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        if (objectUrlForCleanup) {
          video.__objectUrl = objectUrlForCleanup;
        }
        video.__manualPause = false;
        video.__drawErrorLogged = false;
        video.src = src;
        video.play().catch(() => {
          if (video.src === "") return;
          if (video.muted || volume === 0) return;
          video.muted = true;
          video.volume = 0;
          dispatch({ type: "SET_INPUT_VOLUME", volume: 0 });
          video.play().catch(() => {});
        });
      }),
    [resetProcessingState],
  );

  // Async action: load video from file
  const loadVideoAsync = useCallback(
    (file: File, volume = 1, playbackRate = 1, options?: { preserveScale?: boolean }) => {
      const objectUrl = URL.createObjectURL(file);
      return loadVideoSourceAsync(
        objectUrl,
        volume,
        playbackRate,
        {
          file: file.name,
          sizeMiB: (file.size / (1024 * 1024)).toFixed(2),
          type: file.type || "unknown",
        },
        objectUrl,
        options,
      );
    },
    [loadVideoSourceAsync],
  );

  // Async action: load video directly from URL (used for local test assets)
  const loadVideoFromUrlAsync = useCallback(
    (src: string, volume = 1, playbackRate = 1, options?: { preserveScale?: boolean }) =>
      loadVideoSourceAsync(src, volume, playbackRate, { src, type: "url" }, undefined, options),
    [loadVideoSourceAsync],
  );

  // Async action: load media (routes to image or video)
  const loadMediaAsync = useCallback(
    (file: File, volume = 1, playbackRate = 1, options?: { preserveScale?: boolean }) => {
      if (file.type.startsWith("video/")) {
        return loadVideoAsync(file, volume, playbackRate, options);
      } else {
        return loadImageAsync(file, options);
      }
    },
    [loadImageAsync, loadVideoAsync],
  );

  // Execute the full filter chain on the input canvas
  // Serialize filter options for worker (replace palette objects with serializable form)
  const serializeOptions = (options?: Record<string, unknown>) => {
    const opts = { ...options } as SerializableOptions & { palette?: SerializablePalette };
    if (
      opts.palette &&
      typeof opts.palette === "object" &&
      typeof (opts.palette as { name?: unknown }).name === "string" &&
      typeof (opts.palette as { getColor?: unknown }).getColor === "function"
    ) {
      opts.palette = serializePalette(opts.palette as never);
    }
    return opts;
  };

  const cloneLiveTemporalState = () => ({
    prevOutputMap: new Map(
      Array.from(prevOutputMapRef.current, ([id, pixels]) => [id, new Uint8ClampedArray(pixels)]),
    ),
    prevInputMap: new Map(
      Array.from(prevInputMapRef.current, ([id, pixels]) => [id, new Uint8ClampedArray(pixels)]),
    ),
    emaMap: new Map(
      Array.from(emaMapRef.current, ([id, values]) => [id, new Float32Array(values)]),
    ),
    frameIndex: frameCountRef.current,
  });

  const commitLiveTemporalState = (temporalState: ReturnType<typeof cloneLiveTemporalState>) => {
    prevOutputMapRef.current = temporalState.prevOutputMap;
    prevInputMapRef.current = temporalState.prevInputMap;
    emaMapRef.current = temporalState.emaMap;
  };

  // Main-thread filter execution (fallback path). Async so filters that
  // return a Promise<canvas> (e.g. glitchblob — async Blob round-trip)
  // fit the same contract as the worker path does.
  const filterOnMainThread = async (
    canvas: HTMLCanvasElement | OffscreenCanvas,
    enabledEntries: ChainEntry[],
    startIdx: number,
    isAnimating: boolean,
    curState: FilterReducerState,
    temporalState = {
      prevOutputMap: prevOutputMapRef.current,
      prevInputMap: prevInputMapRef.current,
      emaMap: emaMapRef.current,
      frameIndex: frameCountRef.current,
    },
    dispatchOverride = dispatch,
    cacheOutputs = true,
    expectedGeneration?: number,
  ) => {
    const stagedOutputs = new Map<string, HTMLCanvasElement>();
    const ownedRunOutputs = new Set<HTMLCanvasElement>();
    const chain: FilterChainEntry[] = enabledEntries.map((entry) => ({
      id: entry.id,
      filter: entry.filter,
      displayName: entry.displayName,
      ...(entry.filter.options ? { options: entry.filter.options } : {}),
    }));
    const libraryTemporalState: TemporalFilterState = {
      prevOutputs: temporalState.prevOutputMap,
      prevInputs: temporalState.prevInputMap,
      ema: temporalState.emaMap,
      frameIndex: temporalState.frameIndex,
    };
    try {
      const result = await runFilterChain(
        canvas,
        chain,
        {
          linearize: curState.linearize,
          wasmAcceleration: curState.wasmAcceleration,
          webglAcceleration: curState.webglAcceleration,
          onError: (error, entry) => {
            console.error(`Filter "${entry.displayName ?? String(entry.filter)}" threw:`, error);
          },
        },
        {
          frameIndex: temporalState.frameIndex,
          isAnimating,
          hasVideoInput: !!curState.video,
          degaussFrame: degaussFrameRef.current,
          startIndex: startIdx,
          dispatch: dispatchOverride,
          temporalState: libraryTemporalState,
          resolveOptions: (_entry, index) => withAudioModulatedOptions(enabledEntries[index]),
          onStep: (step) => {
            const generationCurrent =
              expectedGeneration === undefined ||
              expectedGeneration === processingGenerationRef.current;
            if (
              generationCurrent &&
              step.canvas instanceof HTMLCanvasElement &&
              step.canvas !== canvas
            ) {
              ownedRunOutputs.add(step.canvas);
            }
            if (
              cacheOutputs &&
              generationCurrent &&
              step.canvas instanceof HTMLCanvasElement &&
              step.canvas !== canvas
            ) {
              stagedOutputs.set(step.id, step.canvas);
            }
            recordFilterStepMs(step.filterName, step.ms);
          },
          retainStepCanvases: cacheOutputs,
          ...(expectedGeneration === undefined
            ? {}
            : { shouldAbort: () => expectedGeneration !== processingGenerationRef.current }),
        },
      );
      const stepTimes = result.steps.map((step) =>
        step.backend
          ? { name: step.name, ms: step.ms, backend: step.backend }
          : { name: step.name, ms: step.ms },
      );
      return {
        canvas: result.canvas,
        stepTimes,
        totalTime: result.totalTime,
        stagedOutputs,
      };
    } catch (error) {
      let ownedIndex = 0;
      for (const owned of ownedRunOutputs) {
        if (!Array.from(stagedOutputs.values()).includes(owned)) {
          stagedOutputs.set(`__owned_${ownedIndex}`, owned);
          ownedIndex += 1;
        }
      }
      discardStagedOutputs(stagedOutputs, canvas);
      throw error;
    }
  };

  const emitOutput = (
    canvas: HTMLCanvasElement | OffscreenCanvas,
    totalTime: number,
    stepTimes: { name: string; ms: number; backend?: string }[],
    frameToken: number,
    sourceTime: number,
  ) => {
    frameCountRef.current += 1;
    filteringRef.current = false;
    dispatch({
      type: "FILTER_IMAGE",
      image: canvas as HTMLCanvasElement,
      frameToken,
      time: sourceTime,
      frameTime: totalTime,
      stepTimes,
    });
    if (pendingFilterRef.current) {
      pendingFilterRef.current = false;
      requestAnimationFrame(() => {
        const latestCanvas = stateRef.current.inputCanvas;
        if (latestCanvas) {
          filterImageAsyncRef.current?.(latestCanvas);
        }
      });
    }
  };

  const filterImageAsync: FilterRunner = (input) => {
    if (!input) return;
    // Drop frame if previous filter hasn't finished (prevents queue buildup during video)
    if (filteringRef.current) {
      pendingFilterRef.current = true;
      return;
    }
    filteringRef.current = true;
    const processingGeneration = processingGenerationRef.current;
    const curState = stateRef.current;
    const sourceFrameToken = curState.inputFrameToken ?? 0;
    const sourceTime = curState.time ?? 0;
    const chain = curState.chain;
    const isAnimating = Boolean(
      animLoopRef.current != null ||
      degaussAnimRef.current != null ||
      (curState.video && !curState.video.paused),
    );

    let sourceCanvasId = sourceCanvasIdsRef.current.get(input);
    if (sourceCanvasId === undefined) {
      sourceCanvasId = nextSourceCanvasIdRef.current;
      nextSourceCanvasIdRef.current += 1;
      sourceCanvasIdsRef.current.set(input, sourceCanvasId);
    }
    const chainKey = [
      sourceFrameToken,
      sourceCanvasId,
      chain.map((e) => e.id + (e.enabled ? "1" : "0")).join(","),
    ].join("|");
    if (chainKey !== cachedChainOrderRef.current) {
      clearCachedOutputs();
      cachedChainOrderRef.current = chainKey;
    }

    let canvas = input;
    const stepTimes: { name: string; ms: number; backend?: string }[] = [];

    const enabledEntries = chain.filter((e) => e.enabled && typeof e.filter?.func === "function");

    let startIdx = 0;
    let pinnedPrefixCanvas: HTMLCanvasElement | null = null;
    if (!isAnimating && enabledEntries.length > 1) {
      for (let i = enabledEntries.length - 1; i >= 0; i--) {
        const cached = cachedOutputsRef.current.get(enabledEntries[i].id);
        if (cached) {
          canvas = cached;
          pinnedPrefixCanvas = cached;
          pinCachedCanvas(cached);
          startIdx = i + 1;
          for (let j = 0; j <= i; j++) {
            stepTimes.push({ name: enabledEntries[j].displayName, ms: 0 });
          }
          break;
        }
      }
    }
    let prefixReleased = false;
    const releasePinnedPrefix = () => {
      if (!pinnedPrefixCanvas || prefixReleased) return;
      prefixReleased = true;
      unpinCachedCanvas(pinnedPrefixCanvas);
    };

    let preprocessingCanvas: HTMLCanvasElement | null = null;
    if (startIdx === 0 && curState.convertGrayscale) {
      const maybeGrayscale = grayscale.func(canvas);
      if (maybeGrayscale instanceof HTMLCanvasElement) {
        if (maybeGrayscale !== canvas) preprocessingCanvas = maybeGrayscale;
        canvas = maybeGrayscale;
      }
    }
    let preprocessingReleased = false;
    const releasePreprocessingCanvas = () => {
      if (!preprocessingCanvas || preprocessingReleased) return;
      preprocessingReleased = true;
      releaseOrDeferCanvas(preprocessingCanvas);
    };

    const entriesToRun = enabledEntries.slice(startIdx);
    const useWorker = USE_WORKER;

    if (useWorker && entriesToRun.length > 0) {
      // Worker path — async, dispatches output when done
      workerRequestInFlightRef.current = true;
      let workerRequest: ReturnType<typeof workerRPC>;
      try {
        const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null;
        if (!ctx) throw new Error("Failed to initialize filter input canvas");
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const chainConfig = entriesToRun.map((e) => ({
          id: e.id,
          filterName: e.filter.name,
          displayName: e.displayName,
          options: serializeOptions(withAudioModulatedOptions(e)),
        }));

        const serializedPrevOutputs: Record<string, ArrayBuffer> = {};
        for (const entry of entriesToRun) {
          const prev = prevOutputMapRef.current.get(entry.id);
          if (prev && getFilterHistory(entry.filter).prevOutput) {
            const copy = new Uint8ClampedArray(prev);
            serializedPrevOutputs[entry.id] = copy.buffer as ArrayBuffer;
          }
        }
        const serializedPrevInputs: Record<string, ArrayBuffer> = {};
        for (const entry of entriesToRun) {
          const prev = prevInputMapRef.current.get(entry.id);
          if (prev && getFilterHistory(entry.filter).prevInput) {
            const copy = new Uint8ClampedArray(prev);
            serializedPrevInputs[entry.id] = copy.buffer as ArrayBuffer;
          }
        }
        const serializedEmaMaps: Record<string, ArrayBuffer> = {};
        for (const entry of entriesToRun) {
          const ema = emaMapRef.current.get(entry.id);
          if (ema && getFilterHistory(entry.filter).ema) {
            const copy = new Float32Array(ema);
            serializedEmaMaps[entry.id] = copy.buffer as ArrayBuffer;
          }
        }

        const transfers: ArrayBuffer[] = [imageData.data.buffer];
        for (const buf of Object.values(serializedPrevOutputs)) transfers.push(buf);
        for (const buf of Object.values(serializedPrevInputs)) transfers.push(buf);
        for (const buf of Object.values(serializedEmaMaps)) transfers.push(buf);

        workerRequest = workerRPC(
          {
            imageData: imageData.data.buffer,
            width: canvas.width,
            height: canvas.height,
            chain: chainConfig,
            frameIndex: frameCountRef.current,
            isAnimating,
            linearize: curState.linearize,
            wasmAcceleration: curState.wasmAcceleration,
            webglAcceleration: curState.webglAcceleration,
            convertGrayscale: false,
            prevOutputs: serializedPrevOutputs,
            prevInputs: serializedPrevInputs,
            emaMaps: serializedEmaMaps,
            // Propagate degauss trigger to rgbStripe in the worker. -Infinity
            // (the "never degaussed" sentinel) doesn't survive structured-clone
            // cleanly — use a large negative sentinel instead so the worker
            // sees a finite number.
            degaussFrame: Number.isFinite(degaussFrameRef.current)
              ? degaussFrameRef.current
              : -2147483648,
          },
          transfers,
        );
      } catch (error) {
        // Normalize every synchronous setup failure into the same contained
        // worker-fallback path. Attaching the chain below guarantees that
        // preprocessing and cached-prefix ownership always reach `finally`.
        workerRequest = Promise.reject(error);
      }
      workerRequest
        .then((result) => {
          if (processingGeneration !== processingGenerationRef.current) {
            releasePreprocessingCanvas();
            return;
          }
          workerRequestInFlightRef.current = false;
          const stagedWorkerOutputs = new Map<string, HTMLCanvasElement>();
          const ownedWorkerCanvases = new Set<HTMLCanvasElement>();
          const stagedWorkerTemporalState = cloneLiveTemporalState();
          const historyById = new Map(
            entriesToRun.map((entry) => [entry.id, getFilterHistory(entry.filter)]),
          );
          for (const [id, history] of historyById) {
            if (!history.prevOutput) stagedWorkerTemporalState.prevOutputMap.delete(id);
            if (!history.prevInput) stagedWorkerTemporalState.prevInputMap.delete(id);
            if (!history.ema) stagedWorkerTemporalState.emaMap.delete(id);
          }
          let outCanvas: HTMLCanvasElement;
          let transactionCommitted = false;
          try {
            const outData = new ImageData(
              new Uint8ClampedArray(result.imageData),
              result.width,
              result.height,
            );
            outCanvas = takePooledCanvas(result.width, result.height) as HTMLCanvasElement;
            ownedWorkerCanvases.add(outCanvas);
            // willReadFrequently on the first getContext call — subsequent filter
            // passes will do getImageData on this canvas repeatedly, and the flag
            // is sticky from the first call.
            const outContext = outCanvas.getContext("2d", { willReadFrequently: true });
            if (!outContext) throw new Error("Failed to initialize worker output canvas");
            outContext.putImageData(outData, 0, 0);

            for (const [entryId, payload] of Object.entries(result.prevOutputs)) {
              const { pixels, width, height } = getWorkerPrevOutputFrame(
                payload as WorkerPrevOutputPayload,
                result.width,
                result.height,
              );
              if (historyById.get(entryId)?.prevOutput)
                stagedWorkerTemporalState.prevOutputMap.set(entryId, pixels);

              // A preview remains invisible until the complete worker response
              // validates. Never mutate a live cached canvas in place: fallback
              // must continue to see the last successfully committed preview.
              const stepCanvas = takePooledCanvas(width, height) as HTMLCanvasElement;
              ownedWorkerCanvases.add(stepCanvas);
              const stepContext = stepCanvas.getContext("2d", { willReadFrequently: true });
              if (!stepContext)
                throw new Error(`Failed to initialize worker preview canvas for ${entryId}`);
              stepContext.putImageData(new ImageData(pixels, width, height), 0, 0);
              stagedWorkerOutputs.set(entryId, stepCanvas);
            }

            // Merge into a private temporal snapshot. A malformed buffer or a
            // bookkeeping exception must not affect fallback's starting state.
            for (const [entryId, buffer] of Object.entries(result.prevInputs ?? {})) {
              if (historyById.get(entryId)?.prevInput)
                stagedWorkerTemporalState.prevInputMap.set(entryId, new Uint8ClampedArray(buffer));
            }
            for (const [entryId, buffer] of Object.entries(result.emaMaps ?? {})) {
              if (historyById.get(entryId)?.ema)
                stagedWorkerTemporalState.emaMap.set(entryId, new Float32Array(buffer));
            }

            const workerStepTimes = [...stepTimes, ...result.stepTimes];
            const workerTotalTime = result.stepTimes.reduce((a, s) => a + s.ms, 0);
            // Run timing bookkeeping before publishing any staged state. Tests
            // and instrumentation may reject, in which case fallback must start
            // from the previous committed transaction.
            for (const step of result.stepTimes) {
              recordFilterStepMs(step.filterName ?? step.name, step.ms);
            }

            commitCachedOutputs(stagedWorkerOutputs);
            commitLiveTemporalState(stagedWorkerTemporalState);
            transactionCommitted = true;

            // Ownership of previews transfers to the cache and ownership of the
            // final canvas transfers to reducer state through emitOutput below.
            ownedWorkerCanvases.clear();
            releasePreprocessingCanvas();
            emitOutput(outCanvas, workerTotalTime, workerStepTimes, sourceFrameToken, sourceTime);
          } finally {
            if (!transactionCommitted) {
              stagedWorkerOutputs.clear();
              for (const owned of ownedWorkerCanvases) releaseOrDeferCanvas(owned);
              ownedWorkerCanvases.clear();
            }
          }
        })
        .catch(async (err) => {
          if (processingGeneration !== processingGenerationRef.current) {
            releasePreprocessingCanvas();
            return;
          }
          workerRequestInFlightRef.current = false;
          console.error("Worker failed, falling back to main thread:", err);
          const fallbackTemporalState = cloneLiveTemporalState();
          const fallback = await filterOnMainThread(
            canvas,
            enabledEntries,
            startIdx,
            Boolean(isAnimating),
            curState,
            fallbackTemporalState,
            undefined,
            true,
            processingGeneration,
          );
          if (processingGeneration !== processingGenerationRef.current) {
            discardStagedOutputs(fallback.stagedOutputs, canvas);
            releasePreprocessingCanvas();
            return;
          }
          commitCachedOutputs(fallback.stagedOutputs);
          commitLiveTemporalState(fallbackTemporalState);
          releasePreprocessingCanvas();
          emitOutput(
            fallback.canvas,
            fallback.totalTime,
            [...stepTimes, ...fallback.stepTimes],
            sourceFrameToken,
            sourceTime,
          );
        })
        .catch((fallbackError) => {
          releasePreprocessingCanvas();
          if (processingGeneration === processingGenerationRef.current) {
            filteringRef.current = false;
            pendingFilterRef.current = false;
            console.error("Main-thread worker fallback failed:", fallbackError);
          }
        })
        .finally(releasePinnedPrefix);
    } else {
      // Main thread path — may await filters that return a Promise
      // (e.g. glitchblob's async Blob round-trip).
      void (async () => {
        try {
          const mainTemporalState = cloneLiveTemporalState();
          const result = await filterOnMainThread(
            canvas,
            enabledEntries,
            startIdx,
            Boolean(isAnimating),
            curState,
            mainTemporalState,
            undefined,
            true,
            processingGeneration,
          );
          if (processingGeneration !== processingGenerationRef.current) {
            discardStagedOutputs(result.stagedOutputs, canvas);
            releasePreprocessingCanvas();
            return;
          }
          commitCachedOutputs(result.stagedOutputs);
          commitLiveTemporalState(mainTemporalState);
          if (result.canvas !== preprocessingCanvas) releasePreprocessingCanvas();
          stepTimes.push(...result.stepTimes);
          emitOutput(result.canvas, result.totalTime, stepTimes, sourceFrameToken, sourceTime);
        } catch (error) {
          releasePreprocessingCanvas();
          if (processingGeneration === processingGenerationRef.current) {
            filteringRef.current = false;
            pendingFilterRef.current = false;
            console.error("Main-thread filter chain failed:", error);
          }
        } finally {
          releasePinnedPrefix();
        }
      })();
    }
  };
  filterImageAsyncRef.current = filterImageAsync;

  const playDegaussSound = () => {
    try {
      const ctx = new AudioContext();
      const duration = 2.2;
      const now = ctx.currentTime;

      // Master gain — overall envelope
      const master = ctx.createGain();
      master.gain.setValueAtTime(0, now);
      // Sharp attack from relay thunk
      master.gain.linearRampToValueAtTime(0.35, now + 0.02);
      // Sustain then decay like a thermistor reducing current
      master.gain.setValueAtTime(0.3, now + 0.1);
      master.gain.exponentialRampToValueAtTime(0.15, now + 0.5);
      master.gain.exponentialRampToValueAtTime(0.03, now + 1.5);
      master.gain.exponentialRampToValueAtTime(0.001, now + duration);
      master.connect(ctx.destination);

      // Low resonant filter — the degauss coil acts as a resonant cavity
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.exponentialRampToValueAtTime(120, now + duration);
      filter.Q.setValueAtTime(3, now);
      filter.connect(master);

      // 50Hz mains hum — core degauss frequency with wobble
      const hum = ctx.createOscillator();
      hum.type = "sawtooth";
      hum.frequency.setValueAtTime(55, now);
      hum.frequency.linearRampToValueAtTime(48, now + duration);
      // LFO to wobble the hum frequency (warbling quality)
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(8, now);
      lfo.frequency.linearRampToValueAtTime(3, now + duration);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(4, now);
      lfoGain.gain.linearRampToValueAtTime(1, now + duration);
      lfo.connect(lfoGain).connect(hum.frequency);
      lfo.start(now);
      lfo.stop(now + duration);
      const humGain = ctx.createGain();
      humGain.gain.setValueAtTime(0.7, now);
      hum.connect(humGain).connect(filter);
      hum.start(now);
      hum.stop(now + duration);

      // 100Hz second harmonic
      const harm2 = ctx.createOscillator();
      harm2.type = "sawtooth";
      harm2.frequency.setValueAtTime(110, now);
      harm2.frequency.linearRampToValueAtTime(96, now + duration);
      const harm2Gain = ctx.createGain();
      harm2Gain.gain.setValueAtTime(0.35, now);
      harm2.connect(harm2Gain).connect(filter);
      harm2.start(now);
      harm2.stop(now + duration);

      // 150Hz metallic buzz
      const harm3 = ctx.createOscillator();
      harm3.type = "square";
      harm3.frequency.setValueAtTime(165, now);
      harm3.frequency.linearRampToValueAtTime(144, now + duration);
      const harm3Gain = ctx.createGain();
      harm3Gain.gain.setValueAtTime(0.12, now);
      harm3.connect(harm3Gain).connect(filter);
      harm3.start(now);
      harm3.stop(now + duration);

      // Sub-bass body — the physical vibration of the coil/chassis
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(30, now);
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.25, now);
      subGain.gain.exponentialRampToValueAtTime(0.01, now + 1.0);
      sub.connect(subGain).connect(master);
      sub.start(now);
      sub.stop(now + duration);

      // Initial relay thunk — filtered noise burst
      const thunkLen = Math.round(ctx.sampleRate * 0.06);
      const thunkBuf = ctx.createBuffer(1, thunkLen, ctx.sampleRate);
      const thunkData = thunkBuf.getChannelData(0);
      for (let i = 0; i < thunkLen; i++) {
        const env = Math.exp(-i / (ctx.sampleRate * 0.012));
        thunkData[i] = (Math.random() * 2 - 1) * env;
      }
      const thunk = ctx.createBufferSource();
      thunk.buffer = thunkBuf;
      const thunkGain = ctx.createGain();
      thunkGain.gain.setValueAtTime(0.5, now);
      const thunkFilter = ctx.createBiquadFilter();
      thunkFilter.type = "bandpass";
      thunkFilter.frequency.setValueAtTime(800, now);
      thunkFilter.Q.setValueAtTime(1.5, now);
      thunk.connect(thunkFilter).connect(thunkGain).connect(master);
      thunk.start(now);

      // Clean up
      setTimeout(() => ctx.close(), (duration + 0.2) * 1000);
    } catch {
      // Audio not available — degauss visually only
    }
  };

  const triggerDegauss = (inputCanvas: HTMLCanvasElement | null) => {
    if (degaussAnimRef.current != null) return; // already running
    degaussFrameRef.current = frameCountRef.current;
    playDegaussSound();
    const DEGAUSS_FRAMES = 45;
    let frame = 0;
    const animate = () => {
      if (frame >= DEGAUSS_FRAMES || !inputCanvas) {
        degaussAnimRef.current = null;
        return;
      }
      filterImageAsync(inputCanvas);
      frame += 1;
      degaussAnimRef.current = requestAnimationFrame(animate);
    };
    degaussAnimRef.current = requestAnimationFrame(animate);
  };

  const triggerBurst = (inputCanvas: HTMLCanvasElement | null, frames: number, fps = 6) => {
    if (animLoopRef.current != null) return; // don't overlap with running animation
    const interval = 1000 / fps;
    let frame = 0;
    let lastTime = 0;
    const animate = (timestamp: number) => {
      if (frame >= frames || !inputCanvas) {
        animLoopRef.current = null;
        // Fire one final non-animated render so _isAnimating=false,
        // guaranteeing we end on a normal display phase
        requestAnimationFrame(() => {
          filterImageAsync(inputCanvas);
        });
        return;
      }
      if (timestamp - lastTime >= interval) {
        lastTime = timestamp;
        filterImageAsync(inputCanvas);
        frame += 1;
      }
      animLoopRef.current = requestAnimationFrame(animate);
    };
    animLoopRef.current = requestAnimationFrame(animate);
  };

  const startAnimLoop = (inputCanvas: HTMLCanvasElement | null, fps = 15) => {
    if (animLoopRef.current != null) return; // already running
    animParamsRef.current = { inputCanvas, fps };
    animLastTimeRef.current = 0;
    const animate = (timestamp: number) => {
      const params = animParamsRef.current;
      if (!params || !params.inputCanvas) {
        animLoopRef.current = null;
        return;
      }
      const curState = stateRef.current;
      const animSpeed = curState.selected?.filter?.options?.animSpeed;
      const curFps = typeof animSpeed === "number" ? animSpeed : params.fps;
      const interval = 1000 / curFps;
      if (timestamp - animLastTimeRef.current >= interval) {
        animLastTimeRef.current = timestamp;
        const filterFn = filterImageAsyncRef.current;
        if (filterFn) {
          filterFn(params.inputCanvas);
        }
      }
      animLoopRef.current = requestAnimationFrame(animate);
    };
    animLoopRef.current = requestAnimationFrame(animate);
  };

  const stopAnimLoop = () => {
    if (animLoopRef.current != null) {
      cancelAnimationFrame(animLoopRef.current);
      animLoopRef.current = null;
    }
    animLoopAutoStartedRef.current = false;
  };

  const isAnimating = () => animLoopRef.current != null;

  // Called after any chain mutation. If the current animation loop was
  // started by `autoAnimate` and no filter in the chain still opts in,
  // stop the loop so we don't keep running the pipeline for no visible
  // reason. User-started loops (clicking Play on a filter) are left
  // alone so removing one filter doesn't kill an animation the user
  // explicitly started on another.
  const maybeStopAutoAnimLoop = (chain = stateRef.current.chain) => {
    if (!animLoopAutoStartedRef.current) return;
    const stillWantsAuto = chain.some((e) => e.enabled && e.filter?.autoAnimate);
    if (!stillWantsAuto) stopAnimLoop();
  };

  const renderFrameForExport = async (
    inputCanvas: HTMLCanvasElement | null,
    { sessionId, time = 0, video = null }: ExportFrameOptions,
  ) => {
    if (!inputCanvas) return null;

    let session = exportSessionsRef.current.get(sessionId);
    if (!session) {
      session = {
        prevOutputMap: new Map(),
        prevInputMap: new Map(),
        emaMap: new Map(),
        frameIndex: 0,
        outputCanvas: null,
      };
      exportSessionsRef.current.set(sessionId, session);
    }

    if (session.outputCanvas) {
      releasePooledCanvas(session.outputCanvas);
      session.outputCanvas = null;
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = inputCanvas.width;
    exportCanvas.height = inputCanvas.height;
    const ownedInputs = new Set<HTMLCanvasElement>([exportCanvas]);
    let resultCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
    try {
      const exportCtx = exportCanvas.getContext("2d", { willReadFrequently: true });
      if (!exportCtx) return null;
      exportCtx.drawImage(inputCanvas, 0, 0);

      let canvas = exportCanvas;
      const exportState = {
        ...stateRef.current,
        time,
        video,
      };

      if (exportState.convertGrayscale) {
        const maybeGrayscale = grayscale.func(canvas);
        if (maybeGrayscale instanceof HTMLCanvasElement) {
          ownedInputs.add(maybeGrayscale);
          canvas = maybeGrayscale;
        }
      }

      const enabledEntries = exportState.chain.filter(
        (e) => e.enabled && typeof e.filter?.func === "function",
      );
      const result = await filterOnMainThread(
        canvas,
        enabledEntries,
        0,
        true,
        exportState,
        session,
        () => {},
        false,
      );
      resultCanvas = result.canvas;
      session.frameIndex += 1;
      session.outputCanvas = result.canvas instanceof HTMLCanvasElement ? result.canvas : null;
      return result.canvas;
    } catch (error) {
      session.prevOutputMap.clear();
      session.prevInputMap.clear();
      session.emaMap.clear();
      session.frameIndex = 0;
      session.outputCanvas = null;
      exportSessionsRef.current.delete(sessionId);
      throw error;
    } finally {
      for (const owned of ownedInputs) {
        if (owned !== resultCanvas) releasePooledCanvas(owned);
      }
    }
  };

  const clearExportSession = (sessionId: string) => {
    const session = exportSessionsRef.current.get(sessionId);
    if (session?.outputCanvas) releasePooledCanvas(session.outputCanvas);
    exportSessionsRef.current.delete(sessionId);
  };

  const actions: FilterActions = {
    loadMediaAsync,
    loadVideoFromUrlAsync,
    filterImageAsync,
    triggerDegauss,
    triggerBurst,
    startAnimLoop,
    stopAnimLoop,
    isAnimating,
    renderFrameForExport,
    clearExportSession,
    loadImage: (
      image: CanvasImageSource,
      time?: number | null,
      video?: AnimatedVideoElement | null,
    ) => {
      resetProcessingState();
      dispatch({
        type: "LOAD_IMAGE",
        image: image as any,
        time: time || 0,
        frameToken: stateRef.current.inputFrameToken ?? 0,
        video: video || null,
        dispatch,
      });
    },
    selectFilter: (name, filter) => {
      invalidateProcessingGeneration();
      stopAnimLoop();
      prevOutputMapRef.current.clear();
      prevInputMapRef.current.clear();
      emaMapRef.current.clear();
      clearMotionVectorsState();
      clearCachedOutputs();
      dispatch({ type: "SELECT_FILTER", name, filter });
      maybeStopAutoAnimLoop();
    },
    setConvertGrayscale: (value: boolean) => {
      invalidateProcessingGeneration();
      clearCachedOutputs();
      dispatch({ type: "SET_GRAYSCALE", value });
    },
    setLinearize: (value: boolean) => {
      invalidateProcessingGeneration();
      clearCachedOutputs();
      dispatch({ type: "SET_LINEARIZE", value });
    },
    setWasmAcceleration: (value: boolean) => {
      invalidateProcessingGeneration();
      clearCachedOutputs();
      dispatch({ type: "SET_WASM_ACCELERATION", value });
    },
    setWebglAcceleration: (value: boolean) => {
      invalidateProcessingGeneration();
      clearCachedOutputs();
      dispatch({ type: "SET_WEBGL_ACCELERATION", value });
    },
    setRandomCycleSeconds: (seconds: number | null) =>
      dispatch({ type: "SET_RANDOM_CYCLE_SECONDS", seconds }),
    setScale: (scale: number) => {
      invalidateProcessingGeneration();
      clearCachedOutputs();
      dispatch({ type: "SET_SCALE", scale });
    },
    setOutputScale: (scale: number) => {
      invalidateProcessingGeneration();
      clearCachedOutputs();
      dispatch({ type: "SET_OUTPUT_SCALE", scale });
    },
    setRealtimeFiltering: (enabled: boolean) => {
      invalidateProcessingGeneration();
      dispatch({ type: "SET_REAL_TIME_FILTERING", enabled });
    },
    setInputCanvas: (canvas: HTMLCanvasElement | null) => {
      invalidateProcessingGeneration();
      clearCachedOutputs();
      dispatch({ type: "SET_INPUT_CANVAS", canvas });
    },
    setInputVolume: (volume: number) => dispatch({ type: "SET_INPUT_VOLUME", volume }),
    setInputPlaybackRate: (rate: number) => dispatch({ type: "SET_INPUT_PLAYBACK_RATE", rate }),
    toggleVideo: () => {
      const video = stateRef.current.video as AnimatedVideoElement | null;
      if (!video) return;
      if (video.paused) {
        video.__manualPause = false;
        video.play();
      } else {
        video.__manualPause = true;
        video.pause();
      }
    },
    setScalingAlgorithm: (algorithm: string) => {
      invalidateProcessingGeneration();
      clearCachedOutputs();
      dispatch({ type: "SET_SCALING_ALGORITHM", algorithm });
    },
    setFilterOption: (optionName: string, value: FilterOptionValue, chainIndex?: number) => {
      invalidateProcessingGeneration();
      const ci = chainIndex ?? stateRef.current.activeIndex;
      evictCachedOutputsFromChainIndex(ci);
      clearMotionVectorsState();
      dispatch({
        type: "SET_FILTER_OPTION",
        optionName,
        value,
        ...(chainIndex !== undefined ? { chainIndex } : {}),
      });
    },
    setFilterPaletteOption: (optionName: string, value: FilterOptionValue, chainIndex?: number) => {
      invalidateProcessingGeneration();
      const ci = chainIndex ?? stateRef.current.activeIndex;
      evictCachedOutputsFromChainIndex(ci);
      clearMotionVectorsState();
      dispatch({
        type: "SET_FILTER_PALETTE_OPTION",
        optionName,
        value,
        ...(chainIndex !== undefined ? { chainIndex } : {}),
      });
    },
    addPaletteColor: (color: number[], chainIndex?: number) => {
      invalidateProcessingGeneration();
      const ci = chainIndex ?? stateRef.current.activeIndex;
      evictCachedOutputsFromChainIndex(ci);
      clearMotionVectorsState();
      dispatch({
        type: "ADD_PALETTE_COLOR",
        color,
        ...(chainIndex !== undefined ? { chainIndex } : {}),
      });
    },
    importState: (json: string) => {
      const deserialized = JSON.parse(json) as SerializedFilterState;
      invalidateProcessingGeneration();
      prevOutputMapRef.current.clear();
      prevInputMapRef.current.clear();
      emaMapRef.current.clear();
      clearMotionVectorsState();
      clearCachedOutputs();
      dispatch({ type: "LOAD_STATE", data: deserialized });
      restoreAudioVizFromShareState(deserialized);
    },
    saveCurrentColorPalette: (name: string, colors: number[][]) => {
      window.localStorage.setItem(
        `_palette_${name.replace(" ", "")}`,
        JSON.stringify({ type: PALETTE, name, colors }),
      );
      THEMES[name] = colors;
      dispatch({ type: "SAVE_CURRENT_COLOR_PALETTE", name });
    },
    deleteCurrentColorPalette: (name: string) => {
      window.localStorage.removeItem(`_palette_${name.replace(" ", "")}`);
      delete THEMES[name];
      dispatch({ type: "DELETE_CURRENT_COLOR_PALETTE", name });
    },
    // Chain actions
    chainAdd: (displayName: string, filter) => {
      invalidateProcessingGeneration();
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_ADD", displayName, filter });
      // Filters with `autoAnimate: true` in their metadata (e.g., CRT
      // Degauss) kick off the animation loop on add so the user doesn't
      // have to hunt for a Play/Stop control. Skip if a loop is already
      // running (another filter may have started it).
      if (filter?.autoAnimate && animLoopRef.current == null) {
        const canvas = stateRef.current.inputCanvas;
        if (canvas instanceof HTMLCanvasElement) {
          startAnimLoop(canvas, filter.autoAnimateFps ?? 20);
          animLoopAutoStartedRef.current = true;
        }
      }
    },
    chainRemove: (id: string) => {
      invalidateProcessingGeneration();
      const chainIndex = stateRef.current.chain.findIndex((entry) => entry.id === id);
      evictCachedOutputsFromChainIndex(chainIndex);
      const nextChain = stateRef.current.chain.filter((entry) => entry.id !== id);
      prevOutputMapRef.current.delete(id);
      prevInputMapRef.current.delete(id);
      emaMapRef.current.delete(id);
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_REMOVE", id });
      maybeStopAutoAnimLoop(nextChain);
    },
    chainReorder: (fromIndex: number, toIndex: number) => {
      invalidateProcessingGeneration();
      prevOutputMapRef.current.clear();
      prevInputMapRef.current.clear();
      emaMapRef.current.clear();
      // Reordering invalidates every cached step — a canvas cached at
      // position N is no longer the right output for whatever filter
      // ends up at N after the swap.
      clearCachedOutputs();
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_REORDER", fromIndex, toIndex });
    },
    chainSetActive: (index: number) => {
      dispatch({ type: "CHAIN_SET_ACTIVE", index });
    },
    chainToggle: (id: string) => {
      invalidateProcessingGeneration();
      const chainIndex = stateRef.current.chain.findIndex((entry) => entry.id === id);
      evictCachedOutputsFromChainIndex(chainIndex);
      const nextChain = stateRef.current.chain.map((entry) =>
        entry.id === id ? { ...entry, enabled: !entry.enabled } : entry,
      );
      dispatch({ type: "CHAIN_TOGGLE", id });
      maybeStopAutoAnimLoop(nextChain);
    },
    chainReplace: (id: string, displayName: string, filter) => {
      invalidateProcessingGeneration();
      const chainIndex = stateRef.current.chain.findIndex((entry) => entry.id === id);
      evictCachedOutputsFromChainIndex(chainIndex);
      const nextChain = stateRef.current.chain.map((entry) =>
        entry.id === id ? { ...entry, displayName, filter } : entry,
      );
      prevOutputMapRef.current.delete(id);
      prevInputMapRef.current.delete(id);
      emaMapRef.current.delete(id);
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_REPLACE", id, displayName, filter });
      // If the new filter is autoAnimate and no loop is running, start
      // one; otherwise maybe stop an auto-loop whose trigger is gone.
      if (filter?.autoAnimate && animLoopRef.current == null) {
        const canvas = stateRef.current.inputCanvas;
        if (canvas instanceof HTMLCanvasElement) {
          startAnimLoop(canvas, filter.autoAnimateFps ?? 20);
          animLoopAutoStartedRef.current = true;
        }
      } else {
        maybeStopAutoAnimLoop(nextChain);
      }
    },
    chainDuplicate: (id: string) => {
      invalidateProcessingGeneration();
      const chainIndex = stateRef.current.chain.findIndex((entry) => entry.id === id);
      if (chainIndex >= 0) evictCachedOutputsFromChainIndex(chainIndex + 1);
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_DUPLICATE", id });
    },
    setChainAudioModulation: (id: string, modulation: EntryAudioModulation | null) => {
      invalidateProcessingGeneration();
      const chainIndex = stateRef.current.chain.findIndex((entry) => entry.id === id);
      evictCachedOutputsFromChainIndex(chainIndex);
      clearMotionVectorsState();
      dispatch({ type: "SET_CHAIN_AUDIO_MODULATION", id, modulation });
    },
    copyChainToClipboard: () => {
      try {
        const json = serializeStateJson(stateRef.current);
        navigator.clipboard.writeText(json);
      } catch (e) {
        console.warn("Failed to copy chain:", e);
      }
    },
    pasteChainFromClipboard: async () => {
      try {
        const text = await navigator.clipboard.readText();
        const data = JSON.parse(text) as SerializedFilterState;
        invalidateProcessingGeneration();
        prevOutputMapRef.current.clear();
        prevInputMapRef.current.clear();
        emaMapRef.current.clear();
        clearMotionVectorsState();
        clearCachedOutputs();
        dispatch({ type: "LOAD_STATE", data });
        maybeStopAutoAnimLoop();
      } catch (e) {
        console.warn("Failed to paste chain:", e);
      }
    },
    getExportUrl: (filterState: FilterReducerState) => {
      const json = serializeStateJson(filterState);
      const hash = getShareHash(json, DEFAULT_SHARE_STATE_JSON);
      const search = getShareableTestMediaSearch(window.location.search);
      return `${window.location.origin}${getShareUrl(window.location.pathname, search, hash)}`;
    },
    exportState: (filterState: FilterReducerState) => {
      return serializeStateJson(filterState, true);
    },
    getIntermediatePreview: (entryId: string): HTMLCanvasElement | null =>
      cachedOutputsRef.current.get(entryId) || null,
  };

  return (
    <FilterContext.Provider value={{ state, actions, filterList, grayscale }}>
      {children}
    </FilterContext.Provider>
  );
};
