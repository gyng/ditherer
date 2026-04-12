const LOAD_IMAGE = "LOAD_IMAGE";
const LOAD_STATE = "LOAD_STATE";
const FILTER_IMAGE = "FILTER_IMAGE";
const SELECT_FILTER = "SELECT_FILTER";
const SET_GRAYSCALE = "SET_GRAYSCALE";
const SET_REAL_TIME_FILTERING = "SET_REAL_TIME_FILTERING";
const SET_INPUT_CANVAS = "SET_INPUT_CANVAS";
const SET_INPUT_VOLUME = "SET_INPUT_VOLUME";
const SET_INPUT_PLAYBACK_RATE = "SET_INPUT_PLAYBACK_RATE";
const SET_SCALE = "SET_SCALE";
const SET_OUTPUT_SCALE = "SET_OUTPUT_SCALE";
const SET_FILTER_OPTION = "SET_FILTER_OPTION";
const SET_FILTER_PALETTE_OPTION = "SET_FILTER_PALETTE_OPTION";
const ADD_PALETTE_COLOR = "ADD_PALETTE_COLOR";
const SET_SCALING_ALGORITHM = "SET_SCALING_ALGORITHM";
const SET_LINEARIZE = "SET_LINEARIZE";
const SET_WASM_ACCELERATION = "SET_WASM_ACCELERATION";
const CHAIN_ADD = "CHAIN_ADD";
const CHAIN_REMOVE = "CHAIN_REMOVE";
const CHAIN_REORDER = "CHAIN_REORDER";
const CHAIN_SET_ACTIVE = "CHAIN_SET_ACTIVE";
const CHAIN_TOGGLE = "CHAIN_TOGGLE";
const CHAIN_REPLACE = "CHAIN_REPLACE";
const CHAIN_DUPLICATE = "CHAIN_DUPLICATE";

import { SCALING_ALGORITHM } from "constants/optionTypes";
import {
  hasV1SelectedState,
  isShareStateV2,
  type SerializedFilterReference,
  type SerializedFilterState,
  type SerializedPaletteState,
} from "context/shareStateTypes";
import type { FilterDefinition, FilterOptionValues } from "filters/types";

import { floydSteinberg } from "filters/errorDiffusing";
import { filterIndex } from "filters";
import { paletteList } from "palettes";
import { createPalette, THEMES } from "palettes/user";

type FilterOptionMap = FilterOptionValues;
type PaletteColor = number[];
type StepTime = { name: string; ms: number };
type ScalingAlgorithm = typeof SCALING_ALGORITHM[keyof typeof SCALING_ALGORITHM];
type PaletteOptionState = SerializedPaletteState & { options?: FilterOptionMap };
type DrawableImage = CanvasImageSource & { width: number; height: number };

export type ChainEntry = {
  id: string;
  displayName: string;
  filter: FilterDefinition;
  enabled: boolean;
};

export type SelectedFilterState = {
  displayName: string;
  name: string;
  filter: FilterDefinition;
};

const MAX_CHAIN_LENGTH = 16;

const makeChainEntry = (displayName: string, filter: FilterDefinition): ChainEntry => ({
  id: crypto.randomUUID(),
  displayName,
  filter,
  enabled: true,
});

// Derive `selected` compat shim from chain state
const deriveSelected = (chain: ChainEntry[], activeIndex: number): SelectedFilterState => ({
  displayName: chain[activeIndex].displayName,
  name: chain[activeIndex].displayName,
  filter: chain[activeIndex].filter,
});

const defaultEntry = makeChainEntry("Floyd-Steinberg", {
  ...floydSteinberg,
  options: {
    ...floydSteinberg.options,
    palette: createPalette(THEMES.CGA_NTSC),
  },
});

