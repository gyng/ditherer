// @flow

/* eslint-disable react/no-unused-prop-types */

import React from "react";

import {
  BOOL,
  RANGE,
  ENUM,
  COLOR_ARRAY,
  STRING,
  PALETTE
} from "constants/controlTypes";

import type { ColorRGBA, OptionTypes } from "types";

import Enum from "./Enum";
import Palette from "./Palette";
import Bool from "./Bool";
import Range from "./Range";
import Stringly from "./Stringly";
import ColorArray from "./ColorArray";

import s from "./styles.scss";

const Controls = (props: {
  options: { [string]: any },
  optionTypes: OptionTypes,
  inputCanvas: ?HTMLCanvasElement,
  onAddPaletteColor: ColorRGBA => {},
  onSetFilterOption: (string, any) => {},
  onSetPaletteOption: (string, any) => {},
  onSaveColorPalette: (string, Array<ColorRGBA>) => {},
  onDeleteColorPalette: string => {}
}) => (
  <div className={s.controls}>
    {Object.entries(props.optionTypes).map(e => {
      const [name, oType] = e;

      // $FlowFixMe
      switch (oType.type) {
        case RANGE:
          return (
            // $FlowFixMe
            <Range
              key={name}
              name={name}
              types={oType}
              value={props.options[name]}
              // $FlowFixMe
              step={oType && oType.step}
              onSetFilterOption={props.onSetFilterOption}
            />
          );
        case PALETTE:
          return (
            <Palette
              key={name}
              name={name}
              types={oType}
              value={props.options[name]}
              paletteOptions={props.options[name].options}
              onAddPaletteColor={props.onAddPaletteColor}
              onSetFilterOption={props.onSetFilterOption}
              onSetPaletteOption={props.onSetPaletteOption}
              onSaveColorPalette={props.onSaveColorPalette}
              onDeleteColorPalette={props.onDeleteColorPalette}
              inputCanvas={props.inputCanvas}
            />
          );
        case COLOR_ARRAY:
          return (
            <ColorArray
              key={name}
              name={name}
              value={props.options.colors}
              onAddPaletteColor={props.onAddPaletteColor}
              onSetFilterOption={props.onSetFilterOption}
              onSetPaletteOption={props.onSetPaletteOption}
              onSaveColorPalette={props.onSaveColorPalette}
              onDeleteColorPalette={props.onDeleteColorPalette}
              inputCanvas={props.inputCanvas}
            />
          );
        case STRING:
          return (
            <Stringly
              key={name}
              name={name}
              types={oType}
              value={props.options[name]}
              onSetFilterOption={props.onSetFilterOption}
            />
          );
        case BOOL:
          return (
            <Bool
              key={name}
              name={name}
              types={oType}
              value={props.options[name]}
              onSetFilterOption={props.onSetFilterOption}
            />
          );
        case ENUM:
          return (
            // $FlowFixMe
            <Enum
              key={name}
              name={name}
              types={oType}
              value={props.options[name]}
              onSetFilterOption={props.onSetFilterOption}
            />
          );
        default:
          return <div>Unknown setting type</div>;
      }
    })}
  </div>
);

export default Controls;
