// @flow

/* eslint-disable react/no-unused-prop-types */

import React from "react";

import Controls from "components/controls";
import { paletteList } from "palettes";

import type { ColorRGBA, Palette as PaletteType } from "types";

import s from "./styles.scss";

const Palette = (props: {
  name: string,
  value: PaletteType,
  paletteOptions: { [string]: any },
  onSetFilterOption: (string, PaletteType) => {},
  onSetPaletteOption: (string, any) => {},
  onAddPaletteColor: ColorRGBA => {}
}) =>
  <div className={s.group}>
    <span className={s.name}>
      {props.name}
    </span>

    <select
      className={s.enum}
      value={props.value.name}
      onChange={e => props.onSetFilterOption(props.name, e.target.value)}
    >
      {paletteList.map(p =>
        <option key={p.name} name={p.name}>
          {p.name}
        </option>
      )}
    </select>

    <Controls
      optionTypes={props.value.optionTypes}
      options={props.paletteOptions}
      onAddPaletteColor={props.onAddPaletteColor}
      onSetPaletteOption={props.onSetPaletteOption}
      onSetFilterOption={props.onSetPaletteOption}
    />
  </div>;

export default Palette;