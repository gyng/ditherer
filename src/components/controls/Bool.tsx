import React from "react";

import s from "./styles.module.css";

const Bool = (props) => (
  <div className={s.checkbox}>
    <input
      type="checkbox"
      checked={props.value}
      onChange={e => props.onSetFilterOption(props.name, e.target.checked)}
    />
    <span
      className={s.label}
      role="presentation"
      onClick={() => props.onSetFilterOption(props.name, !props.value)}
    >
      {props.name}
      {props.types?.desc && <span className={s.info} title={props.types.desc}>(i)</span>}
    </span>
  </div>
);

export default Bool;
