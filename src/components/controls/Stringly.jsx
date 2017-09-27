// @flow

import React from "react";

import s from "./styles.scss";

const Stringly = (props: {
  name: string,
  value: string,
  onSetFilterOption: (string, any) => {}
}) => (
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
