import React, { useId } from "react";
import type { EnumControlProps } from "./types";

import ControlLabel from "./ControlLabel";
import s from "./styles.module.css";

const Enum = (props: EnumControlProps) => {
  const inputId = useId();
  const renderOption = (option: { name?: string; value: string | number }) => (
    <option key={option.value} value={option.value}>
      {option.name || option.value}
    </option>
  );

  return (
    <div className={props.hideLabel ? undefined : s.controlField}>
      {!props.hideLabel && (
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
      )}

      <select
        id={inputId}
        aria-label={props.hideLabel ? props.types?.label || props.name : undefined}
        aria-describedby={!props.hideLabel && props.types?.desc ? `${inputId}-help` : undefined}
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
