import React from "react";
import type { TextControlProps } from "./types";

import s from "./styles.module.css";

const Textly = (props: TextControlProps) => (
  <div>
    <div className={s.label}>{props.name}</div>
    <textarea
      value={props.value}
      wrap="off"
      spellCheck={false}
      onChange={e => props.onSetFilterOption(props.name, e.target.value)}
    />
  </div>
);

export default Textly;
