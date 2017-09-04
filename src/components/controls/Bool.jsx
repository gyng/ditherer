// @flow

/* eslint-disable react/no-unused-prop-types */

import React from "react";

const Bool = (props: {
  name: string,
  value: boolean,
  onSetFilterOption: (string, boolean) => {}
}) =>
  <div>
    {props.name}
    <input
      type="checkbox"
      checked={props.value}
      onChange={e => props.onSetFilterOption(props.name, e.target.checked)}
    />
    {props.value}
  </div>;

export default Bool;
