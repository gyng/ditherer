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

import { floydSteinberg } from "filters/errorDiffusing";
import { filterIndex } from "filters";
import { paletteList } from "palettes";

// A filter object must have a func. This prevents accidentally passing
// the filterList wrapper ({ displayName, filter, category }) instead of
// the actual filter ({ name, func, optionTypes, options, defaults }).
export type FilterObject = {
  name: string;
  func: (input: any, options?: any, dispatch?: any) => any;
  optionTypes?: Record<string, any>;
  options?: any;
  defaults?: any;
};

export type ChainEntry = {
  id: string;
  displayName: string;
  filter: FilterObject;
  enabled: boolean;
};

const MAX_CHAIN_LENGTH = 16;

const makeChainEntry = (displayName: string, filter: FilterObject): ChainEntry => ({
  id: crypto.randomUUID(),
  displayName,
  filter,
  enabled: true,
});

// Derive `selected` compat shim from chain state
const deriveSelected = (chain: ChainEntry[], activeIndex: number) => ({
  displayName: chain[activeIndex].displayName,
  name: chain[activeIndex].displayName,
  filter: chain[activeIndex].filter,
});

const defaultEntry = makeChainEntry("Floyd-Steinberg", floydSteinberg);

export const initialState = {
  chain: [defaultEntry] as ChainEntry[],
  activeIndex: 0,
  // Compat shim — computed from chain[activeIndex]
  selected: deriveSelected([defaultEntry], 0),
  convertGrayscale: false,
  scale: 1,
  outputScale: 1,
  inputCanvas: null,
  inputImage: null,
  outputImage: null,
  realtimeFiltering: true,
  time: null,
  video: null,
  videoVolume: localStorage.getItem("ditherer-mute") === "1" ? 0 : 1,
  videoPlaybackRate: 1,
  scalingAlgorithm: SCALING_ALGORITHM.PIXELATED,
  linearize: true,
  wasmAcceleration: true,
  frameTime: null,
  stepTimes: null as { name: string; ms: number }[] | null,
};

// Helper: update a chain entry's filter options immutably
const updateChainEntryOptions = (chain: ChainEntry[], index: number, updater: (opts: any) => any): ChainEntry[] =>
  chain.map((entry, i) =>
    i === index
      ? { ...entry, filter: { ...entry.filter, options: updater(entry.filter.options) } }
      : entry
  );

// Deserialize a filter from saved state, resolving local references
const deserializeFilter = (savedFilter: any) => {
  const localFilter = filterIndex[savedFilter.name];
  if (!localFilter) return null;
  const result = { ...localFilter, options: savedFilter.options };
  if (result.options?.palette != null) {
    const localPalette = paletteList.find(
      p => p.palette.name === result.options.palette.name
    );
    if (localPalette) {
      result.options.palette = {
        ...localPalette.palette,
        options: result.options.palette.options
      };
    }
  }
  return result;
};

// After any chain mutation, recompute the `selected` compat shim
const withSelected = (state: any) => ({
  ...state,
  selected: deriveSelected(state.chain, state.activeIndex),
});

export default (state = initialState, action) => {
  switch (action.type) {
    case LOAD_STATE: {
      // v2 format: has `chain` array
      if (action.data.v === 2 && Array.isArray(action.data.chain)) {
        const chain: ChainEntry[] = [];
        for (const entry of action.data.chain) {
          const localFilter = filterIndex[entry.n];
          if (!localFilter) continue;
          const mergedOpts = { ...localFilter.options };
          if (entry.o) {
            for (const [k, v] of Object.entries(entry.o)) {
              if (k === "palette" && mergedOpts.palette) {
                mergedOpts.palette = { ...mergedOpts.palette, options: { ...mergedOpts.palette.options, ...(v as any).options } };
              } else {
                mergedOpts[k] = v;
              }
            }
          }
          // Re-resolve palette references
          if (mergedOpts.palette?.name) {
            const localPalette = paletteList.find(p => p.palette.name === mergedOpts.palette.name);
            if (localPalette) {
              mergedOpts.palette = { ...localPalette.palette, options: mergedOpts.palette.options };
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
          convertGrayscale: action.data.g ?? state.convertGrayscale,
          linearize: action.data.l ?? state.linearize,
          wasmAcceleration: action.data.w ?? state.wasmAcceleration,
        });
      }

      // v1 format: has `selected`
      if (action.data.selected) {
        const deserializedFilter = deserializeFilter(action.data.selected.filter);
        if (!deserializedFilter) return state;
        const entry = makeChainEntry(
          action.data.selected.displayName || action.data.selected.name || deserializedFilter.name,
          deserializedFilter
        );
        return withSelected({
          ...state,
          chain: [entry],
          activeIndex: 0,
          convertGrayscale: action.data.convertGrayscale,
          linearize: action.data.linearize ?? state.linearize,
          wasmAcceleration: action.data.wasmAcceleration ?? state.wasmAcceleration,
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
      const chain = state.chain.filter((_: any, i: number) => i !== idx);
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
      const filterObj = action.filter.func ? action.filter : action.filter.filter;
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
      if (!entry?.filter?.options?.palette) {
        console.warn("Tried to set option on null palette", state);
        return state;
      }
      const chain = updateChainEntryOptions(state.chain, ci, opts => ({
        ...opts,
        palette: {
          ...opts.palette,
          options: { ...opts.palette.options, [action.optionName]: action.value },
        },
      }));
      return withSelected({ ...state, chain });
    }
    case ADD_PALETTE_COLOR: {
      const ci = action.chainIndex ?? state.activeIndex;
      const entry = state.chain[ci];
      if (!entry?.filter?.options?.palette) {
        console.warn("Tried to add color to null palette", state);
        return state;
      }
      const chain = updateChainEntryOptions(state.chain, ci, opts => ({
        ...opts,
        palette: {
          ...opts.palette,
          options: {
            ...opts.palette.options,
            colors: [...(opts.palette.options as any).colors, action.color],
          },
        },
      }));
      return withSelected({ ...state, chain });
    }

    // --- Unchanged actions ---
    case SET_SCALING_ALGORITHM: {
      if (state.inputCanvas) {
        const context = state.inputCanvas.getContext("2d");
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
      if (state.video) state.video.volume = action.volume;
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
        frameTime: action.frameTime ?? state.frameTime,
        stepTimes: action.stepTimes ?? state.stepTimes,
      };
    case SET_LINEARIZE:
      return { ...state, linearize: action.value };
    case SET_WASM_ACCELERATION:
      return { ...state, wasmAcceleration: action.value };
    default:
      return state;
  }
};
