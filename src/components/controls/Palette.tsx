import React from "react";
import type { PaletteControlProps } from "./types";

import Controls from "components/controls";
import { paletteList } from "palettes";

import s from "./styles.module.css";

const Palette = (props: PaletteControlProps) => (
  <div className={s.group}>
    <span className={s.name}>{props.name}</span>

    <select
      className={s.enum}
      value={props.value.name}
      onChange={e => {
        const selected = paletteList.find(p => p.name === e.target.value);
        if (selected) props.onSetFilterOption(props.name, selected.palette);
      }}
    >
      {paletteList.map(p => (
        <option key={p.name} value={p.name}>
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

export default Palette;
