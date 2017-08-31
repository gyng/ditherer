// @flow

import { connect } from "react-redux";
import { loadImageAsync, filterImageAsync } from "actions";
import App from "components/App";
import type { State } from "types";

const mapStateToProps = (state: State) => ({
  inputImage: state.counters.inputImage,
  outputImage: state.counters.outputImage
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onLoadImage: e => dispatch(loadImageAsync(e.target.files[0])),
  onFilterImage: e => dispatch(filterImageAsync(e))
});

const ContainedApp = connect(mapStateToProps, mapDispatchToProps)(App);

export default ContainedApp;
