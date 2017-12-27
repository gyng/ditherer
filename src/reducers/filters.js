// @flow

import {
  LOAD_IMAGE,
  FILTER_IMAGE,
  SELECT_FILTER,
  SET_GRAYSCALE,
  SET_REAL_TIME_FILTERING,
  SET_INPUT_CANVAS,
  SET_SCALE,
  SET_FILTER_OPTION,
  SET_FILTER_PALETTE_OPTION,
  ADD_PALETTE_COLOR
} from "constants/actionTypes";

import { floydSteinberg } from "filters/errorDiffusing";

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
  video: null
};

export default (state: AppState = initialState, action: Action) => {
  switch (action.type) {
    case SET_INPUT_CANVAS:
      return {
        ...state,
        inputCanvas: action.canvas
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
        video: action.video || null
      };

      if (state.realtimeFiltering && state.inputCanvas) {
        const output = state.selected.filter.func(
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
