// @flow

export type AppState = {
  convertGrayscale: boolean,
  selectedFilter: string,
  inputImage: ?HTMLCanvasElement,
  outputImage: ?HTMLCanvasElement
};

export type State = { filters: AppState };

export type Filter = {
  filter: (input: HTMLCanvasElement, options: ?any) => HTMLCanvasElement,
  defaults: any,
  optionTypes: any,
  options?: ?any
};

export type Action =
  | { type: "INCREMENT", value: number }
  | { type: "DECREMENT", value: number };

export type ColorRGBA = [number, number, number, number];

export type Palette = {
  getColor: (input: ColorRGBA, options: any) => ColorRGBA,
  defaults: any,
  optionTypes: any,
  options?: any
};
