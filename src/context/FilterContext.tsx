import React, { useReducer, useCallback, useEffect, useRef } from "react";
import filterReducer, { initialState, ChainEntry } from "reducers/filters";
import * as optionTypes from "constants/optionTypes";
import { filterList, grayscale } from "filters";
import { THEMES } from "palettes/user";
import { serializePalette } from "palettes";
import { decodeShareState } from "utils/shareState";
import { getWorkerPrevOutputFrame, WorkerPrevOutputPayload } from "utils";
import { workerRPC, USE_WORKER } from "workers/workerRPC";
import { clearMotionVectorsState } from "filters/motionVectors";
import { FilterContext } from "./filterContextValue";
import { getAutoScale, roundScale } from "./autoScale";
import { getShareHash, getShareUrl } from "./shareUrl";

// Serialize state to v2 format with delta encoding
const serializeState = (state: any) => {
  const chain = state.chain;
  // Single-entry chain with no non-default options: emit v1-compatible format
  if (chain.length === 1) {
    return {
      selected: state.selected,
      convertGrayscale: state.convertGrayscale,
      linearize: state.linearize,
      wasmAcceleration: state.wasmAcceleration,
    };
  }

  const serializedChain = chain.map((entry: ChainEntry) => {
    const result: any = { n: entry.filter.name };
    if (entry.displayName !== entry.filter.name) {
      result.d = entry.displayName;
    }
    // Delta-encode options vs defaults
    const opts = entry.filter.options;
    const defaults = entry.filter.defaults;
    if (opts && defaults) {
      const delta: any = {};
      for (const [k, v] of Object.entries(opts)) {
        if (typeof v === "function") continue;
        if (k === "palette") {
          // Serialize palette with its options
          const pOpts = (v as any)?.options;
          const pDefaults = defaults.palette?.options;
          if (pOpts && JSON.stringify(pOpts) !== JSON.stringify(pDefaults)) {
            delta.palette = { name: (v as any).name, options: pOpts };
          }
        } else if (JSON.stringify(v) !== JSON.stringify(defaults[k])) {
          delta[k] = v;
        }
      }
      if (Object.keys(delta).length > 0) result.o = delta;
    } else if (opts) {
      // No defaults — serialize all non-function options
      const cleaned: any = {};
      for (const [k, v] of Object.entries(opts)) {
        if (typeof v !== "function") cleaned[k] = v;
      }
      result.o = cleaned;
    }
    if (!entry.enabled) result.e = false;
    return result;
  });

  return {
    v: 2,
    chain: serializedChain,
    g: state.convertGrayscale,
    l: state.linearize,
    w: state.wasmAcceleration,
  };
};

// Produce JSON string for export
const serializeStateJson = (state: any, pretty = false) => {
  const data = serializeState(state);
  const replacer = (k: string, v: any) => {
    if (k === "defaults" || k === "optionTypes" || typeof v === "function") return undefined;
    return v;
  };
  return pretty ? JSON.stringify(data, replacer, 2) : JSON.stringify(data, replacer);
};

const DEFAULT_SHARE_STATE_JSON = serializeStateJson(initialState);

