// @flow

export type OptionTypes = {
  type: string,
  [string]: any
};

export type FilterFunc = (
  input: HTMLCanvasElement,
  options?: ?any,
  dispatch?: ?Dispatch
) => HTMLCanvasElement | "ASYNC_FILTER";

export type Filter = {
  name: string,
  func: FilterFunc,
  defaults: any,
  optionTypes: { [string]: OptionTypes },
  options?: ?any
};

export type AppState = {
  convertGrayscale: boolean,
  scale: ?number,
  outputScale: ?number,
  selected: { displayName: string, filter: Filter },
  inputImage: ?HTMLCanvasElement,
  outputImage: ?HTMLCanvasElement,
  realtimeFiltering: boolean,
  video: ?HTMLVideoElement,
  videoVolume: number,
  time: ?number,
  inputCanvas: ?HTMLCanvasElement,
  scalingAlgorithm: string,
  videoPlaybackRate: number
};

export type State = { filters: AppState };

export type Action =
  | { type: "INCREMENT", value: number }
  | { type: "DECREMENT", value: number };

export type ColorRGBA = [number, number, number, number];
export type ColorLabA = ColorRGBA;
export type ColorHSVA = ColorRGBA;

export type Palette = {
  name: string,
  getColor: (input: ColorRGBA, options: any) => ColorRGBA,
  defaults: any,
  optionTypes: any,
  options?: any
};

export type PaletteOption = {
  name: string,
  value: Palette
};

export type ColorDistanceAlgorithm =
  | "RGB_NEAREST"
  | "RGB_APPROX"
  | "LAB_NEAREST";
