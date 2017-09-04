// @flow

/* eslint-disable no-alert, react/no-unused-prop-types, react/prop-types */

import React from "react";

import { THEMES } from "palettes/user";
import { rgba } from "utils";

import type { ColorRGBA } from "types";

const convertCsvToColor = (csv: string): ?ColorRGBA => {
  const tokens = csv.split(",");

  if (tokens.length !== 4) {
    return null;
  }

  const channels = tokens.map(t => parseInt(t, 10));

  if (!channels.every(val => val >= 0 && val <= 255)) {
    return null;
  }

  return rgba(channels[0], channels[1], channels[2], channels[3]);
};

const ColorArray = (props: {
  value: { [string]: any },
  onSetPaletteOption: (string, any) => {},
  onAddPaletteColor: ColorRGBA => {}
}) => {
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
          <option key={customThemeName} name={customThemeName} disabled>
            Custom
          </option>
        </select>
      </div>

      <div>
        <button
          onClick={() => {
            const colorString = prompt(
              'Add a color: "r,g,b,a" (0-255 for each, eg. 255,0,0,255 for red)'
            );
            const color = convertCsvToColor(colorString);

            if (color) {
              props.onAddPaletteColor(color);
            }
          }}
        >
          Add color
        </button>
      </div>
    </div>
  );
};

export default ColorArray;
