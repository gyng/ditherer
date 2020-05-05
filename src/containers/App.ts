import { connect } from "react-redux";
import {
  importState,
  loadImage,
  loadMediaAsync,
  filterImageAsync,
  selectFilter,
  setConvertGrayscale,
  setRealtimeFiltering,
  setInputCanvas,
  setInputVolume,
  setInputPlaybackRate,
  setScale,
  setOutputScale,
  setScalingAlgorithm,
} from "@src/actions";
import App from "@src/components/App";
import { filterList, grayscale } from "@src/filters";

import type { State, RootDispatch, Filter } from "@src/types";

const mapStateToProps = (state: State) => ({
  inputImage: state.filters.inputImage,
  outputImage: state.filters.outputImage,
  availableFilters: filterList,
  selectedFilter: state.filters.selected,
  convertGrayscale: state.filters.convertGrayscale,
  scale: state.filters.scale,
  outputScale: state.filters.outputScale,
  scalingAlgorithm: state.filters.scalingAlgorithm,
  time: state.filters.time,
  inputVideo: state.filters.video,
  inputVideoVolume: state.filters.videoVolume,
  inputVideoPlaybackRate: state.filters.videoPlaybackRate,
  realtimeFiltering: state.filters.realtimeFiltering,
});

const mapDispatchToProps = (dispatch: RootDispatch) => ({
  onLoadImage: (
    e: { target: { files: File[] } },
    volume = 1,
    playbackRate = 1
  ) => dispatch(loadMediaAsync(e.target.files[0], volume, playbackRate)),
  onFilterImage: (
    input: HTMLCanvasElement | null,
    filter: {
      func: (arg0: HTMLCanvasElement | null, arg1: any) => any;
      options: any;
    },
    convertGrayscale = false
  ) => {
    const filterFunc = convertGrayscale
      ? (i: HTMLCanvasElement, o: any) => filter.func(grayscale.func(i), o)
      : filter.func;
    if (input) {
      dispatch(filterImageAsync(input, filterFunc, filter.options));
    }
  },
  onSelectFilter: (name: string, filter: Filter) =>
    dispatch(selectFilter(name, filter)),
  onConvertGrayscale: (val: boolean) => dispatch(setConvertGrayscale(val)),
  onSetInput: (image: HTMLImageElement) => dispatch(loadImage(image)),
  onSetScale: (scale: number) => dispatch(setScale(scale)),
  onSetOutputScale: (scale: number) => dispatch(setOutputScale(scale)),
  onSetRealTimeFiltering: (enabled: boolean) =>
    dispatch(setRealtimeFiltering(enabled)),
  onSetInputCanvas: (canvas: HTMLCanvasElement) =>
    dispatch(setInputCanvas(canvas)),
  onSetInputVolume: (volume: number) => dispatch(setInputVolume(volume)),
  onSetInputPlaybackRate: (rate: number) =>
    dispatch(setInputPlaybackRate(rate)),
  onImportState: (json: string) => dispatch(importState(json)),
  onSetScalingAlgorithm: (_name: any, algorithm: string) =>
    dispatch(setScalingAlgorithm(algorithm)),
});

const ContainedApp = connect(mapStateToProps, mapDispatchToProps)(App);

export default ContainedApp;
