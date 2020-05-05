import React from "react";
const s = require("./styles.scss");

const Bool = (props: {
  name: string;
  value: boolean;
  onSetFilterOption: (arg0: string, arg1: boolean) => {};
}) => (
  <div className={s.checkbox}>
    <input
      type="checkbox"
      checked={props.value}
      onChange={(e) => props.onSetFilterOption(props.name, e.target.checked)}
    />
    <span
      className={s.label}
      role="presentation"
      onClick={() => props.onSetFilterOption(props.name, !props.value)}
    >
      {props.name}
    </span>
  </div>
);

export default Bool;
