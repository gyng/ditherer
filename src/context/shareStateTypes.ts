export type SerializedOptionMap = Record<string, unknown>;
export type SerializedAudioVizConnection = {
  k: string;
  o: string;
  w: number;
};

export type SerializedAudioVizModulation = {
  c?: SerializedAudioVizConnection[];
  z?: string[];
  m?: SerializedAudioVizConnection[];
  t?: string[] | Array<{ o: string; w: number }>;
  k?: string;
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
  i?: string;
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

export interface SerializedAudioVizChannel {
  // connections + normalized metrics, same shape as entry modulation
  m?: SerializedAudioVizModulation;
  // auto-viz mode: "balanced" | "punchy" | "flow" | "chaotic"
  mode?: string;
  // auto-viz re-roll on chain change
  auto?: boolean;
  // density override in [0,0.8]; absent = mode default
  d?: number;
  // BPM-driven chain swap enabled + beats per swap (string so users can type fractions like "2.5")
  bpm?: { beats: string } | false;
}

export interface ShareStateV2 {
  v: 2;
  chain: SerializedChainEntry[];
  g: boolean;
  l: boolean;
  w: boolean;
  r?: number;
  // Audio viz global modulations keyed by channel ("chain"|"screensaver")
  av?: {
    chain?: SerializedAudioVizChannel;
    screensaver?: SerializedAudioVizChannel;
  };
}

export type SerializedFilterState = ShareStateV1 | ShareStateV2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isShareStateV2 = (value: unknown): value is ShareStateV2 =>
  isRecord(value) && value.v === 2 && Array.isArray(value.chain);

export const hasV1SelectedState = (value: unknown): value is ShareStateV1 => {
  if (!isRecord(value) || !isRecord(value.selected)) return false;
  const filter = value.selected.filter;
  return isRecord(filter) && typeof filter.name === "string" && filter.name.length > 0;
};
