import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from "react";
import filterReducer, { initialState } from "reducers/filters";
import * as optionTypes from "constants/optionTypes";
import { filterList, grayscale } from "filters";
import { THEMES } from "palettes/user";

const FilterContext = createContext<any>(null);

export const useFilter = (): { state: any; actions: any; filterList: any; grayscale: any } => {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilter must be used within FilterProvider");
  return ctx;
};

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

export const FilterProvider = ({ children }) => {
  const [state, dispatch] = useReducer(filterReducer, initialState);
  const prevOutputRef = useRef<Uint8ClampedArray | null>(null);
  const frameCountRef = useRef(0);
  const degaussFrameRef = useRef(-Infinity);
  const degaussAnimRef = useRef<number | null>(null);
  const animLoopRef = useRef<number | null>(null);
  const animLastTimeRef = useRef(0);
  const animParamsRef = useRef<{ inputCanvas: any; filterFunc: any; fps: number } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const filterImageAsyncRef = useRef<any>(null);

  // Restore state from #! hash on initial load
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#!")) return;
    try {
      const json = atob(decodeURIComponent(hash.slice(2)));
      const data = JSON.parse(json);
      dispatch({ type: "LOAD_STATE", data });
    } catch (e) {
      console.warn("Failed to restore state from URL hash:", e);
    }
  }, []);

  // Sync filter state to URL hash so the address bar is always shareable
  useEffect(() => {
    if (!state.selected) return;
    const exportData = {
      selected: state.selected,
      convertGrayscale: state.convertGrayscale,
      linearize: state.linearize,
      wasmAcceleration: state.wasmAcceleration,
    };
    const json = JSON.stringify(exportData, (k, v) => {
      if (k === "defaults" || k === "optionTypes" || typeof v === "function") return undefined;
      return v;
    });
    const newHash = `#!${encodeURIComponent(btoa(json))}`;
    if (window.location.hash !== newHash) {
      history.replaceState(null, "", newHash);
    }
  }, [state.selected, state.convertGrayscale, state.linearize, state.wasmAcceleration]);

  // Async action: load image from file
  const loadImageAsync = useCallback((file) => {
    const reader = new FileReader();
    const image = new Image();
    reader.onload = event => {
      image.onload = () => {
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

  // Filter image — reads linearize from state at call time
  const filterImageAsync = (input, filterFunc, options) => {
    const filterOpts = {
      ...options,
      _linearize: state.linearize,
      _wasmAcceleration: state.wasmAcceleration,
      _prevOutput: prevOutputRef.current,
      _frameIndex: frameCountRef.current,
      _degaussFrame: degaussFrameRef.current,
      _isAnimating: animLoopRef.current != null || degaussAnimRef.current != null,
    };
    // Propagate wasmAcceleration into palette options so getColor() sees it
    if (filterOpts.palette?.options) {
      filterOpts.palette = {
        ...filterOpts.palette,
        options: { ...filterOpts.palette.options, _wasmAcceleration: state.wasmAcceleration }
      };
    }
    const t0 = performance.now();
    const output = filterFunc(input, filterOpts, dispatch);
    const stepMs = performance.now() - t0;
    const filterName = state.selected?.displayName || state.selected?.filter?.name || "Filter";
    const stepTimes = [{ name: filterName, ms: stepMs }];
    const frameTime = stepMs;
    if (!output) return;
    if (output instanceof HTMLCanvasElement) {
      // Store output buffer for next frame's persistence/interlace
      const outCtx = output.getContext("2d");
      if (outCtx) {
        prevOutputRef.current = outCtx.getImageData(0, 0, output.width, output.height).data;
      }
      frameCountRef.current += 1;

      const outputImage = new Image();
      outputImage.src = output.toDataURL("image/png");
      outputImage.onload = () => {
        dispatch({ type: "FILTER_IMAGE", image: outputImage, frameTime, stepTimes });
      };
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

  const triggerDegauss = (inputCanvas, filterFunc, filterOptions) => {
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
      filterImageAsync(inputCanvas, filterFunc, filterOptions);
      frame += 1;
      degaussAnimRef.current = requestAnimationFrame(animate);
    };
    degaussAnimRef.current = requestAnimationFrame(animate);
  };

  const triggerBurst = (inputCanvas, filterFunc, filterOptions, frames, fps = 6) => {
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
          filterImageAsync(inputCanvas, filterFunc, filterOptions);
        });
        return;
      }
      if (timestamp - lastTime >= interval) {
        lastTime = timestamp;
        filterImageAsync(inputCanvas, filterFunc, filterOptions);
        frame += 1;
      }
      animLoopRef.current = requestAnimationFrame(animate);
    };
    animLoopRef.current = requestAnimationFrame(animate);
  };

  const startAnimLoop = (inputCanvas, filterFunc, _filterOptions, fps = 15) => {
    if (animLoopRef.current != null) return; // already running
    animParamsRef.current = { inputCanvas, filterFunc, fps };
    animLastTimeRef.current = 0;
    const animate = (timestamp: number) => {
      const params = animParamsRef.current;
      if (!params || !params.inputCanvas) {
        animLoopRef.current = null;
        return;
      }
      // Read current fps from live state (animSpeed option)
      const curState = stateRef.current;
      const curFps = curState.selected?.filter?.options?.animSpeed || params.fps;
      const interval = 1000 / curFps;
      if (timestamp - animLastTimeRef.current >= interval) {
        animLastTimeRef.current = timestamp;
        // Use ref to get latest filterImageAsync with current state
        const filterFn = filterImageAsyncRef.current;
        if (filterFn) {
          filterFn(params.inputCanvas, params.filterFunc, curState.selected.filter.options);
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
    setFilterOption: (optionName, value) =>
      dispatch({ type: "SET_FILTER_OPTION", optionName, value }),
    setFilterPaletteOption: (optionName, value) =>
      dispatch({ type: "SET_FILTER_PALETTE_OPTION", optionName, value }),
    addPaletteColor: (color) =>
      dispatch({ type: "ADD_PALETTE_COLOR", color }),
    importState: (json) => {
      const deserialized = JSON.parse(json);
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
    getExportUrl: (filterState) => {
      const exportData = {
        selected: filterState.selected,
        convertGrayscale: filterState.convertGrayscale,
        linearize: filterState.linearize,
        wasmAcceleration: filterState.wasmAcceleration,
      };
      const json = JSON.stringify(exportData, (k, v) => {
        if (k === "defaults" || k === "optionTypes" || typeof v === "function") return undefined;
        return v;
      });
      const base = `${window.location.origin}${window.location.pathname}`;
      return `${base}#!${encodeURIComponent(btoa(json))}`;
    },
    exportState: (filterState) => {
      const exportData = {
        selected: filterState.selected,
        convertGrayscale: filterState.convertGrayscale,
        linearize: filterState.linearize,
        wasmAcceleration: filterState.wasmAcceleration,
      };
      return JSON.stringify(exportData, (k, v) => {
        if (k === "defaults" || k === "optionTypes" || typeof v === "function") return undefined;
        return v;
      }, 2);
    },
  };

  return (
    <FilterContext.Provider value={{ state, actions, filterList, grayscale }}>
      {children}
    </FilterContext.Provider>
  );
};

export default FilterContext;