export const initialState = {
  chain: [defaultEntry] as ChainEntry[],
  activeIndex: 0,
  // Compat shim — computed from chain[activeIndex]
  selected: deriveSelected([defaultEntry], 0),
  convertGrayscale: false,
  scale: 1,
  outputScale: 1,
  inputCanvas: null as HTMLCanvasElement | OffscreenCanvas | null,
  inputImage: null as DrawableImage | null,
  outputImage: null as HTMLCanvasElement | OffscreenCanvas | null,
  realtimeFiltering: true,
  time: null as number | null,
  inputFrameToken: 0,
  outputFrameToken: 0,
  outputTime: null as number | null,
  video: null as HTMLVideoElement | null,
  videoVolume: localStorage.getItem("ditherer-mute") === "1" ? 0 : 1,
  videoPlaybackRate: 1,
  scalingAlgorithm: SCALING_ALGORITHM.PIXELATED,
  linearize: true,
  wasmAcceleration: true,
  frameTime: null as number | null,
  stepTimes: null as { name: string; ms: number }[] | null,
};

export type FilterReducerState = typeof initialState;

// Helper: update a chain entry's filter options immutably
const updateChainEntryOptions = (
  chain: ChainEntry[],
  index: number,
  updater: (opts: FilterOptionMap | undefined) => FilterOptionMap
): ChainEntry[] =>
  chain.map((entry, i) =>
    i === index
      ? { ...entry, filter: { ...entry.filter, options: updater(entry.filter.options) } }
      : entry
  );

const getPaletteState = (value: unknown): PaletteOptionState | null => {
  if (typeof value !== "object" || value == null) return null;
  const candidate = value as Partial<PaletteOptionState>;
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return null;
  return {
    name: candidate.name,
    options: (candidate.options as FilterOptionMap | undefined) ?? undefined,
  };
};

const getPaletteColors = (palette: PaletteOptionState | null | undefined): PaletteColor[] =>
  Array.isArray(palette?.options?.colors) ? (palette.options.colors as PaletteColor[]) : [];

const getPaletteOptionMap = (palette: unknown): FilterOptionMap =>
  getPaletteState(palette)?.options ?? {};

// Deserialize a filter from saved state, resolving local references
const deserializeFilter = (
  savedFilter: SerializedFilterReference | null | undefined
): FilterDefinition | null => {
  if (!savedFilter?.name) return null;
  const localFilter = filterIndex[savedFilter.name];
  if (!localFilter) return null;
  const result = {
    ...localFilter,
    options: savedFilter.options as FilterOptionMap | undefined,
  };
  const palette = getPaletteState(result.options?.palette);
  if (palette != null) {
    const localPalette = paletteList.find(
      p => p.palette.name === palette.name
    );
    if (localPalette) {
      result.options = {
        ...(result.options || {}),
        palette: {
        ...localPalette.palette,
          options: palette.options
        }
      };
    }
  }
  return result;
};

// After any chain mutation, recompute the `selected` compat shim
const withSelected = (
  state: Omit<FilterReducerState, "selected"> & {
    chain: ChainEntry[];
    activeIndex: number;
  }
): FilterReducerState => ({
  ...state,
  selected: deriveSelected(state.chain, state.activeIndex),
});

type LoadStateAction = {
  type: typeof LOAD_STATE;
  data: SerializedFilterState;
};

type ChainMutationAction =
  | {
      type: typeof CHAIN_ADD;
      displayName: string;
      filter: FilterDefinition;
    }
  | {
      type: typeof CHAIN_REMOVE;
      id: string;
    }
  | {
      type: typeof CHAIN_REORDER;
      fromIndex: number;
      toIndex: number;
    }
  | {
      type: typeof CHAIN_SET_ACTIVE;
      index: number;
    }
  | {
      type: typeof CHAIN_TOGGLE;
      id: string;
    }
  | {
      type: typeof CHAIN_REPLACE;
      id: string;
      displayName: string;
      filter: FilterDefinition;
    }
  | {
      type: typeof CHAIN_DUPLICATE;
      id: string;
    };

type FilterSelectionAction = {
  type: typeof SELECT_FILTER;
  name: string;
  filter: FilterDefinition | { filter: FilterDefinition };
};

type FilterOptionAction =
  | {
      type: typeof SET_FILTER_OPTION;
      optionName: string;
      value: unknown;
      chainIndex?: number;
    }
  | {
      type: typeof SET_FILTER_PALETTE_OPTION;
      optionName: string;
      value: unknown;
      chainIndex?: number;
    }
  | {
      type: typeof ADD_PALETTE_COLOR;
      color: PaletteColor;
      chainIndex?: number;
    };

