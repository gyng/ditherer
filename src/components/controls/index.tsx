import React from "react";
import Enum from "./Enum";
import Palette from "./Palette";
import Bool from "./Bool";
import Range from "./Range";
import Stringly from "./Stringly";
import Textly from "./Textly";
import ColorArray from "./ColorArray";
import { ColorRGBA, OptionTypes } from "@src/types";
import {
  BOOL,
  RANGE,
  ENUM,
  COLOR_ARRAY,
  STRING,
  TEXT,
  PALETTE,
} from "@src/constants/controlTypes";

const s = require("./styles.scss");

export interface ControlsProps {
  options: { [k: string]: any };
  optionTypes: OptionTypes;
  inputCanvas?: HTMLCanvasElement;
  onAddPaletteColor: (arg0: ColorRGBA) => any;
  onSetFilterOption: (arg0: string, arg1: any) => any;
  onSetPaletteOption: (arg0: string, arg1: any) => any;
  onSaveColorPalette: (arg0: string, arg1: Array<ColorRGBA>) => any;
  onDeleteColorPalette: (arg0: string) => any;
}

const Controls: React.SFC<ControlsProps> = (props) => (
  <div className={s.controls}>
    {Object.entries(props.optionTypes).map((e) => {
      const [name, oType] = e;

      switch (oType.type) {
        case RANGE:
          return (
            <Range
              key={name}
              name={name}
              types={oType}
              value={props.options[name]}
              step={oType && oType.step}
              onSetFilterOption={props.onSetFilterOption}
            />
          );
        case PALETTE:
          return (
            <Palette
              key={name}
              name={name}
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
              value={props.options.colors}
              onAddPaletteColor={props.onAddPaletteColor}
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
              value={props.options[name]}
              onSetFilterOption={props.onSetFilterOption}
            />
          );
        case TEXT:
          return (
            <Textly
              key={name}
              name={name}
              value={props.options[name]}
              onSetFilterOption={props.onSetFilterOption}
            />
          );
        case BOOL:
          return (
            <Bool
              key={name}
              name={name}
              value={props.options[name]}
              onSetFilterOption={props.onSetFilterOption}
            />
          );
        case ENUM:
          return (
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
