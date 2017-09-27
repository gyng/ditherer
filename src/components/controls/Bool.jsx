// @flow

/* eslint-disable react/no-unused-prop-types */

import React from "react";

import s from "./styles.scss";

const Bool = (props: {
  name: string,
  value: boolean,
  onSetFilterOption: (string, boolean) => {}
}) => (
  <div className={s.checkbox}>
    <input
      type="checkbox"
      checked={props.value}
      onChange={e => props.onSetFilterOption(props.name, e.target.checked)}
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
