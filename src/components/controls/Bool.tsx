import React, { useId } from "react";
import type { BoolControlProps } from "./types";

import { ControlReset, HelpHint } from "./ControlLabel";
import { humanizeControlName } from "./labels";
import s from "./styles.module.css";

const Bool = (props: BoolControlProps) => {
  const inputId = useId();
  const label = humanizeControlName(props.types?.label || props.name);
  const helpId = props.types?.desc ? `${inputId}-help` : undefined;

  return (
    <div className={[s.controlField, s.checkbox].join(" ")}>
      <label htmlFor={inputId} className={s.checkboxToggle}>
        <input
          id={inputId}
          type="checkbox"
          aria-describedby={helpId}
          checked={Boolean(props.value)}
          onChange={e => props.onSetFilterOption(props.name, e.target.checked)}
        />
        <span className={s.label}>{label}</span>
      </label>
      {props.types?.desc ? <HelpHint label={label} text={props.types.desc} id={helpId} /> : null}
      {props.defaultValue !== undefined ? (
        <ControlReset
          label={label}
          currentValue={props.value}
          defaultValue={props.defaultValue}
          onReset={() => props.onSetFilterOption(props.name, props.defaultValue)}
        />
      ) : null}
    </div>
  );
};

export default Bool;
