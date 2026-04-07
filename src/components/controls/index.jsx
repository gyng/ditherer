// @flow
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

const Controls = ({ inputCanvas }) => {
  const { state, actions } = useFilter();
  const optionTypes = state.selected.filter.optionTypes;
  const options = state.selected.filter.options;

  return (
    <div className={s.controls}>
      {Object.entries(optionTypes).map(e => {
        const [name, oType] = e;

        switch (oType.type) {
          case RANGE:
            return (
              <Range
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                step={oType && oType.step}
                onSetFilterOption={actions.setFilterOption}
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
                onAddPaletteColor={actions.addPaletteColor}
                onSetFilterOption={actions.setFilterOption}
                onSetPaletteOption={actions.setFilterPaletteOption}
                onSaveColorPalette={actions.saveCurrentColorPalette}
                onDeleteColorPalette={actions.deleteCurrentColorPalette}
                inputCanvas={inputCanvas}
              />
            );
          case COLOR_ARRAY:
            return (
              <ColorArray
                key={name}
                name={name}
                value={options.colors}
                onAddPaletteColor={actions.addPaletteColor}
                onSetFilterOption={actions.setFilterOption}
                onSetPaletteOption={actions.setFilterPaletteOption}
                onSaveColorPalette={actions.saveCurrentColorPalette}
                onDeleteColorPalette={actions.deleteCurrentColorPalette}
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
                onSetFilterOption={actions.setFilterOption}
              />
            );
          case TEXT:
            return (
              <Textly
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                onSetFilterOption={actions.setFilterOption}
              />
            );
          case BOOL:
            return (
              <Bool
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                onSetFilterOption={actions.setFilterOption}
              />
            );
          case ENUM:
            return (
              <Enum
                key={name}
                name={name}
                types={oType}
                value={options[name]}
                onSetFilterOption={actions.setFilterOption}
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
