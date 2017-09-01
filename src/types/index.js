// @flow

export type AppState = {
  convertGrayscale: boolean,
  selectedFilter: string,
  inputImage: ?HTMLCanvasElement,
  outputImage: ?HTMLCanvasElement
};

export type State = { counters: AppState };

export type Filter = (input: HTMLCanvasElement) => HTMLCanvasElement;

export type Action =
  | { type: "INCREMENT", value: number }
  | { type: "DECREMENT", value: number };

export type ColorRGBA = [number, number, number, number];
