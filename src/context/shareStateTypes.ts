export type SerializedOptionMap = Record<string, unknown>;
export type SerializedAudioVizTarget = {
  o: string;
  w: number;
};

export type SerializedAudioVizModulation = {
  k: string;
  t: SerializedAudioVizTarget[];
};

export interface SerializedPaletteState {
  name: string;
  options?: SerializedOptionMap;
}

export interface SerializedFilterReference {
  name: string;
  options?: SerializedOptionMap;
}

export interface SerializedSelectedState {
  displayName?: string;
  name?: string;
  filter: SerializedFilterReference;
}

export interface SerializedChainEntry {
  n: string;
  d?: string;
  o?: SerializedOptionMap;
  e?: boolean;
  m?: SerializedAudioVizModulation;
}

export interface ShareStateV1 {
  selected: SerializedSelectedState;
  convertGrayscale: boolean;
  linearize?: boolean;
  wasmAcceleration?: boolean;
  r?: number;
}

export interface ShareStateV2 {
  v: 2;
  chain: SerializedChainEntry[];
  g: boolean;
  l: boolean;
  w: boolean;
  r?: number;
}

export type SerializedFilterState = ShareStateV1 | ShareStateV2;

export const isShareStateV2 = (value: SerializedFilterState): value is ShareStateV2 =>
  "v" in value && value.v === 2 && Array.isArray(value.chain);

export const hasV1SelectedState = (value: SerializedFilterState): value is ShareStateV1 =>
  "selected" in value && value.selected != null;
