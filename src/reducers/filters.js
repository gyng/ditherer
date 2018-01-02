// @flow

import {
  LOAD_IMAGE,
  LOAD_STATE,
  FILTER_IMAGE,
  SELECT_FILTER,
  SET_GRAYSCALE,
  SET_REAL_TIME_FILTERING,
  SET_INPUT_CANVAS,
  SET_INPUT_VOLUME,
  SET_SCALE,
  SET_FILTER_OPTION,
  SET_FILTER_PALETTE_OPTION,
  ADD_PALETTE_COLOR,
  SET_SCALING_ALGORITHM
} from "constants/actionTypes";

import { SCALING_ALGORITHM } from "constants/optionTypes";

import { floydSteinberg } from "filters/errorDiffusing";
import { grayscale, filterIndex } from "filters";
import { paletteList } from "palettes";

import type { Action, AppState } from "types";

export const initialState = {
  selected: { displayName: "Floyd-Steinberg", filter: floydSteinberg },
  convertGrayscale: false,
  scale: 1,
  inputCanvas: null,
  inputImage: null,
  outputImage: null,
  realtimeFiltering: false,
  time: null,
  video: null,
  videoVolume: 1,
  scalingAlgorithm: SCALING_ALGORITHM.AUTO
};

export default (state: AppState = initialState, action: Action) => {
  switch (action.type) {
    case LOAD_STATE:
      const localFilter = filterIndex[action.data.selected.filter.name];
      const deserializedFilter = {
        ...localFilter,
        options: action.data.selected.filter.options
      };

      if (deserializedFilter.options.palette != null) {
        const localPalette = paletteList.find(
          p => p.palette.name === deserializedFilter.options.palette.name
        );

        if (localPalette) {
          deserializedFilter.options.palette = {
            ...localPalette.palette,
            options: deserializedFilter.options.palette.options
          };
        }
      }

      return {
        ...state,
        selected: {
          ...action.data.selected,
          filter: deserializedFilter
        },
        convertGrayscale: action.data.convertGrayscale
      };
    case SET_SCALING_ALGORITHM: {
      if (state.inputCanvas) {
        const context = state.inputCanvas.getContext("2d");

        if (context && state.inputImage) {
          const smoothingEnabled = action.algorithm === SCALING_ALGORITHM.AUTO;
          context.imageSmoothingEnabled = smoothingEnabled;
          context.drawImage(
            state.inputImage,
            0,
            0,
            state.inputImage.width * (state.scale || 1),
            state.inputImage.height * (state.scale || 1)
          );
        }
      }

      return {
        ...state,
        scalingAlgorithm: action.algorithm
      };
    }
    case SET_INPUT_CANVAS:
      return {
        ...state,
        inputCanvas: action.canvas
      };
    case SET_INPUT_VOLUME:
      if (state.video) {
        state.video.volume = action.volume; // eslint-disable-line
      }

      return {
        ...state,
        videoVolume: action.volume
      };
    case LOAD_IMAGE: // eslint-disable-line
      // Image or new video
      if (
        state.video != null &&
        (!action.video || action.video !== state.video)
      ) {
        state.video.pause();
        // $FlowFixMe
        state.video.src = ""; // eslint-disable-line
      }

      const newState = {
        ...state,
        inputImage: action.image,
        time: action.time || 0,
        video: action.video || null,
        realtimeFiltering: action.video && state.realtimeFiltering
      };

      if (state.realtimeFiltering && state.inputCanvas) {
        const output = state.convertGrayscale
          ? state.selected.filter.func(
              grayscale.func(state.inputCanvas),
              state.selected.filter.options,
              action.dispatch
            )
          : state.selected.filter.func(
              state.inputCanvas,
              state.selected.filter.options,
              action.dispatch
            );
        if (output instanceof HTMLCanvasElement) {
          newState.outputImage = output;
        }
      }

      return newState;
    case SET_GRAYSCALE:
      return {
        ...state,
        convertGrayscale: action.value
      };
    case SET_REAL_TIME_FILTERING:
      return {
        ...state,
        realtimeFiltering: action.enabled
      };
    case SET_SCALE:
      return {
        ...state,
        scale: action.scale
      };
    case SELECT_FILTER:
      return {
        ...state,
        selected: {
          name: action.name,
          filter: action.filter.filter
        }
      };
    case SET_FILTER_OPTION:
      return {
        ...state,
        selected: {
          ...state.selected,
          filter: {
            ...state.selected.filter,
            options: {
              ...state.selected.filter.options,
              [action.optionName]: action.value
            }
          }
        }
      };
    case SET_FILTER_PALETTE_OPTION:
      if (
        !state.selected.filter.options ||
        !state.selected.filter.options.palette
      ) {
        console.warn("Tried to set option on null palette", state); // eslint-disable-line
        return state;
      }

      return {
        ...state,
        selected: {
          ...state.selected,
          filter: {
            ...state.selected.filter,
            options: {
              ...state.selected.filter.options,
              palette: {
                ...state.selected.filter.options.palette,
                options: {
                  ...state.selected.filter.options.palette.options,
                  [action.optionName]: action.value
                }
              }
            }
          }
        }
      };
    case ADD_PALETTE_COLOR:
      if (
        !state.selected.filter.options ||
        !state.selected.filter.options.palette
      ) {
        console.warn("Tried to add color to null palette", state); // eslint-disable-line
        return state;
      }

      return {
        ...state,
        selected: {
          ...state.selected,
          filter: {
            ...state.selected.filter,
            options: {
              ...state.selected.filter.options,
              palette: {
                ...state.selected.filter.options.palette,
                options: {
                  ...state.selected.filter.options.palette.options,
                  colors: [
                    ...state.selected.filter.options.palette.options.colors,
                    action.color
                  ]
                }
              }
            }
          }
        }
      };
    case FILTER_IMAGE:
      return {
        ...state,
        outputImage: action.image
      };
    default:
      return state;
  }
};
