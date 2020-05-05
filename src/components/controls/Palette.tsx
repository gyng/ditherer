import React from "react";
import Controls from "./index";
import { paletteList } from "@src/palettes";
import { ColorRGBA, Palette as PaletteType, Palette } from "@src/types";

const s = require("./styles.scss");

export interface Props {
  name: string;
  value: PaletteType;
  inputCanvas?: HTMLCanvasElement;
  paletteOptions: { [k: string]: any };
  onSaveColorPalette: (arg0: string, arg1: Array<ColorRGBA>) => any;
  onDeleteColorPalette: (arg0: string) => any;
  onSetFilterOption: (arg0: string, arg1: PaletteType) => any;
  onSetPaletteOption: (arg0: string, arg1: any) => any;
  onAddPaletteColor: (arg0: ColorRGBA) => any;
}

const PaletteControl: React.SFC<Props> = (props) => (
  <div className={s.group}>
    <span className={s.name}>{props.name}</span>

    <select
      className={s.enum}
      value={props.value.name}
      onBlur={(e) =>
        e.target.value &&
        props.onSetFilterOption(
          props.name,
          (e.target.value as unknown) as Palette
        )
      }
    >
      {paletteList.map((p) => (
        <option key={p.name} id={p.name}>
          {p.name}
        </option>
      ))}
    </select>

    <Controls
      inputCanvas={props.inputCanvas}
      optionTypes={props.value.optionTypes}
      options={props.paletteOptions}
      onAddPaletteColor={props.onAddPaletteColor}
      onSetPaletteOption={props.onSetPaletteOption}
      onSetFilterOption={props.onSetPaletteOption}
      onSaveColorPalette={props.onSaveColorPalette}
      onDeleteColorPalette={props.onDeleteColorPalette}
    />
  </div>
);

export default PaletteControl;
