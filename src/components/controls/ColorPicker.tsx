import React, { useState } from "react";
import { HexColorPicker } from "react-colorful";

import s from "./styles.module.css";

// COLOR type is always [r, g, b] arrays
const rgbToHex = (rgb: number[]): string =>
  `#${((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1)}`;

const hexToRgb = (hex: string): number[] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
];

const ColorPicker = (props) => {
  const [open, setOpen] = useState(false);
  const hex = Array.isArray(props.value) ? rgbToHex(props.value) : (props.value || "#000000");

  return (
    <div>
      <div className={s.label}>{props.name}</div>
      <div className={s.colorPickerRow}>
        <div
          className={s.colorPickerSwatch}
          style={{ backgroundColor: hex }}
          onClick={() => setOpen(!open)}
          title={hex}
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
