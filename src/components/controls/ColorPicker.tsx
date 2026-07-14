import React, { useId, useState } from "react";
import { HexColorPicker } from "react-colorful";
import type { ColorControlProps } from "./types";

import ControlLabel from "./ControlLabel";
import { humanizeControlName } from "./labels";
import s from "./styles.module.css";

// COLOR type is always [r, g, b] arrays
const rgbToHex = (rgb: number[]): string =>
  `#${((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1)}`;

const hexToRgb = (hex: string): number[] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
];

const ColorPicker = (props: ColorControlProps) => {
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const hex = Array.isArray(props.value) ? rgbToHex(props.value) : (props.value || "#000000");

  return (
    <div className={s.controlField}>
      <ControlLabel
        htmlFor={inputId}
        name={props.name}
        label={props.types?.label}
        desc={props.types?.desc}
        currentValue={props.value}
        defaultValue={props.defaultValue}
        onReset={props.defaultValue !== undefined
          ? () => props.onSetFilterOption(props.name, props.defaultValue)
          : undefined}
      />
      <div className={s.colorPickerRow}>
        <button
          id={inputId}
          type="button"
          className={s.colorPickerSwatch}
          style={{ backgroundColor: hex }}
          onClick={() => setOpen(!open)}
          title={hex}
          aria-label={`${open ? "Close" : "Open"} ${humanizeControlName(props.types?.label || props.name)} color picker, current color ${hex}`}
          aria-expanded={open}
          aria-describedby={props.types?.desc ? `${inputId}-help` : undefined}
        />
        <span className={s.colorPickerHex}>{hex}</span>
      </div>
      {open && (
        <div className={s.pickerContainer}>
          <HexColorPicker
            color={hex}
            onChange={color => props.onSetFilterOption(props.name, hexToRgb(color))}
          />
        </div>
      )}
    </div>
  );
};

export default ColorPicker;
