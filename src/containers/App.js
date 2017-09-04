// @flow

import { connect } from "react-redux";
import {
  loadImage,
  loadImageAsync,
  filterImageAsync,
  selectFilter,
  setConvertGrayscale,
  setScale
} from "actions";
import App from "components/App";
import type { State } from "types";
import { filterList, grayscale } from "filters";

const mapStateToProps = (state: State) => ({
  inputImage: state.filters.inputImage,
  outputImage: state.filters.outputImage,
  availableFilters: filterList,
  selectedFilter: state.filters.selected,
  convertGrayscale: state.filters.convertGrayscale,
  scale: state.filters.scale
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onLoadImage: e => dispatch(loadImageAsync(e.target.files[0])),
  onFilterImage: (input, filter, convertGrayscale = false) => {
    const filterFunc = convertGrayscale
      ? (i, o) => filter.func(grayscale.func(i), o)
      : filter.func;
    dispatch(filterImageAsync(input, filterFunc, filter.options));
  },
  onSelectFilter: (name, filter) => dispatch(selectFilter(name, filter)),
  onConvertGrayscale: val => dispatch(setConvertGrayscale(val)),
  onSetInput: image => dispatch(loadImage(image)),
  onSetScale: scale => dispatch(setScale(scale))
});

const ContainedApp = connect(mapStateToProps, mapDispatchToProps)(App);

export default ContainedApp;
