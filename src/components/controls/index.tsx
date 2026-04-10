import React from "react";

import {
  ACTION,
  BOOL,
  COLOR,
  RANGE,
  ENUM,
  COLOR_ARRAY,
  STRING,
  TEXT,
  PALETTE
} from "constants/controlTypes";

import { useFilter } from "context/useFilter";

import Enum from "./Enum";
import Palette from "./Palette";
import Bool from "./Bool";
import Range from "./Range";
import Stringly from "./Stringly";
import Textly from "./Textly";
import ColorArray from "./ColorArray";
import ColorPicker from "./ColorPicker";

import s from "./styles.module.css";

const Controls = (props) => {
  const { state, actions } = useFilter();
  // Allow prop overrides for nested Controls (e.g., Palette sub-options)
  const filter = state.selected?.filter;
  const optionTypes = props.optionTypes || filter?.optionTypes || {};
  const options = props.options || filter?.options || {};
  const inputCanvas = props.inputCanvas;
  const onSetFilterOption = props.onSetFilterOption || actions.setFilterOption;
  const onSetPaletteOption = props.onSetPaletteOption || actions.setFilterPaletteOption;
  const onAddPaletteColor = props.onAddPaletteColor || actions.addPaletteColor;
  const onSaveColorPalette = props.onSaveColorPalette || actions.saveCurrentColorPalette;
  const onDeleteColorPalette = props.onDeleteColorPalette || actions.deleteCurrentColorPalette;

  return (
    <div className={s.controls}>
      {Object.entries(optionTypes).filter(([, oType]) => {
        // Optional visibility predicate — option types may declare a
        // visibleWhen(options) callback to hide controls that are no-ops
        // given the current option values (e.g. rowAlternation when the
        // scan order isn't row-major).
        const vw = (oType as any).visibleWhen;
        return typeof vw !== "function" || vw(options);
      }).map(e => {
        const [name, oType] = e;
        // Coalesce missing values to the optionType's default so controls
        // never flip from uncontrolled (undefined value) to controlled
        // (defined value) on first interaction — that triggers React's
        // controlled-input warning. Happens easily when the user replaces
        // one filter with another that has a different option shape.
        const value = options[name] !== undefined ? options[name] : (oType as any).default;

        switch ((oType as any).type) {
          case ACTION:
            return (
              <button
                key={name}
                onClick={() => {
                  (oType as any).action(actions, inputCanvas, state.selected?.filter?.func, options);
                }}
              >
                {(oType as any).label || name}
              </button>
            );
          case RANGE:
            return (
              <Range
                key={name}
                name={name}
                types={oType}
                value={value}
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
                value={value}
                paletteOptions={value?.options}
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
          case COLOR:
            return (
              <ColorPicker
                key={name}
                name={name}
                value={value}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case STRING:
            return (
              <Stringly
                key={name}
                name={name}
                types={oType}
                value={value}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case TEXT:
            return (
              <Textly
                key={name}
                name={name}
                types={oType}
                value={value}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case BOOL:
            return (
              <Bool
                key={name}
                name={name}
                types={oType}
                value={value}
                onSetFilterOption={onSetFilterOption}
              />
            );
          case ENUM:
            return (
              <Enum
                key={name}
                name={name}
                types={oType}
                value={value}
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