export const FilterProvider = ({ children }) => {
  const [state, dispatch] = useReducer(filterReducer, initialState);
  const prevOutputMapRef = useRef<Map<string, Uint8ClampedArray>>(new Map());
  const prevInputMapRef = useRef<Map<string, Uint8ClampedArray>>(new Map());
  const emaMapRef = useRef<Map<string, Float32Array>>(new Map());
  const cachedOutputsRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const cachedChainOrderRef = useRef<string>("");
  const frameCountRef = useRef(0);
  const degaussFrameRef = useRef(-Infinity);
  const degaussAnimRef = useRef<number | null>(null);
  const animLoopRef = useRef<number | null>(null);
  const animLastTimeRef = useRef(0);
  const animParamsRef = useRef<{ inputCanvas: any; fps: number } | null>(null);
  const filteringRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const filterImageAsyncRef = useRef<any>(null);

  // Restore state from #! hash on initial load
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#!")) return;
    try {
      const json = decodeShareState(hash.slice(2));
      const data = JSON.parse(json);
      dispatch({ type: "LOAD_STATE", data });
    } catch (e) {
      console.warn("Failed to restore state from URL hash:", e);
    }
  }, []);

  // Sync filter state to URL hash so the address bar is always shareable
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
  }, [state.chain, state.activeIndex, state.convertGrayscale, state.linearize, state.wasmAcceleration]);

  // Async action: load image from file
  const loadImageAsync = useCallback((file) => new Promise<void>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to decode image"));
    };
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      filteringRef.current = false;
      dispatch({ type: "LOAD_IMAGE", image, time: null, video: null, dispatch });
      const scale = roundScale(getAutoScale(image.width, image.height));
      dispatch({ type: "SET_SCALE", scale });
      resolve();
    };
    image.src = objectUrl;
  }), []);

  const loadVideoSourceAsync = useCallback((
    src: string,
    volume = 1,
    playbackRate = 1,
    perfMeta: Record<string, string> = {},
    objectUrlForCleanup?: string
  ) => new Promise<void>((resolve, reject) => {
    filteringRef.current = false;
    const video = document.createElement("video") as HTMLVideoElement & {
      __objectUrl?: string;
      __manualPause?: boolean;
      __drawErrorLogged?: boolean;
    };
    const perfStart = performance.now();
    const logPerf = (stage: string) => {
      const elapsedMs = Math.round(performance.now() - perfStart);
      console.info(
        `[perf][video-load] ${stage} +${elapsedMs}ms`,
        perfMeta
      );
    };
    logPerf("start");
    let settled = false;
    const settleResolve = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const settleReject = (error: Error) => {
      if (!settled) {
        settled = true;
        if (objectUrlForCleanup) {
          URL.revokeObjectURL(objectUrlForCleanup);
        }
        reject(error);
      }
    };

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      settleReject(new Error("Failed to initialize video canvas"));
      return;
    }

    let rafId: number | null = null;
    const loadFrame = () => {
      if (!video.paused && video.src !== "") {
        if (!hasLoggedFirstFrame) {
          hasLoggedFirstFrame = true;
          logPerf("first-frame-dispatched");
        }
        try {
          // Some clips can transiently fail drawImage during decode starvation;
          // keep the loop alive instead of silently stalling playback updates.
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            ctx.drawImage(video, 0, 0);
            dispatch({ type: "LOAD_IMAGE", image: canvas, time: video.currentTime, video, dispatch });
          }
        } catch (error) {
          if (!video.__drawErrorLogged) {
            video.__drawErrorLogged = true;
            console.warn("[video-load] drawImage failed; continuing frame loop", error);
          }
        }
        rafId = requestAnimationFrame(loadFrame);
      } else {
        rafId = null;
      }
    };

    let hasLoggedFirstFrame = false;
    video.onerror = () => settleReject(new Error("Failed to decode video"));
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const scale = roundScale(getAutoScale(video.videoWidth, video.videoHeight));
      dispatch({ type: "SET_SCALE", scale });
      logPerf("loadedmetadata");
      settleResolve();
    };
    video.onplaying = () => {
      logPerf("playing");
      // Restart the frame loop every time playback resumes
      video.__manualPause = false;
      if (rafId == null) {
        rafId = requestAnimationFrame(loadFrame);
      }
    };
    video.onpause = () => {
      rafId = null;
      // Recover from unexpected pauses caused by decode/buffering edge cases.
      // Respect explicit user pauses and teardown state (empty src).
      if (!video.__manualPause && video.src !== "" && !video.ended) {
        video.play().catch(() => {});
      }
    };

    video.volume = volume;
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
    video.play().catch(() => {});
  }), []);

  // Async action: load video from file
  const loadVideoAsync = useCallback((file, volume = 1, playbackRate = 1) => {
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
      objectUrl
    );
  }, [loadVideoSourceAsync]);

  // Async action: load video directly from URL (used for local test assets)
  const loadVideoFromUrlAsync = useCallback((src, volume = 1, playbackRate = 1) =>
    loadVideoSourceAsync(
      src,
      volume,
      playbackRate,
      { src, type: "url" }
    ),
  [loadVideoSourceAsync]);

  // Async action: load media (routes to image or video)
  const loadMediaAsync = useCallback((file, volume = 1, playbackRate = 1) => {
    if (file.type.startsWith("video/")) {
      return loadVideoAsync(file, volume, playbackRate);
    } else {
      return loadImageAsync(file);
    }
  }, [loadImageAsync, loadVideoAsync]);

  // Execute the full filter chain on the input canvas
  // Serialize filter options for worker (replace palette objects with serializable form)
  const serializeOptions = (options) => {
    const opts = { ...options };
    if (opts.palette && typeof opts.palette.getColor === "function") {
      opts.palette = serializePalette(opts.palette);
    }
    return opts;
  };

  // A filter must run on the main thread if it reads temporal pipeline state
  // (_prevOutput / _prevInput / _ema), holds module-level state that needs to
  // persist across calls, or uses dispatch. Filters declare this by setting
  // `mainThread: true` on their default export. The flag is the source of
  // truth — no hand-maintained name list here.
  const chainNeedsMainThread = (entries: any[]) =>
    entries.some(e => e.filter?.mainThread === true);

  // Main-thread filter execution (fallback path)
  const filterOnMainThread = (canvas, enabledEntries, startIdx, isAnimating, curState) => {
    const stepTimes: { name: string; ms: number }[] = [];
    let totalTime = 0;

    for (let i = startIdx; i < enabledEntries.length; i++) {
      const entry = enabledEntries[i];

      // Capture input pixels for _prevInput and EMA.
      // Always capture so temporal filters work on first click too.
      let inputData: Uint8ClampedArray | null = null;
      const inputCtx = canvas.getContext("2d");
      if (inputCtx) {
        inputData = inputCtx.getImageData(0, 0, canvas.width, canvas.height).data;
      }

      const filterOpts = {
        ...entry.filter.options,
        _linearize: curState.linearize,
        _wasmAcceleration: curState.wasmAcceleration,
        _hasVideoInput: !!curState.video,
        _prevOutput: prevOutputMapRef.current.get(entry.id) || null,
        _prevInput: prevInputMapRef.current.get(entry.id) || null,
        _ema: emaMapRef.current.get(entry.id) || null,
        _frameIndex: frameCountRef.current,
        _degaussFrame: degaussFrameRef.current,
        _isAnimating: isAnimating,
      };
      if (filterOpts.palette?.options) {
        filterOpts.palette = {
          ...filterOpts.palette,
          options: { ...filterOpts.palette.options, _wasmAcceleration: curState.wasmAcceleration },
        };
      }

      const t0 = performance.now();
      let output;
      try {
        output = entry.filter.func(canvas, filterOpts, dispatch);
      } catch (e) {
        console.error(`Filter "${entry.displayName}" threw:`, e);
        continue;
      }
      const stepMs = performance.now() - t0;
      stepTimes.push({ name: entry.displayName, ms: stepMs });
      totalTime += stepMs;

      // Update temporal buffers
      if (inputData) {
        prevInputMapRef.current.set(entry.id, inputData);

        // Update EMA: ema = ema * (1 - alpha) + input * alpha
        // Alpha 0.1 ≈ ~10 frame averaging window
        const EMA_ALPHA = 0.1;
        let ema = emaMapRef.current.get(entry.id);
        if (!ema || ema.length !== inputData.length) {
          ema = new Float32Array(inputData);
        } else {
          const oneMinusAlpha = 1 - EMA_ALPHA;
          for (let j = 0; j < ema.length; j++) {
            ema[j] = ema[j] * oneMinusAlpha + inputData[j] * EMA_ALPHA;
          }
        }
        emaMapRef.current.set(entry.id, ema);
      }

      if (output instanceof HTMLCanvasElement) {
        const outCtx = output.getContext("2d");
        if (outCtx) {
          prevOutputMapRef.current.set(
            entry.id,
            outCtx.getImageData(0, 0, output.width, output.height).data
          );
        }
        cachedOutputsRef.current.set(entry.id, output);
        canvas = output;
      }
    }

    return { canvas, stepTimes, totalTime };
  };

  const emitOutput = (canvas, totalTime, stepTimes) => {
    frameCountRef.current += 1;
    filteringRef.current = false;
    dispatch({ type: "FILTER_IMAGE", image: canvas, frameTime: totalTime, stepTimes });
  };

  const filterImageAsync = (input) => {
    if (!input) return;
    // Drop frame if previous filter hasn't finished (prevents queue buildup during video)
    if (filteringRef.current) return;
    filteringRef.current = true;
    const curState = stateRef.current;
    const chain = curState.chain;
    const isAnimating = animLoopRef.current != null || degaussAnimRef.current != null || (curState.video && !curState.video.paused);

    const chainKey = chain.map((e) => e.id + (e.enabled ? "1" : "0")).join(",");
    if (chainKey !== cachedChainOrderRef.current) {
      cachedOutputsRef.current.clear();
      cachedChainOrderRef.current = chainKey;
    }

    let canvas = input;
    if (curState.convertGrayscale) {
      canvas = grayscale.func(canvas);
    }

    const stepTimes: { name: string; ms: number }[] = [];

    const enabledEntries = chain.filter((e) => e.enabled && typeof e.filter?.func === "function");

    let startIdx = 0;
    if (!isAnimating && enabledEntries.length > 1) {
      for (let i = enabledEntries.length - 1; i >= 0; i--) {
        const cached = cachedOutputsRef.current.get(enabledEntries[i].id);
        if (cached) {
          canvas = cached;
          startIdx = i + 1;
          for (let j = 0; j <= i; j++) {
            stepTimes.push({ name: enabledEntries[j].displayName, ms: 0 });
          }
          break;
        }
      }
    }

    const entriesToRun = enabledEntries.slice(startIdx);
    const useWorker = USE_WORKER && !chainNeedsMainThread(entriesToRun);

    if (useWorker && entriesToRun.length > 0) {
      // Worker path — async, dispatches output when done
      const ctx = canvas.getContext("2d");
      if (!ctx) { filteringRef.current = false; return; }
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const chainConfig = entriesToRun.map(e => ({
        id: e.id,
        filterName: e.filter.name,
        displayName: e.displayName,
        options: serializeOptions(e.filter.options),
      }));

      const serializedPrevOutputs: Record<string, ArrayBuffer> = {};
      for (const entry of entriesToRun) {
        const prev = prevOutputMapRef.current.get(entry.id);
        if (prev) {
          const copy = new Uint8ClampedArray(prev);
          serializedPrevOutputs[entry.id] = copy.buffer;
        }
      }

      const transfers: ArrayBuffer[] = [imageData.data.buffer];
      for (const buf of Object.values(serializedPrevOutputs)) {
        transfers.push(buf);
      }

      workerRPC({
        imageData: imageData.data.buffer,
        width: canvas.width,
        height: canvas.height,
        chain: chainConfig,
        frameIndex: frameCountRef.current,
        isAnimating,
        linearize: curState.linearize,
        wasmAcceleration: curState.wasmAcceleration,
        convertGrayscale: false,
        prevOutputs: serializedPrevOutputs,
      }, transfers).then((result) => {
        const outData = new ImageData(
          new Uint8ClampedArray(result.imageData), result.width, result.height
        );
        const outCanvas = document.createElement("canvas");
        outCanvas.width = result.width;
        outCanvas.height = result.height;
        outCanvas.getContext("2d")!.putImageData(outData, 0, 0);

        for (const [entryId, payload] of Object.entries(result.prevOutputs)) {
          const { pixels, width, height } = getWorkerPrevOutputFrame(
            payload as WorkerPrevOutputPayload,
            result.width,
            result.height
          );
          prevOutputMapRef.current.set(entryId, pixels);

          // Reconstruct intermediate canvas for step previews.
          // Reuse existing canvas to avoid allocation churn during animation.
          let stepCanvas = cachedOutputsRef.current.get(entryId);
          if (!stepCanvas || stepCanvas.width !== width || stepCanvas.height !== height) {
            stepCanvas = document.createElement("canvas");
            stepCanvas.width = width;
            stepCanvas.height = height;
          }
          stepCanvas.getContext("2d")!.putImageData(
            new ImageData(pixels, width, height), 0, 0
          );
          cachedOutputsRef.current.set(entryId, stepCanvas);
        }

        const workerStepTimes = [...stepTimes, ...result.stepTimes];
        const workerTotalTime = result.stepTimes.reduce((a, s) => a + s.ms, 0);
        emitOutput(outCanvas, workerTotalTime, workerStepTimes);
      }).catch((err) => {
        console.error("Worker failed, falling back to main thread:", err);
        const fallback = filterOnMainThread(canvas, enabledEntries, startIdx, isAnimating, curState);
        emitOutput(fallback.canvas, fallback.totalTime, [...stepTimes, ...fallback.stepTimes]);
      });
    } else {
      // Main thread path — synchronous
      const result = filterOnMainThread(canvas, enabledEntries, startIdx, isAnimating, curState);
      stepTimes.push(...result.stepTimes);
      emitOutput(result.canvas, result.totalTime, stepTimes);
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

  const triggerDegauss = (inputCanvas) => {
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

  const triggerBurst = (inputCanvas, frames, fps = 6) => {
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

  const startAnimLoop = (inputCanvas, fps = 15) => {
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
      const curFps = curState.selected?.filter?.options?.animSpeed || params.fps;
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
  };

  const isAnimating = () => animLoopRef.current != null;

  const actions = {
    loadMediaAsync,
    loadVideoFromUrlAsync,
    filterImageAsync,
    triggerDegauss,
    triggerBurst,
    startAnimLoop,
    stopAnimLoop,
    isAnimating,
    loadImage: (image, time, video) =>
      dispatch({ type: "LOAD_IMAGE", image, time: time || 0, video: video || null, dispatch }),
    selectFilter: (name, filter) => {
      stopAnimLoop();
      prevOutputMapRef.current.clear();
      prevInputMapRef.current.clear();
      emaMapRef.current.clear();
      clearMotionVectorsState();
      cachedOutputsRef.current.clear();
      dispatch({ type: "SELECT_FILTER", name, filter });
    },
    setConvertGrayscale: (value) =>
      dispatch({ type: "SET_GRAYSCALE", value }),
    setLinearize: (value) =>
      dispatch({ type: "SET_LINEARIZE", value }),
    setWasmAcceleration: (value) =>
      dispatch({ type: "SET_WASM_ACCELERATION", value }),
    setScale: (scale) =>
      dispatch({ type: "SET_SCALE", scale }),
    setOutputScale: (scale) =>
      dispatch({ type: "SET_OUTPUT_SCALE", scale }),
    setRealtimeFiltering: (enabled) =>
      dispatch({ type: "SET_REAL_TIME_FILTERING", enabled }),
    setInputCanvas: (canvas) =>
      dispatch({ type: "SET_INPUT_CANVAS", canvas }),
    setInputVolume: (volume) =>
      dispatch({ type: "SET_INPUT_VOLUME", volume }),
    setInputPlaybackRate: (rate) =>
      dispatch({ type: "SET_INPUT_PLAYBACK_RATE", rate }),
    toggleVideo: () => {
      const video = stateRef.current.video;
      if (!video) return;
      if (video.paused) {
        (video as any).__manualPause = false;
        video.play();
      } else {
        (video as any).__manualPause = true;
        video.pause();
      }
    },
    setScalingAlgorithm: (algorithm) =>
      dispatch({ type: "SET_SCALING_ALGORITHM", algorithm }),
    setFilterOption: (optionName, value, chainIndex?) => {
      const ci = chainIndex ?? stateRef.current.activeIndex;
      // Invalidate cache from this entry onward
      const chain = stateRef.current.chain;
      for (let i = ci; i < chain.length; i++) {
        cachedOutputsRef.current.delete(chain[i].id);
      }
      clearMotionVectorsState();
      dispatch({ type: "SET_FILTER_OPTION", optionName, value, chainIndex });
    },
    setFilterPaletteOption: (optionName, value, chainIndex?) => {
      const ci = chainIndex ?? stateRef.current.activeIndex;
      const chain = stateRef.current.chain;
      for (let i = ci; i < chain.length; i++) {
        cachedOutputsRef.current.delete(chain[i].id);
      }
      clearMotionVectorsState();
      dispatch({ type: "SET_FILTER_PALETTE_OPTION", optionName, value, chainIndex });
    },
    addPaletteColor: (color, chainIndex?) => {
      const ci = chainIndex ?? stateRef.current.activeIndex;
      const chain = stateRef.current.chain;
      for (let i = ci; i < chain.length; i++) {
        cachedOutputsRef.current.delete(chain[i].id);
      }
      clearMotionVectorsState();
      dispatch({ type: "ADD_PALETTE_COLOR", color, chainIndex });
    },
    importState: (json) => {
      const deserialized = JSON.parse(json);
      prevOutputMapRef.current.clear();
      prevInputMapRef.current.clear();
      emaMapRef.current.clear();
      clearMotionVectorsState();
      dispatch({ type: "LOAD_STATE", data: deserialized });
    },
    saveCurrentColorPalette: (name, colors) => {
      window.localStorage.setItem(
        `_palette_${name.replace(" ", "")}`,
        JSON.stringify({ type: optionTypes.PALETTE, name, colors })
      );
      THEMES[name] = colors;
      dispatch({ type: "SAVE_CURRENT_COLOR_PALETTE", name });
    },
    deleteCurrentColorPalette: (name) => {
      window.localStorage.removeItem(`_palette_${name.replace(" ", "")}`);
      delete THEMES[name];
      dispatch({ type: "DELETE_CURRENT_COLOR_PALETTE", name });
    },
    // Chain actions
    chainAdd: (displayName, filter) => {
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_ADD", displayName, filter });
    },
    chainRemove: (id) => {
      prevOutputMapRef.current.delete(id);
      prevInputMapRef.current.delete(id);
      emaMapRef.current.delete(id);
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_REMOVE", id });
    },
    chainReorder: (fromIndex, toIndex) => {
      prevOutputMapRef.current.clear();
      prevInputMapRef.current.clear();
      emaMapRef.current.clear();
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_REORDER", fromIndex, toIndex });
    },
    chainSetActive: (index) => {
      dispatch({ type: "CHAIN_SET_ACTIVE", index });
    },
    chainToggle: (id) => {
      dispatch({ type: "CHAIN_TOGGLE", id });
    },
    chainReplace: (id, displayName, filter) => {
      prevOutputMapRef.current.delete(id);
      prevInputMapRef.current.delete(id);
      emaMapRef.current.delete(id);
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_REPLACE", id, displayName, filter });
    },
    chainDuplicate: (id) => {
      clearMotionVectorsState();
      dispatch({ type: "CHAIN_DUPLICATE", id });
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
        const data = JSON.parse(text);
        prevOutputMapRef.current.clear();
        prevInputMapRef.current.clear();
        emaMapRef.current.clear();
        clearMotionVectorsState();
        cachedOutputsRef.current.clear();
        dispatch({ type: "LOAD_STATE", data });
      } catch (e) {
        console.warn("Failed to paste chain:", e);
      }
    },
    getExportUrl: (filterState) => {
      const json = serializeStateJson(filterState);
      const hash = getShareHash(json, DEFAULT_SHARE_STATE_JSON);
      return `${window.location.origin}${getShareUrl(window.location.pathname, "", hash)}`;
    },
    exportState: (filterState) => {
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
