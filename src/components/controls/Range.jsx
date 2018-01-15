// @flow

import React from "react";

import s from "./styles.scss";

const Range = (props: {
  name: string,
  types: { range: [number, number] },
  value: number,
  step: ?number,
  onSetFilterOption: (string, any) => {}
}) => (
  <div className={s.range}>
    <div className={s.label}>{props.name}</div>
    <div className={s.rangeGroup}>
      <input
        type="range"
        min={props.types.range[0]}
        max={props.types.range[1]}
        value={props.value}
        step={props.step || 1}
        onChange={e =>
          props.onSetFilterOption(props.name, parseFloat(e.target.value))}
      />

      <span
        role="button"
        tabIndex="0"
        className={[s.value, s.clickable].join(" ")}
        onClick={() => {
          const newValue = window.prompt("Value"); // eslint-disable-line
          const parsed = parseFloat(newValue);
          if (parsed || parsed === 0) {
            props.onSetFilterOption(props.name, parsed);
          }
        }}
      >
        {props.value}
      </span>
    </div>
  </div>
);

export default Range;
