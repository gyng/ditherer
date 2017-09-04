// @flow

import React from "react";

const Stringly = (props: {
  name: string,
  value: string,
  onSetFilterOption: (string, any) => {}
}) => {
  return (
    <div>
      {props.name}
      <input
        type="text"
        value={props.value}
        onChange={e => props.onSetFilterOption(props.name, e.target.value)}
      />
    </div>
  );
};

export default Stringly;
