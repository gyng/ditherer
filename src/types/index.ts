export type ColorRGBA = [number, number, number, number];
export type ColorHSVA = [number, number, number, number];
export type ColorLabA = [number, number, number, number];

export interface OptionType {
  type: string;
  default?: any;
  range?: [number, number];
  step?: number;
  options?: Array<{ name: string; value: string }>;
}

export interface Palette {
  name: string;
  getColor: (color: ColorRGBA, options?: any) => ColorRGBA;
  options: any;
  optionTypes: Record<string, OptionType>;
  defaults: any;
}

export interface AnimateOption extends OptionType {
  type: "ACTION";
  label: string;
  action: (actions: any, inputCanvas: any, filterFunc: any, options: any) => void;
}

export interface Filter {
  name: string;
  func: (input: HTMLCanvasElement, options?: any, dispatch?: any) => HTMLCanvasElement | string | void;
  optionTypes: Record<string, OptionType> & { animate?: AnimateOption; animSpeed?: OptionType };
  options: any;
  defaults: any;
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
