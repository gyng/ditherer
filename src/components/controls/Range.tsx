import React, { useState } from "react";
import type { RangeControlProps } from "./types";

import s from "./styles.module.css";

const Range = (props: RangeControlProps) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const label = props.types?.label || props.name;

  return (
    <div className={s.range}>
      <div className={s.label}>
        {label}
        {props.types?.desc && <span className={s.info} title={props.types.desc}>(i)</span>}
      </div>
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

        {editing ? (
          <input
            type="number"
            className={[s.value, s.clickable].join(" ")}
            value={editValue}
            step={props.step || 1}
            autoFocus
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => {
              const parsed = parseFloat(editValue);
              if (!isNaN(parsed)) {
                props.onSetFilterOption(props.name, parsed);
              }
              setEditing(false);
            }}
            onKeyDown={e => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span
            role="button"
            tabIndex={0}
            className={[s.value, s.clickable].join(" ")}
            onClick={() => {
              setEditValue(String(props.value));
              setEditing(true);
            }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                setEditValue(String(props.value));
                setEditing(true);
              }
            }}
          >
            {props.value}
          </span>
        )}
      </div>
    </div>
  );
};

export default Range;
