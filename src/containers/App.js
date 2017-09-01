// @flow

import { connect } from "react-redux";
import {
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
  selectedFilter: state.filters.selectedFilter,
  convertGrayscale: state.filters.convertGrayscale
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onLoadImage: e => dispatch(loadImageAsync(e.target.files[0])),
  onFilterImage: (input, filter, convertGrayscale = false) => {
    const combinedFilter = convertGrayscale
      ? i => filter(grayscale(i))
      : filter;
    dispatch(filterImageAsync(input, combinedFilter));
  },

  onSelectFilter: name => dispatch(selectFilter(name)),
  onConvertGrayscale: val => dispatch(setConvertGrayscale(val))
});

const ContainedApp = connect(mapStateToProps, mapDispatchToProps)(App);

export default ContainedApp;
