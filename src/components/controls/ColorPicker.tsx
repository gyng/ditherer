import React, { useState } from "react";
import { HexColorPicker } from "react-colorful";

import s from "./styles.module.css";

// Convert between [r,g,b] arrays and hex strings
const toHex = (value: any): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const [r, g, b] = value;
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }
  return "#000000";
};

const fromHex = (hex: string, originalFormat: any): any => {
  // If original was an array, return array; otherwise return hex string
  if (Array.isArray(originalFormat)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  }
  return hex;
};

const ColorPicker = (props) => {
  const [open, setOpen] = useState(false);
  const hexValue = toHex(props.value);

  return (
    <div>
      <div className={s.label}>{props.name}</div>
      <div className={s.colorPickerRow}>
        <div
          className={s.colorPickerSwatch}
          style={{ backgroundColor: hexValue }}
          onClick={() => setOpen(!open)}
          title={hexValue}
        />
        <span className={s.colorPickerHex}>{hexValue}</span>
      </div>
      {open && (
        <div className={s.pickerContainer}>
          <HexColorPicker
            color={hexValue}
            onChange={color => props.onSetFilterOption(props.name, fromHex(color, props.value))}
          />
        </div>
      )}
    </div>
  );
};

export default ColorPicker;
