// @flow

import { connect } from "react-redux";
import {
  loadImage,
  loadMediaAsync,
  filterImageAsync,
  selectFilter,
  setConvertGrayscale,
  setRealtimeFiltering,
  setInputCanvas,
  setInputVolume,
  setScale
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
  time: state.filters.time,
  inputVideo: state.filters.video,
  inputVideoVolume: state.filters.videoVolume,
  realtimeFiltering: state.filters.realtimeFiltering
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onLoadImage: (e, volume: number = 1) =>
    // $FlowFixMe
    dispatch(loadMediaAsync(e.target.files[0], volume)),
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
  onSetRealTimeFiltering: enabled => dispatch(setRealtimeFiltering(enabled)),
  onSetInputCanvas: canvas => dispatch(setInputCanvas(canvas)),
  onSetInputVolume: volume => dispatch(setInputVolume(volume))
});

const ContainedApp = connect(mapStateToProps, mapDispatchToProps)(App);

export default ContainedApp;
