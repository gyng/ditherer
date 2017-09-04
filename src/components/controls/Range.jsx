// @flow

import React from "react";

import s from "./styles.scss";

const Range = (props: {
  name: string,
  types: { range: [number, number] },
  value: number,
  onSetFilterOption: (string, any) => {}
}) =>
  <div className={s.range}>
    <div className={s.label}>
      {props.name}
    </div>
    <div className={s.rangeGroup}>
      <input
        type="range"
        min={props.types.range[0]}
        max={props.types.range[1]}
        value={props.value}
        onChange={e => props.onSetFilterOption(props.name, e.target.value)}
      />

      <span className={s.value}>
        {props.value}
      </span>
    </div>
  </div>;

export default Range;
