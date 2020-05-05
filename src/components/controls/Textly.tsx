import React from "react";
const s = require("./styles.scss");

const Textly = (props: {
  name: string;
  value: string;
  onSetFilterOption: (arg0: string, arg1: any) => any;
}) => (
  <div>
    <div className={s.label}>{props.name}</div>
    <textarea
      value={props.value}
      wrap="off"
      spellCheck="false"
      onChange={(e) => props.onSetFilterOption(props.name, e.target.value)}
    />
  </div>
);

export default Textly;
