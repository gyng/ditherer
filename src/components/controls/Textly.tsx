import React from "react";

import s from "./styles.module.css";

const Textly = (props) => (
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
