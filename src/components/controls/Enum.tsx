import React from "react";

import s from "./styles.module.css";

const Enum = (props) => (
  <div>
    <div className={s.label}>{props.name}</div>

    <select
      className={s.enum}
      value={props.value}
      onChange={e => props.onSetFilterOption(props.name, e.target.value)}
    >
      {props.types.options.map(p => (
        <option key={p.value} value={p.value}>
          {p.value}
        </option>
      ))}
    </select>
  </div>
);

export default Enum;
