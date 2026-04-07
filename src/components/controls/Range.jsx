import React from "react";

import s from "./styles.module.css";

const onManualValue = props => {
  const newValue = window.prompt("Value");  
  const parsed = parseFloat(newValue);
  if (parsed || parsed === 0) {
    props.onSetFilterOption(props.name, parsed);
  }
};

const Range = (props) => (
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
          props.onSetFilterOption(props.name, parseFloat(e.target.value))
        }
      />

      <span
        role="button"
        tabIndex="0"
        className={[s.value, s.clickable].join(" ")}
        onClick={() => onManualValue(props)}
        onKeyPress={e => {
          if (e.key === "Enter") {
            onManualValue(props);
          }
        }}
      >
        {props.value}
      </span>
    </div>
  </div>
);

export default Range;
