// @flow

/* eslint-disable react/no-unused-prop-types */

import React from "react";

import s from "./styles.scss";

const Bool = (props: {
  name: string,
  value: boolean,
  onSetFilterOption: (string, boolean) => {}
}) =>
  <div>
    <input
      type="checkbox"
      checked={props.value}
      onChange={e => props.onSetFilterOption(props.name, e.target.checked)}
    />
    <span className={s.label}>
      {props.name}
    </span>
  </div>;

export default Bool;
