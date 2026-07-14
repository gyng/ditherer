import React, { useId } from "react";
import type { TextControlProps } from "./types";

import ControlLabel from "./ControlLabel";
import s from "./styles.module.css";

const Textly = (props: TextControlProps) => {
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
      <textarea
        id={inputId}
        className={s.textArea}
        aria-describedby={props.types?.desc ? `${inputId}-help` : undefined}
        value={props.value}
        wrap="off"
        spellCheck={false}
        onChange={e => props.onSetFilterOption(props.name, e.target.value)}
      />
    </div>
  );
};

export default Textly;
