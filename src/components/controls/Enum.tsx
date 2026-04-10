import React from "react";

import s from "./styles.module.css";

const Enum = (props) => {
  const label = props.types?.label || props.name;

  return (
    <div>
      <div className={s.label}>
        {label}
        {props.types?.desc && <span className={s.info} title={props.types.desc}>(i)</span>}
      </div>

      <select
        className={s.enum}
        value={props.value}
        onChange={e => props.onSetFilterOption(props.name, e.target.value)}
      >
        {props.types.options.map(p => (
          <option key={p.value} value={p.value}>
            {p.name || p.value}
          </option>
        ))}
      </select>
    </div>
  );
};

export default Enum;
