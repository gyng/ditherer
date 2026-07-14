import React, { useId } from "react";
import type { StringControlProps } from "./types";

import ControlLabel from "./ControlLabel";
import s from "./styles.module.css";

const Stringly = (props: StringControlProps) => {
  const inputId = useId();
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
      <input
        id={inputId}
        className={s.textInput}
        aria-describedby={props.types?.desc ? `${inputId}-help` : undefined}
        type="text"
        value={props.value}
        onChange={e => props.onSetFilterOption(props.name, e.target.value)}
      />
    </div>
  );
};

export default Stringly;