type ImageAction =
  | {
      type: typeof LOAD_IMAGE;
      image: DrawableImage;
      time: number | null;
      frameToken?: number;
      video: HTMLVideoElement | null;
      dispatch?: unknown;
    }
  | {
      type: typeof FILTER_IMAGE;
      image: HTMLCanvasElement;
      frameToken?: number;
      time?: number | null;
      frameTime?: number | null;
      stepTimes?: StepTime[] | null;
    };

type ScalarStateAction =
  | {
      type: typeof SET_GRAYSCALE | typeof SET_LINEARIZE | typeof SET_WASM_ACCELERATION;
      value: boolean;
    }
  | {
      type: typeof SET_REAL_TIME_FILTERING;
      enabled: boolean;
    }
  | {
      type: typeof SET_SCALE | typeof SET_OUTPUT_SCALE;
      scale: number;
    }
  | {
      type: typeof SET_INPUT_CANVAS;
      canvas: HTMLCanvasElement | null;
    }
  | {
      type: typeof SET_INPUT_VOLUME;
      volume: number;
    }
  | {
      type: typeof SET_INPUT_PLAYBACK_RATE;
      rate: number;
    }
  | {
      type: typeof SET_SCALING_ALGORITHM;
      algorithm: ScalingAlgorithm;
    };

type PalettePersistenceAction =
  | {
      type: "SAVE_CURRENT_COLOR_PALETTE";
      name: string;
    }
  | {
      type: "DELETE_CURRENT_COLOR_PALETTE";
      name: string;
    };

export type FilterReducerAction =
  | LoadStateAction
  | ChainMutationAction
  | FilterSelectionAction
  | FilterOptionAction
  | ImageAction
  | ScalarStateAction
  | PalettePersistenceAction;

