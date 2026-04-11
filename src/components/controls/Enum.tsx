import React from "react";

import s from "./styles.module.css";

const Enum = (props) => {
  const label = props.types?.label || props.name;
  const renderOption = (option) => (
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
          Array.isArray(option.options) ? (
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
