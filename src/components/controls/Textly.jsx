// @flow

import React from "react";

import s from "./styles.scss";

const Textly = (props: {
  name: string,
  value: string,
  onSetFilterOption: (string, any) => {}
}) => (
  <div>
    <div className={s.label}>{props.name}</div>
    <textarea
      type="text"
      value={props.value}
      wrap="off"
      spellCheck="false"
      onChange={e => props.onSetFilterOption(props.name, e.target.value)}
    />
  </div>
);

export default Textly;
