import React from "react";
const s = require("./styles.scss");

export interface StringlyProps {
  name: string;
  value: string;
  onSetFilterOption: (arg0: string, arg1: any) => {};
}

const Stringly = (props: StringlyProps) => (
  <div>
    <div className={s.label}>{props.name}</div>
    <input
      type="text"
      value={props.value}
      onChange={(e) => props.onSetFilterOption(props.name, e.target.value)}
    />
  </div>
);

export default Stringly;
