import React, { useId } from "react";
import type { PaletteControlProps } from "./types";

import Controls from "components/controls";
import { paletteList } from "@gyng/ditherer-filters";

import { HelpHint } from "./ControlLabel";
import { humanizeControlName } from "./labels";
import s from "./styles.module.css";

const Palette = (props: PaletteControlProps) => {
  const inputId = useId();
  const label = humanizeControlName(props.types?.label || props.name);
  const helpId = props.types?.desc ? `${inputId}-help` : undefined;
  return (
    <div className={s.group}>
      <div className={s.groupLabelRow}>
        <label className={s.name} htmlFor={inputId}>
          {label}
        </label>
        {props.types?.desc ? <HelpHint label={label} text={props.types.desc} id={helpId} /> : null}
      </div>

      <select
        id={inputId}
        className={s.enum}
        aria-describedby={helpId}
        value={props.value.name}
        onChange={(e) => {
          const selected = paletteList.find((p) => p.palette.name === e.target.value);
          if (selected) props.onSetFilterOption(props.name, selected.palette);
        }}
      >
        {paletteList.map((p) => (
          <option key={p.palette.name} value={p.palette.name}>
            {p.name}
          </option>
        ))}
      </select>

      <Controls
        {...(props.inputCanvas !== undefined ? { inputCanvas: props.inputCanvas } : {})}
        {...(props.value.optionTypes !== undefined ? { optionTypes: props.value.optionTypes } : {})}
        {...(props.paletteOptions !== undefined ? { options: props.paletteOptions } : {})}
        onAddPaletteColor={props.onAddPaletteColor}
        onSetPaletteOption={props.onSetPaletteOption}
        onSetFilterOption={props.onSetPaletteOption}
        onSaveColorPalette={props.onSaveColorPalette}
        onDeleteColorPalette={props.onDeleteColorPalette}
      />
    </div>
  );
};

export default Palette;
