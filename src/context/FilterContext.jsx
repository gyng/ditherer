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

export const FilterProvider = ({ children }) => {
  const [state, dispatch] = useReducer(filterReducer, initialState);

  // Async action: load image from file
  const loadImageAsync = useCallback((file) => {
    const reader = new FileReader();
    const image = new Image();
    reader.onload = event => {
      image.onload = () => {
        dispatch({ type: "LOAD_IMAGE", image, time: null, video: null, dispatch });
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
      const i = new Image();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const loadFrame = () => {
        URL.revokeObjectURL(i.src);
        if (!video.paused && video.src !== "") {
          i.width = video.videoWidth;
          i.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          canvas.toBlob(blob => {
            if (blob) {
              i.src = URL.createObjectURL(blob);
              i.onload = () => {
                if (!video.paused && video.src !== "") {
                  requestAnimationFrame(loadFrame);
                  dispatch({ type: "LOAD_IMAGE", image: i, time: video.currentTime, video, dispatch });
                }
              };
            }
          });
        }
      };
      let firstPlay = true;
      video.onplaying = () => {
        if (firstPlay) {
          firstPlay = false;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
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
    exportState: (filterState, format) => {
      const json = JSON.stringify(
        { selected: filterState.selected, convertGrayscale: filterState.convertGrayscale },
        (k, v) => {
          if (k === "defaults" || k === "optionTypes" || typeof v === "function") return undefined;
          return v;
        }
      );
      if (format === "json") {
        window.open(`data:application/json,${encodeURI(json)}`);
      } else {
        const base = `${window.location.origin}${window.location.pathname}`;
        prompt("URL", `${base}?state=${encodeURI(btoa(json))}`); // eslint-disable-line
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
