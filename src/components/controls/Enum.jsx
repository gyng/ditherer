// @flow

import React from "react";

import s from "./styles.scss";

const Enum = (props: {
  name: string,
  value: string,
  types: { options: Array<{ name: string, value: string }> },
  onSetFilterOption: (string, any) => {}
}) =>
  <div>
    <div className={s.label}>
      {props.name}
    </div>

    <select
      className={s.enum}
      value={props.value}
      onChange={e => props.onSetFilterOption(props.name, e.target.value)}
    >
      {props.types.options.map(p =>
        <option key={p.value} name={p.value}>
          {p.value}
        </option>
      )}
    </select>
  </div>;

export default Enum;
