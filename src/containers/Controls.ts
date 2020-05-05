import { connect } from "react-redux";
import Controls from "@src/components/controls";
import {
  addPaletteColor,
  setFilterOption,
  setFilterPaletteOption,
  saveCurrentColorPalette,
  deleteCurrentColorPalette,
} from "@src/actions";

import type { RootState, RootDispatch } from "@src/types";

const mapStateToProps = (
  state: RootState,
  ownProps: { inputCanvas?: HTMLCanvasElement | null }
) => ({
  optionTypes: state.filters.selected.filter.optionTypes,
  options: state.filters.selected.filter.options,
  inputCanvas: ownProps.inputCanvas,
});

const mapDispatchToProps = (dispatch: RootDispatch) => ({
  onSetFilterOption: (name: any, value: any) =>
    dispatch(setFilterOption(name, value)),
  onSetPaletteOption: (name: any, value: any) =>
    dispatch(setFilterPaletteOption(name, value)),
  onAddPaletteColor: (color: any) => dispatch(addPaletteColor(color)),
  onSaveColorPalette: (name: any, colors: any) =>
    dispatch(saveCurrentColorPalette(name, colors)),
  onDeleteColorPalette: (name: any) =>
    dispatch(deleteCurrentColorPalette(name)),
});

const ContainedControls = connect(
  mapStateToProps,
  mapDispatchToProps
)(Controls);

export default ContainedControls;
