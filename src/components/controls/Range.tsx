import React, { useEffect, useId, useRef, useState } from "react";
import type { RangeControlProps } from "./types";

import ControlLabel from "./ControlLabel";
import { humanizeControlName } from "./labels";
import s from "./styles.module.css";

const Range = (props: RangeControlProps) => {
  const [editValue, setEditValue] = useState(String(props.value));
  const cancelEditRef = useRef(false);
  const inputId = useId();
  const label = humanizeControlName(props.types?.label || props.name);
  const min = props.types.range[0];
  const max = props.types.range[1];
  const step = props.step ?? 1;
  const parsedEditValue = Number(editValue);
  const editValueInvalid = editValue.trim() === ""
    || !Number.isFinite(parsedEditValue)
    || parsedEditValue < min
    || parsedEditValue > max;

  useEffect(() => {
    setEditValue(String(props.value));
  }, [props.value]);

  const commitEditValue = (rawValue: string) => {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      setEditValue(String(props.value));
      return;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      setEditValue(String(props.value));
      return;
    }

    const nextValue = Math.min(max, Math.max(min, parsed));
    setEditValue(String(nextValue));
    if (!Object.is(nextValue, props.value)) {
      props.onSetFilterOption(props.name, nextValue);
    }
  };

  return (
    <div className={[s.controlField, s.range].join(" ")}>
      <ControlLabel
        htmlFor={inputId}
        name={props.name}
        label={props.types?.label}
        desc={props.types?.desc}
        currentValue={props.value}
        defaultValue={props.defaultValue}
        onReset={props.defaultValue !== undefined
          ? () => props.onSetFilterOption(props.name, props.defaultValue)
          : undefined}
      />
      <div className={s.rangeGroup}>
        <input
          id={inputId}
          type="range"
          aria-describedby={props.types?.desc ? `${inputId}-help` : undefined}
          min={min}
          max={max}
          value={props.value}
          step={step}
          onChange={event => {
            const nextValue = Number(event.target.value);
            setEditValue(event.target.value);
            props.onSetFilterOption(props.name, nextValue);
          }}
        />
        <input
          type="number"
          className={s.numberInput}
          aria-label={`${label} value`}
          aria-describedby={props.types?.desc ? `${inputId}-help` : undefined}
          aria-invalid={editValueInvalid}
          min={min}
          max={max}
          value={editValue}
          step={step}
          inputMode="decimal"
          onChange={event => setEditValue(event.target.value)}
          onBlur={event => commitEditValue(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelEditRef.current = true;
              setEditValue(String(props.value));
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
};

export default Range;
