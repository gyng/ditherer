// @flow

import React from "react";

import { THEMES } from "palettes/user";

const ColorArray = (props: any) => {
  const currentTheme = Object.entries(THEMES).find(e => e[1] === props.value);
  const customThemeName = "Custom";
  const currentThemeName = currentTheme ? currentTheme[0] : customThemeName;

  return (
    <div style={{ display: "flex", flexDirection: "row" }}>
      {props.value.map(c =>
        <div
          key={c}
          style={{
            minHeight: "16px",
            minWidth: "16px",
            backgroundColor: `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`
          }}
        />
      )}

      <div>
        Pick theme:{" "}
        <select
          value={currentThemeName}
          onChange={e =>
            props.onSetPaletteOption("colors", THEMES[e.target.value])}
        >
          {Object.entries(THEMES).map(e => {
            const [key, val] = e;
            return (
              <option key={key} name={key} data-colors={val}>
                {key}
              </option>
            );
          })}
          <option key={customThemeName} name={customThemeName}>
            Custom
          </option>
        </select>
      </div>
    </div>
  );
};

export default ColorArray;
