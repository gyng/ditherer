import React, { createContext, useReducer, useCallback, useEffect, useRef } from "react";
import filterReducer, { initialState, ChainEntry } from "reducers/filters";
import * as optionTypes from "constants/optionTypes";
import { filterList, grayscale } from "filters";
import { THEMES } from "palettes/user";
import { serializePalette } from "palettes";
import { workerRPC, USE_WORKER } from "workers/workerRPC";

export const FilterContext = createContext<any>(null);

// Compute a scale that fits the image within the available canvas area
// and caps total pixel count for performance.
const MAX_PIXELS_MOBILE  = 500_000;   // ~700×700
const MAX_PIXELS_DESKTOP = 2_000_000; // ~1400×1400
const getAutoScale = (w: number, h: number): number => {
  if (typeof window === "undefined") return 1;
  const isMobile = window.innerWidth <= 768;
  const maxPixels = isMobile ? MAX_PIXELS_MOBILE : MAX_PIXELS_DESKTOP;
  // Fit to available width (sidebar is ~210px on desktop, full width on mobile)
  const sidebarW = isMobile ? 16 : 240;
  const availableW = window.innerWidth - sidebarW;
  const fitScale = availableW / w;
  // Cap by pixel budget
  const pixelScale = Math.sqrt(maxPixels / (w * h));
  return Math.min(1, fitScale, pixelScale);
};

// Round scale to nearest 0.1 for clean slider values
const roundScale = (s: number) => Math.round(s * 10) / 10 || 0.1;

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

// UTF-8-safe base64 encode/decode (btoa/atob only handle Latin1)
const toBase64 = (str: string) =>
  btoa(String.fromCodePoint(...new TextEncoder().encode(str)));
const fromBase64 = (b64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.codePointAt(0)!));

