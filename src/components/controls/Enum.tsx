import React from "react";
const s = require("./styles.scss");

const Enum = (props: {
  name: string;
  value: string;
  types: { options: Array<{ name: string; value: string }> };
  onSetFilterOption: (arg0: string, arg1: any) => any;
}) => (
  <div>
    <div className={s.label}>{props.name}</div>

    <select
      className={s.enum}
      value={props.value}
      onBlur={(e) => props.onSetFilterOption(props.name, e.target.value)}
    >
      {props.types.options.map((p) => (
        <option key={p.value} id={p.value}>
          {p.value}
        </option>
      ))}
    </select>
  </div>
);

export default Enum;