const filterReducer = (
  state: FilterReducerState = initialState,
  action: FilterReducerAction
): FilterReducerState => {
  switch (action.type) {
    case LOAD_STATE: {
      // v2 format: has `chain` array
      const data = action.data as SerializedFilterState;

      if (isShareStateV2(data)) {
        const chain: ChainEntry[] = [];
        for (const entry of data.chain) {
          const localFilter = filterIndex[entry.n];
          if (!localFilter) continue;
          const mergedOpts: FilterOptionMap = {
            ...((localFilter.options as FilterOptionMap | undefined) ?? {}),
          };
          if (entry.o) {
            for (const [k, v] of Object.entries(entry.o)) {
              const palette = getPaletteState(v);
              if (k === "palette" && mergedOpts.palette && palette) {
                const currentPalette = getPaletteState(mergedOpts.palette);
                mergedOpts.palette = {
                  ...(currentPalette ?? {}),
                  options: {
                    ...(currentPalette?.options ?? {}),
                    ...(palette.options ?? {}),
                  },
                };
              } else {
                mergedOpts[k] = v;
              }
            }
          }
          // Re-resolve palette references
          const palette = getPaletteState(mergedOpts.palette);
          if (palette?.name) {
            const localPalette = paletteList.find(p => p.palette.name === palette.name);
            if (localPalette) {
              mergedOpts.palette = { ...localPalette.palette, options: palette.options };
            }
          }
          chain.push({
            id: crypto.randomUUID(),
            displayName: entry.d || entry.n,
            filter: { ...localFilter, options: mergedOpts },
            enabled: entry.e !== false,
          });
        }
        if (chain.length === 0) return state;
        return withSelected({
          ...state,
          chain,
          activeIndex: 0,
          convertGrayscale: data.g ?? state.convertGrayscale,
          linearize: data.l ?? state.linearize,
          wasmAcceleration: data.w ?? state.wasmAcceleration,
        });
      }

      // v1 format: has `selected`
      if (hasV1SelectedState(data)) {
        const deserializedFilter = deserializeFilter(data.selected.filter);
        if (!deserializedFilter) return state;
        const entry = makeChainEntry(
          data.selected.displayName || data.selected.name || deserializedFilter.name,
          deserializedFilter
        );
        return withSelected({
          ...state,
          chain: [entry],
          activeIndex: 0,
          convertGrayscale: data.convertGrayscale,
          linearize: data.linearize ?? state.linearize,
          wasmAcceleration: data.wasmAcceleration ?? state.wasmAcceleration,
        });
      }
      return state;
    }

    // --- Chain actions ---
    case CHAIN_ADD: {
      if (state.chain.length >= MAX_CHAIN_LENGTH) return state;
      const entry = makeChainEntry(action.displayName, action.filter);
      const chain = [...state.chain, entry];
      return withSelected({
        ...state,
        chain,
        activeIndex: chain.length - 1,
      });
    }
    case CHAIN_REMOVE: {
      if (state.chain.length <= 1) return state;
      const idx = state.chain.findIndex((e: ChainEntry) => e.id === action.id);
      if (idx === -1) return state;
      const chain = state.chain.filter((_, i) => i !== idx);
      const activeIndex = Math.min(state.activeIndex, chain.length - 1);
      return withSelected({ ...state, chain, activeIndex });
    }
    case CHAIN_REORDER: {
      const { fromIndex, toIndex } = action;
      if (fromIndex < 0 || fromIndex >= state.chain.length) return state;
      if (toIndex < 0 || toIndex >= state.chain.length) return state;
      if (fromIndex === toIndex) return state;
      const chain = [...state.chain];
      const [moved] = chain.splice(fromIndex, 1);
      chain.splice(toIndex, 0, moved);
      // activeIndex follows the entry the user was editing
      let activeIndex = state.activeIndex;
      if (state.activeIndex === fromIndex) {
        activeIndex = toIndex;
      } else if (fromIndex < state.activeIndex && toIndex >= state.activeIndex) {
        activeIndex -= 1;
      } else if (fromIndex > state.activeIndex && toIndex <= state.activeIndex) {
        activeIndex += 1;
      }
      return withSelected({ ...state, chain, activeIndex });
    }
    case CHAIN_SET_ACTIVE: {
      const index = Math.max(0, Math.min(action.index, state.chain.length - 1));
      return withSelected({ ...state, activeIndex: index });
    }
    case CHAIN_TOGGLE: {
      const chain = state.chain.map((e: ChainEntry) =>
        e.id === action.id ? { ...e, enabled: !e.enabled } : e
      );
      return withSelected({ ...state, chain });
    }
    case CHAIN_REPLACE: {
      const idx = state.chain.findIndex((e: ChainEntry) => e.id === action.id);
      if (idx === -1) return state;
      const chain = state.chain.map((e: ChainEntry, i: number) =>
        i === idx
          ? { ...e, displayName: action.displayName, filter: action.filter }
          : e
      );
      return withSelected({ ...state, chain });
    }
    case CHAIN_DUPLICATE: {
      const idx = state.chain.findIndex((e: ChainEntry) => e.id === action.id);
      if (idx === -1) return state;
      const source = state.chain[idx];
      const clone: ChainEntry = {
        id: crypto.randomUUID(),
        displayName: source.displayName,
        filter: { ...source.filter, options: { ...source.filter.options } },
        enabled: source.enabled,
      };
      const chain = [...state.chain];
      chain.splice(idx + 1, 0, clone);
      return withSelected({ ...state, chain, activeIndex: idx + 1 });
    }

    // --- Compat: SELECT_FILTER resets to single-entry chain ---
    case SELECT_FILTER: {
      // action.filter may be a FilterObject directly or a wrapper { filter: FilterObject }
      const filterObj = "func" in action.filter ? action.filter : action.filter.filter;
      const entry = makeChainEntry(action.name, filterObj);
      return withSelected({
        ...state,
        chain: [entry],
        activeIndex: 0,
      });
    }

    // --- Option mutations: support chainIndex with activeIndex fallback ---
    case SET_FILTER_OPTION: {
      const ci = action.chainIndex ?? state.activeIndex;
      const chain = updateChainEntryOptions(state.chain, ci, opts => ({
        ...opts,
        [action.optionName]: action.value,
      }));
      return withSelected({ ...state, chain });
    }
    case SET_FILTER_PALETTE_OPTION: {
      const ci = action.chainIndex ?? state.activeIndex;
      const entry = state.chain[ci];
      const paletteState = getPaletteState(entry?.filter?.options?.palette);
      if (!paletteState) {
        console.warn("Tried to set option on null palette", state);
        return state;
      }
      const chain = updateChainEntryOptions(state.chain, ci, opts => ({
        ...opts,
        palette: {
          ...paletteState,
          options: {
            ...getPaletteOptionMap(opts?.palette),
            [action.optionName]: action.value,
          },
        },
      }));
      return withSelected({ ...state, chain });
    }
    case ADD_PALETTE_COLOR: {
      const ci = action.chainIndex ?? state.activeIndex;
      const entry = state.chain[ci];
      const paletteState = getPaletteState(entry?.filter?.options?.palette);
      if (!paletteState) {
        console.warn("Tried to add color to null palette", state);
        return state;
      }
      const chain = updateChainEntryOptions(state.chain, ci, opts => ({
        ...opts,
        palette: {
          ...paletteState,
          options: {
            ...getPaletteOptionMap(opts?.palette),
            colors: [...getPaletteColors(getPaletteState(opts?.palette)), action.color],
          },
        },
      }));
      return withSelected({ ...state, chain });
    }

    // --- Unchanged actions ---
    case SET_SCALING_ALGORITHM: {
      if (state.inputCanvas) {
        const context = state.inputCanvas.getContext("2d") as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null;
        if (context && state.inputImage) {
          const smoothingEnabled = action.algorithm === SCALING_ALGORITHM.AUTO;
          context.imageSmoothingEnabled = smoothingEnabled;
          context.drawImage(
            state.inputImage, 0, 0,
            state.inputImage.width * (state.scale || 1),
            state.inputImage.height * (state.scale || 1)
          );
        }
      }
      return { ...state, scalingAlgorithm: action.algorithm };
    }
    case SET_INPUT_CANVAS:
      return { ...state, inputCanvas: action.canvas };
    case SET_INPUT_VOLUME:
      if (state.video) {
        state.video.volume = action.volume;
        state.video.muted = action.volume === 0;
      }
      return { ...state, videoVolume: action.volume };
    case SET_INPUT_PLAYBACK_RATE:
      if (state.video) state.video.playbackRate = action.rate;
      return { ...state, videoPlaybackRate: action.rate };
    case LOAD_IMAGE: {
      if (
        state.video != null &&
        (!action.video || action.video !== state.video)
      ) {
        const oldVideo = state.video as HTMLVideoElement & { __objectUrl?: string };
        state.video.pause();
        // Avoid assigning empty src, which can resolve to the document URL ("/")
        // and trigger "text/html is not supported" media decode warnings.
        state.video.removeAttribute("src");
        state.video.load();
        if (oldVideo.__objectUrl) {
          URL.revokeObjectURL(oldVideo.__objectUrl);
          delete oldVideo.__objectUrl;
        }
      }

      const newState = {
        ...state,
        inputImage: action.image,
        time: action.time || 0,
        inputFrameToken: action.frameToken ?? state.inputFrameToken,
        video: action.video || null,
        realtimeFiltering: state.realtimeFiltering
      };

      // Trigger chain-based filtering via FilterContext (not inline)
      // The auto-filter effect in App.tsx picks up inputImage/time changes
      return newState;
    }
    case SET_GRAYSCALE:
      return { ...state, convertGrayscale: action.value };
    case SET_REAL_TIME_FILTERING:
      return { ...state, realtimeFiltering: action.enabled };
    case SET_SCALE:
      return { ...state, scale: action.scale };
    case SET_OUTPUT_SCALE:
      return { ...state, outputScale: action.scale };
    case FILTER_IMAGE:
      return {
        ...state,
        outputImage: action.image,
        outputFrameToken: action.frameToken ?? state.outputFrameToken,
        outputTime: action.time ?? state.outputTime,
        frameTime: action.frameTime ?? state.frameTime,
        stepTimes: action.stepTimes ?? state.stepTimes,
      };
    case SET_LINEARIZE:
      return { ...state, linearize: action.value };
    case SET_WASM_ACCELERATION:
      return { ...state, wasmAcceleration: action.value };
    case "SAVE_CURRENT_COLOR_PALETTE":
    case "DELETE_CURRENT_COLOR_PALETTE":
      return state;
    default:
      return state;
  }
};

export default filterReducer;
