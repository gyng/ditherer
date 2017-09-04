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

const Controls = (props: {
  options: { [string]: any },
  optionTypes: OptionTypes,
  onAddPaletteColor: ColorRGBA => {},
  onSetFilterOption: (string, any) => {},
  onSetPaletteOption: (string, any) => {}
}) =>
  <div>
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
            />
          );
        case COLOR_ARRAY:
          return (
            <ColorArray
              key={name}
              name={name}
              value={props.options.colors}
              onSetFilterOption={props.onSetFilterOption}
              onSetPaletteOption={props.onSetPaletteOption}
              onAddPaletteColor={props.onAddPaletteColor}
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
  </div>;

export default Controls;
