// @flow

import React from "react";

const Bool = (props: any) =>
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
