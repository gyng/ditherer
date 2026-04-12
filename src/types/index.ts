export type ColorRGBA = [number, number, number, number];
export type ColorHSVA = [number, number, number, number];
export type ColorLabA = [number, number, number, number];

export interface OptionType {
  type: string;
  default?: unknown;
  range?: [number, number];
  step?: number;
  options?: Array<{ name: string; value: string }>;
}

export interface Palette {
  name: string;
  getColor: (color: ColorRGBA, options?: unknown) => ColorRGBA;
  options: unknown;
  optionTypes: Record<string, OptionType>;
  defaults: unknown;
}

export interface AnimateOption extends OptionType {
  type: "ACTION";
  label: string;
  action: (
    actions: unknown,
    inputCanvas: unknown,
    filterFunc: unknown,
    options: unknown,
  ) => void;
}

export interface Filter {
  name: string;
  func: (
    input: HTMLCanvasElement,
    options?: unknown,
    dispatch?: unknown,
  ) => HTMLCanvasElement | string | void;
  optionTypes: Record<string, OptionType> & { animate?: AnimateOption; animSpeed?: OptionType };
  options: unknown;
  defaults: unknown;
}

export interface FilterState {
  selected: { displayName?: string; name?: string; filter: Filter };
  convertGrayscale: boolean;
  linearize: boolean;
  scale: number;
  outputScale: number;
  inputCanvas: HTMLCanvasElement | null;
  inputImage: HTMLImageElement | null;
  outputImage: HTMLImageElement | null;
  realtimeFiltering: boolean;
  time: number | null;
  video: HTMLVideoElement | null;
  videoVolume: number;
  videoPlaybackRate: number;
  scalingAlgorithm: string;
}
