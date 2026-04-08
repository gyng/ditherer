import React, { createContext, useContext, useReducer, useCallback, useEffect } from "react";
import filterReducer, { initialState } from "reducers/filters";
import * as optionTypes from "constants/optionTypes";
import { filterList, grayscale } from "filters";
import { THEMES } from "palettes/user";

const FilterContext = createContext();

export const useFilter = () => {
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
      image.src = event.target.result;
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
    const filterOpts = { ...options, _linearize: state.linearize, _wasmAcceleration: state.wasmAcceleration };
    // Propagate wasmAcceleration into palette options so getColor() sees it
    if (filterOpts.palette?.options) {
      filterOpts.palette = {
        ...filterOpts.palette,
        options: { ...filterOpts.palette.options, _wasmAcceleration: state.wasmAcceleration }
      };
    }
    const t0 = performance.now();
    const output = filterFunc(input, filterOpts, dispatch);
    const frameTime = performance.now() - t0;
    if (!output) return;
    if (output instanceof HTMLCanvasElement) {
      const outputImage = new Image();
      outputImage.src = output.toDataURL("image/png");
      outputImage.onload = () => {
        dispatch({ type: "FILTER_IMAGE", image: outputImage, frameTime });
      };
    }
  };

  const actions = {
    loadMediaAsync,
    filterImageAsync,
    loadImage: (image, time, video) =>
      dispatch({ type: "LOAD_IMAGE", image, time: time || 0, video: video || null, dispatch }),
    selectFilter: (name, filter) =>
      dispatch({ type: "SELECT_FILTER", name, filter }),
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
    exportState: (filterState, format) => {
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
      if (format === "json") {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ditherer-state.json";
        a.click();
        URL.revokeObjectURL(url);
      }
    },
  };

  return (
    <FilterContext.Provider value={{ state, actions, filterList, grayscale }}>
      {children}
    </FilterContext.Provider>
  );
};

export default FilterContext;
