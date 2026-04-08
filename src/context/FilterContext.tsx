import React, { createContext, useContext, useReducer, useCallback } from "react";
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

// On mobile, compute a scale that fits the image within the viewport
// and caps total pixel count for weaker CPUs.
const MAX_MOBILE_PIXELS = 500_000; // ~700×700
const getMobileScale = (w: number, h: number): number => {
  if (typeof window === "undefined" || window.innerWidth > 768) return 1;
  // Fit to viewport width (with some padding)
  const viewportW = window.innerWidth - 16;
  const fitScale = viewportW / w;
  // Also cap by total pixel budget
  const pixelScale = Math.sqrt(MAX_MOBILE_PIXELS / (w * h));
  return Math.min(1, fitScale, pixelScale);
};

// Round scale to nearest 0.1 for clean slider values
const roundScale = (s: number) => Math.round(s * 10) / 10 || 0.1;

export const FilterProvider = ({ children }) => {
  const [state, dispatch] = useReducer(filterReducer, initialState);

  // Async action: load image from file
  const loadImageAsync = useCallback((file) => {
    const reader = new FileReader();
    const image = new Image();
    reader.onload = event => {
      image.onload = () => {
        dispatch({ type: "LOAD_IMAGE", image, time: null, video: null, dispatch });
        const scale = roundScale(getMobileScale(image.width, image.height));
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
          const scale = roundScale(getMobileScale(video.videoWidth, video.videoHeight));
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
    const filterOpts = { ...options, _linearize: state.linearize };
    const output = filterFunc(input, filterOpts, dispatch);
    if (!output) return;
    if (output instanceof HTMLCanvasElement) {
      const outputImage = new Image();
      outputImage.src = output.toDataURL("image/png");
      outputImage.onload = () => {
        dispatch({ type: "FILTER_IMAGE", image: outputImage });
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
      const json = JSON.stringify(
        { selected: filterState.selected, convertGrayscale: filterState.convertGrayscale },
        (k, v) => {
          if (k === "defaults" || k === "optionTypes" || typeof v === "function") return undefined;
          return v;
        }
      );
      const base = `${window.location.origin}${window.location.pathname}`;
      return `${base}?state=${encodeURI(btoa(json))}`;
    },
    exportState: (filterState, format) => {
      const json = JSON.stringify(
        { selected: filterState.selected, convertGrayscale: filterState.convertGrayscale },
        (k, v) => {
          if (k === "defaults" || k === "optionTypes" || typeof v === "function") return undefined;
          return v;
        }
      );
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
