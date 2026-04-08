import React from "react";

import {
  BOOL,
  RANGE,
  ENUM,
  COLOR_ARRAY,
  STRING,
  TEXT,
  PALETTE
} from "constants/controlTypes";

import { useFilter } from "context/FilterContext";

import Enum from "./Enum";
import Palette from "./Palette";
import Bool from "./Bool";
import Range from "./Range";
import Stringly from "./Stringly";
import Textly from "./Textly";
import ColorArray from "./ColorArray";

import s from "./styles.module.css";

const Controls = (props) => {
  const { state, actions } = useFilter();
  // Allow prop overrides for nested Controls (e.g., Palette sub-options)
  const optionTypes = props.optionTypes || state.selected.filter.optionTypes;
  const options = props.options || state.selected.filter.options;
  const inputCanvas = props.inputCanvas;
  const onSetFilterOption = props.onSetFilterOption || actions.setFilterOption;
  const onSetPaletteOption = props.onSetPaletteOption || actions.setFilterPaletteOption;
  const onAddPaletteColor = props.onAddPaletteColor || actions.addPaletteColor;
  const onSaveColorPalette = props.onSaveColorPalette || actions.saveCurrentColorPalette;
  const onDeleteColorPalette = props.onDeleteColorPalette || actions.deleteCurrentColorPalette;

  return (
    <div className={s.controls}>
      {Object.entries(optionTypes).map(e => {
        const [name, oType] = e;

        switch ((oType as any).type) {
          case RANGE:
            return (
              <Range
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                step={oType && (oType as any).step}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case PALETTE:
            return (
              <Palette
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                paletteOptions={options[name].options}
                onAddPaletteColor={onAddPaletteColor}
                onSetFilterOption={onSetFilterOption}
                onSetPaletteOption={onSetPaletteOption}
                onSaveColorPalette={onSaveColorPalette}
                onDeleteColorPalette={onDeleteColorPalette}
                inputCanvas={inputCanvas}
              />
            );
          case COLOR_ARRAY:
            return (
              <ColorArray
                key={name}
                name={name}
                value={options.colors}
                onAddPaletteColor={onAddPaletteColor}
                onSetFilterOption={onSetFilterOption}
                onSetPaletteOption={onSetPaletteOption}
                onSaveColorPalette={onSaveColorPalette}
                onDeleteColorPalette={onDeleteColorPalette}
                inputCanvas={inputCanvas}
              />
            );
          case STRING:
            return (
              <Stringly
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case TEXT:
            return (
              <Textly
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case BOOL:
            return (
              <Bool
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case ENUM:
            return (
              <Enum
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                onSetFilterOption={onSetFilterOption}
              />
            );
          default:
            return <div>Unknown setting type</div>;
        }
      })}
    </div>
  );
};

export default Controls;
