// @flow

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
  setScalingAlgorithm
} from "actions";
import App from "components/App";
import { filterList, grayscale } from "filters";

import type { State } from "types";
import type { Dispatch } from "redux";

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
  realtimeFiltering: state.filters.realtimeFiltering
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onLoadImage: (e, volume: number = 1, playbackRate: number = 1) =>
    // $FlowFixMe
    dispatch(loadMediaAsync(e.target.files[0], volume, playbackRate)),
  onFilterImage: (input, filter, convertGrayscale = false) => {
    const filterFunc = convertGrayscale
      ? (i, o) => filter.func(grayscale.func(i), o)
      : filter.func;
    // $FlowFixMe
    dispatch(filterImageAsync(input, filterFunc, filter.options));
  },
  onSelectFilter: (name, filter) => dispatch(selectFilter(name, filter)),
  onConvertGrayscale: val => dispatch(setConvertGrayscale(val)),
  onSetInput: image => dispatch(loadImage(image)),
  onSetScale: scale => dispatch(setScale(scale)),
  onSetOutputScale: scale => dispatch(setOutputScale(scale)),
  onSetRealTimeFiltering: enabled => dispatch(setRealtimeFiltering(enabled)),
  onSetInputCanvas: canvas => dispatch(setInputCanvas(canvas)),
  onSetInputVolume: volume => dispatch(setInputVolume(volume)),
  onSetInputPlaybackRate: rate => dispatch(setInputPlaybackRate(rate)),
  onImportState: json => dispatch(importState(json)),
  onSetScalingAlgorithm: (name, algorithm) =>
    dispatch(setScalingAlgorithm(algorithm))
});

const ContainedApp = connect(
  mapStateToProps,
  mapDispatchToProps
)(App);

export default ContainedApp;
