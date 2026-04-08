import React, { useState } from "react";
import { HexColorPicker } from "react-colorful";

import s from "./styles.module.css";

const ColorPicker = (props) => {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className={s.label}>{props.name}</div>
      <div className={s.colorPickerRow}>
        <div
          className={s.colorPickerSwatch}
          style={{ backgroundColor: props.value }}
          onClick={() => setOpen(!open)}
          title={props.value}
        />
        <span className={s.colorPickerHex}>{props.value}</span>
      </div>
      {open && (
        <div className={s.pickerContainer}>
          <HexColorPicker
            color={props.value}
            onChange={color => props.onSetFilterOption(props.name, color)}
          />
        </div>
      )}
    </div>
  );
};

export default ColorPicker;