export const FilterProvider = ({ children }) => {
  const [state, dispatch] = useReducer(filterReducer, initialState);
  const prevOutputMapRef = useRef<Map<string, Uint8ClampedArray>>(new Map());
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
      const json = fromBase64(decodeURIComponent(hash.slice(2)));
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
      const exportData = serializeState(state);
      const json = JSON.stringify(exportData);
      const newHash = `#!${encodeURIComponent(toBase64(json))}`;
      if (window.location.hash !== newHash) {
        history.replaceState(null, "", newHash);
      }
    } catch (e) {
      console.warn("Failed to sync state to URL hash:", e);
    }
  }, [state.chain, state.activeIndex, state.convertGrayscale, state.linearize, state.wasmAcceleration]);

  // Async action: load image from file
  const loadImageAsync = useCallback((file) => {
    const reader = new FileReader();
    const image = new Image();
    reader.onload = event => {
      image.onload = () => {
        filteringRef.current = false;
        dispatch({ type: "LOAD_IMAGE", image, time: null, video: null, dispatch });
        const scale = roundScale(getAutoScale(image.width, image.height));
        if (scale < 1) dispatch({ type: "SET_SCALE", scale });
      };
      image.src = event.target.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  // Async action: load video from file
  const loadVideoAsync = useCallback((file, volume = 1, playbackRate = 1) => {
    filteringRef.current = false;
    const reader = new FileReader();
    const video = document.createElement("video");
    reader.onload = event => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const loadFrame = () => {
        if (!video.paused && video.src !== "") {
          ctx.drawImage(video, 0, 0);
          dispatch({ type: "LOAD_IMAGE", image: canvas, time: video.currentTime, video, dispatch });
          requestAnimationFrame(loadFrame);
        }
      };
      let firstPlay = true;
      video.onplaying = () => {
        if (firstPlay) {
          firstPlay = false;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const scale = roundScale(getAutoScale(video.videoWidth, video.videoHeight));
          if (scale < 1) dispatch({ type: "SET_SCALE", scale });
          requestAnimationFrame(loadFrame);
        }
      };
      const blob = new Blob([event.target.result]);
      video.volume = volume;
      video.src = URL.createObjectURL(blob);
      video.playbackRate = playbackRate;
      video.loop = true;
      video.autoplay = true;
      video.play();
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // Async action: load media (routes to image or video)
  const loadMediaAsync = useCallback((file, volume = 1, playbackRate = 1) => {
    if (file.type.startsWith("video/")) {
      loadVideoAsync(file, volume, playbackRate);
    } else {
      loadImageAsync(file);
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

  // Check if chain contains glitchblob (needs dispatch, can't run in worker)
  const chainNeedsMainThread = (entries: any[]) =>
    entries.some(e => e.filter?.name === "Glitch");

  // Main-thread filter execution (fallback path)
  const filterOnMainThread = (canvas, enabledEntries, startIdx, isAnimating, curState) => {
    const stepTimes: { name: string; ms: number }[] = [];
    let totalTime = 0;

    for (let i = startIdx; i < enabledEntries.length; i++) {
      const entry = enabledEntries[i];
      const filterOpts = {
        ...entry.filter.options,
        _linearize: curState.linearize,
        _wasmAcceleration: curState.wasmAcceleration,
        _prevOutput: prevOutputMapRef.current.get(entry.id) || null,
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

      if (output instanceof HTMLCanvasElement) {
        const outCtx = output.getContext("2d");
        if (outCtx) {
          prevOutputMapRef.current.set(
            entry.id,
            outCtx.getImageData(0, 0, output.width, output.height).data
          );
        }
        if (!isAnimating) {
          cachedOutputsRef.current.set(entry.id, output);
        }
        canvas = output;
      }
    }

    return { canvas, stepTimes, totalTime };
  };

  const emitOutput = (canvas, totalTime, stepTimes) => {
    frameCountRef.current += 1;
    const outputImage = new Image();
    outputImage.onload = () => {
      filteringRef.current = false;
      dispatch({ type: "FILTER_IMAGE", image: outputImage, frameTime: totalTime, stepTimes });
    };
    outputImage.onerror = () => {
      filteringRef.current = false;
    };
    outputImage.src = canvas.toDataURL("image/png");
  };

  const filterImageAsync = (input) => {
    if (!input) return;
    // Drop frame if previous filter hasn't finished (prevents queue buildup during video)
    if (filteringRef.current) return;
    filteringRef.current = true;
    const curState = stateRef.current;
    const chain = curState.chain;
    const isAnimating = animLoopRef.current != null || degaussAnimRef.current != null;

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

        for (const [entryId, buf] of Object.entries(result.prevOutputs)) {
          prevOutputMapRef.current.set(entryId, new Uint8ClampedArray(buf as ArrayBuffer));
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
    setScalingAlgorithm: (algorithm) =>
      dispatch({ type: "SET_SCALING_ALGORITHM", algorithm }),
    setFilterOption: (optionName, value, chainIndex?) => {
      const ci = chainIndex ?? stateRef.current.activeIndex;
      // Invalidate cache from this entry onward
      const chain = stateRef.current.chain;
      for (let i = ci; i < chain.length; i++) {
        cachedOutputsRef.current.delete(chain[i].id);
      }
      dispatch({ type: "SET_FILTER_OPTION", optionName, value, chainIndex });
    },
    setFilterPaletteOption: (optionName, value, chainIndex?) => {
      const ci = chainIndex ?? stateRef.current.activeIndex;
      const chain = stateRef.current.chain;
      for (let i = ci; i < chain.length; i++) {
        cachedOutputsRef.current.delete(chain[i].id);
      }
      dispatch({ type: "SET_FILTER_PALETTE_OPTION", optionName, value, chainIndex });
    },
    addPaletteColor: (color, chainIndex?) => {
      const ci = chainIndex ?? stateRef.current.activeIndex;
      const chain = stateRef.current.chain;
      for (let i = ci; i < chain.length; i++) {
        cachedOutputsRef.current.delete(chain[i].id);
      }
      dispatch({ type: "ADD_PALETTE_COLOR", color, chainIndex });
    },
    importState: (json) => {
      const deserialized = JSON.parse(json);
      prevOutputMapRef.current.clear();
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
      dispatch({ type: "CHAIN_ADD", displayName, filter });
    },
    chainRemove: (id) => {
      prevOutputMapRef.current.delete(id);
      dispatch({ type: "CHAIN_REMOVE", id });
    },
    chainReorder: (fromIndex, toIndex) => {
      prevOutputMapRef.current.clear();
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
      dispatch({ type: "CHAIN_REPLACE", id, displayName, filter });
    },
    chainDuplicate: (id) => {
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
        cachedOutputsRef.current.clear();
        dispatch({ type: "LOAD_STATE", data });
      } catch (e) {
        console.warn("Failed to paste chain:", e);
      }
    },
    getExportUrl: (filterState) => {
      const json = serializeStateJson(filterState);
      const base = `${window.location.origin}${window.location.pathname}`;
      return `${base}#!${encodeURIComponent(toBase64(json))}`;
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
