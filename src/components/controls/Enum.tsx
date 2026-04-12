import React from "react";
import type { EnumControlProps } from "./types";

import s from "./styles.module.css";

const Enum = (props: EnumControlProps) => {
  const label = props.types?.label || props.name;
  const renderOption = (option: { name?: string; value: string | number }) => (
    <option key={option.value} value={option.value}>
      {option.name || option.value}
    </option>
  );

  return (
    <div>
      {!props.hideLabel && (
        <div className={s.label}>
          {label}
          {props.types?.desc && <span className={s.info} title={props.types.desc}>(i)</span>}
        </div>
      )}

      <select
        className={s.enum}
        value={props.value}
        onChange={e => props.onSetFilterOption(props.name, e.target.value)}
      >
        {props.types.options.map((option) => (
          "options" in option ? (
            <optgroup key={option.label} label={option.label}>
              {option.options.map(renderOption)}
            </optgroup>
          ) : renderOption(option)
        ))}
      </select>
    </div>
  );
};

export default Enum;
