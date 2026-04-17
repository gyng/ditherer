import { createContext } from "react";
import { filterList, grayscale } from "filters";
import type { FilterDefinition } from "filters/types";
import type { FilterReducerState } from "reducers/filters";
import type { EntryAudioModulation } from "utils/audioVizBridge";

export type FilterState = FilterReducerState;
export type AnimatedVideoElement = HTMLVideoElement & {
  __objectUrl?: string;
  __manualPause?: boolean;
  __drawErrorLogged?: boolean;
};

export type FilterOptionValue = unknown;

export interface ExportFrameOptions {
  sessionId: string;
  time?: number;
  video?: AnimatedVideoElement | null;
}

export interface FilterActions {
  loadMediaAsync: (file: File, volume?: number, playbackRate?: number, options?: { preserveScale?: boolean }) => Promise<void>;
  loadVideoFromUrlAsync: (src: string, volume?: number, playbackRate?: number, options?: { preserveScale?: boolean }) => Promise<void>;
  filterImageAsync: (input: HTMLCanvasElement | OffscreenCanvas | null) => void;
  triggerDegauss: (inputCanvas: HTMLCanvasElement | null) => void;
  triggerBurst: (inputCanvas: HTMLCanvasElement | null, frames: number, fps?: number) => void;
  startAnimLoop: (inputCanvas: HTMLCanvasElement | null, fps?: number) => void;
  stopAnimLoop: () => void;
  isAnimating: () => boolean;
  renderFrameForExport: (
    inputCanvas: HTMLCanvasElement | null,
    options: ExportFrameOptions,
  ) => Promise<HTMLCanvasElement | OffscreenCanvas | null>;
  clearExportSession: (sessionId: string) => void;
  loadImage: (image: CanvasImageSource, time?: number | null, video?: AnimatedVideoElement | null) => void;
  selectFilter: (name: string, filter: FilterDefinition | { filter: FilterDefinition }) => void;
  setConvertGrayscale: (value: boolean) => void;
  setLinearize: (value: boolean) => void;
  setWasmAcceleration: (value: boolean) => void;
  setWebglAcceleration: (value: boolean) => void;
  setRandomCycleSeconds: (seconds: number | null) => void;
  setScale: (scale: number) => void;
  setOutputScale: (scale: number) => void;
  setRealtimeFiltering: (enabled: boolean) => void;
  setInputCanvas: (canvas: HTMLCanvasElement | null) => void;
  setInputVolume: (volume: number) => void;
  setInputPlaybackRate: (rate: number) => void;
  toggleVideo: () => void;
  setScalingAlgorithm: (algorithm: string) => void;
  setFilterOption: (optionName: string, value: FilterOptionValue, chainIndex?: number) => void;
  setFilterPaletteOption: (optionName: string, value: FilterOptionValue, chainIndex?: number) => void;
  addPaletteColor: (color: number[], chainIndex?: number) => void;
  importState: (json: string) => void;
  saveCurrentColorPalette: (name: string, colors: number[][]) => void;
  deleteCurrentColorPalette: (name: string) => void;
  chainAdd: (displayName: string, filter: FilterDefinition) => void;
  chainRemove: (id: string) => void;
  chainReorder: (fromIndex: number, toIndex: number) => void;
  chainSetActive: (index: number) => void;
  chainToggle: (id: string) => void;
  chainReplace: (id: string, displayName: string, filter: FilterDefinition) => void;
  chainDuplicate: (id: string) => void;
  setChainAudioModulation: (id: string, modulation: EntryAudioModulation | null) => void;
  copyChainToClipboard: () => void;
  pasteChainFromClipboard: () => Promise<void>;
  getExportUrl: (filterState: FilterState) => string;
  exportState: (filterState: FilterState, formatHint?: string) => string;
  getIntermediatePreview: (entryId: string) => HTMLCanvasElement | null;
}

export interface FilterContextValue {
  state: FilterState;
  actions: FilterActions;
  filterList: typeof filterList;
  grayscale: typeof grayscale;
}

export const FilterContext = createContext<FilterContextValue | null>(null);
