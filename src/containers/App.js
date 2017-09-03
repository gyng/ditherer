// @flow

import { connect } from "react-redux";
import {
  loadImage,
  loadImageAsync,
  filterImageAsync,
  selectFilter,
  setConvertGrayscale
} from "actions";
import App from "components/App";
import type { State } from "types";
import { filterList, grayscale } from "filters";

const mapStateToProps = (state: State) => ({
  inputImage: state.filters.inputImage,
  outputImage: state.filters.outputImage,
  availableFilters: filterList,
  selectedFilter: state.filters.selected,
  convertGrayscale: state.filters.convertGrayscale
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onLoadImage: e => dispatch(loadImageAsync(e.target.files[0])),
  onFilterImage: (input, filter, options, convertGrayscale = false) => {
    const combinedFilter = convertGrayscale
      ? (i, o) => filter(grayscale(i), o)
      : filter;
    dispatch(filterImageAsync(input, combinedFilter, options));
  },
  onSelectFilter: (name, filter) => dispatch(selectFilter(name, filter)),
  onConvertGrayscale: val => dispatch(setConvertGrayscale(val)),
  onSetInput: image => dispatch(loadImage(image))
});

const ContainedApp = connect(mapStateToProps, mapDispatchToProps)(App);

export default ContainedApp;
