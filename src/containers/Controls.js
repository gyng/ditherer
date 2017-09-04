// @flow

import { connect } from "react-redux";
import { setFilterOption, setFilterPaletteOption } from "actions";
import Controls from "components/controls";
import type { State } from "types";

const mapStateToProps = (state: State) => ({
  optionTypes: state.filters.selected.filter.optionTypes,
  options: state.filters.selected.filter.options
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onSetFilterOption: (name, value) => dispatch(setFilterOption(name, value)),
  onSetPaletteOption: (name, value) =>
    dispatch(setFilterPaletteOption(name, value))
});

const ContainedControls = connect(mapStateToProps, mapDispatchToProps)(
  Controls
);

export default ContainedControls;
