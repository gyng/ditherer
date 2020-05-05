import React from "react";
const s = require("./styles.scss");

const onManualValue = (props: RangeProps) => {
  const newValue = window.prompt("Value"); // eslint-disable-line
  const parsed = parseFloat(newValue ?? "0");
  if (parsed || parsed === 0) {
    props.onSetFilterOption(props.name, parsed);
  }
};

export interface RangeProps {
  name: string;
  types: { range: [number, number] };
  value: number;
  step?: number;
  onSetFilterOption: (arg0: string, arg1: any) => void;
}

const Range: React.SFC<RangeProps> = (props) => (
  <div className={s.range}>
    <div className={s.label}>{props.name}</div>
    <div className={s.rangeGroup}>
      <input
        type="range"
        min={props.types.range[0]}
        max={props.types.range[1]}
        value={props.value}
        step={props.step || 1}
        onChange={(e) =>
          props.onSetFilterOption(props.name, parseFloat(e.target.value))
        }
      />

      <span
        role="button"
        tabIndex={0}
        className={[s.value, s.clickable].join(" ")}
        onClick={() => onManualValue(props)}
        onKeyPress={(e: React.KeyboardEvent) => {
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
