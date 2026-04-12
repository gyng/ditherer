import React from "react";
import type { StringControlProps } from "./types";

import s from "./styles.module.css";

const Stringly = (props: StringControlProps) => (
  <div>
    <div className={s.label}>{props.name}</div>
    <input
      type="text"
      value={props.value}
      onChange={e => props.onSetFilterOption(props.name, e.target.value)}
    />
  </div>
);

export default Stringly;
