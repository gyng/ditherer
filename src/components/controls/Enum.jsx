// @flow

import React from "react";

const Enum = (props: {
  name: string,
  value: string,
  types: { options: Array<{ name: string, value: string }> },
  onSetFilterOption: (string, any) => {}
}) => {
  return (
    <div>
      {props.name}

      <select
        value={props.value}
        onChange={e => props.onSetFilterOption(props.name, e.target.value)}
      >
        {props.types.options.map(p =>
          <option key={p.value} name={p.value}>
            {p.value}
          </option>
        )}
      </select>
    </div>
  );
};

export default Enum;
