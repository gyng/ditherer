// @flow

import { connect } from "react-redux";
import {
  addPaletteColor,
  setFilterOption,
  setFilterPaletteOption,
  saveCurrentColorPalette,
  deleteCurrentColorPalette
} from "actions";
import Controls from "components/controls";

import type { State } from "types";
import type { Dispatch } from "redux";

const mapStateToProps = (
  state: State,
  ownProps: { inputCanvas: ?HTMLCanvasElement }
) => ({
  optionTypes: state.filters.selected.filter.optionTypes,
  options: state.filters.selected.filter.options,
  inputCanvas: ownProps.inputCanvas
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onSetFilterOption: (name, value) => dispatch(setFilterOption(name, value)),
  onSetPaletteOption: (name, value) =>
    dispatch(setFilterPaletteOption(name, value)),
  onAddPaletteColor: color => dispatch(addPaletteColor(color)),
  onSaveColorPalette: (name, colors) =>
    dispatch(saveCurrentColorPalette(name, colors)),
  onDeleteColorPalette: name => dispatch(deleteCurrentColorPalette(name))
});

const ContainedControls = connect(mapStateToProps, mapDispatchToProps)(
  Controls
);

export default ContainedControls;
