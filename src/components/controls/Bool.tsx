import React from "react";
import type { BoolControlProps } from "./types";

import s from "./styles.module.css";

const Bool = (props: BoolControlProps) => {
  const label = props.types?.label || props.name;

  return (
    <div className={s.checkbox}>
      <input
        type="checkbox"
        checked={Boolean(props.value)}
        onChange={e => props.onSetFilterOption(props.name, e.target.checked)}
      />
      <span
        className={s.label}
        role="presentation"
        onClick={() => props.onSetFilterOption(props.name, !props.value)}
      >
        {label}
        {props.types?.desc && <span className={s.info} title={props.types.desc}>(i)</span>}
      </span>
    </div>
  );
};

export default Bool;
