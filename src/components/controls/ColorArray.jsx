// @flow

/* eslint-disable no-alert, react/no-unused-prop-types, react/prop-types, jsx-a11y/accessible-emoji */

import React from "react";

import { THEMES } from "palettes/user";
import { rgba, uniqueColors, medianCutPalette } from "utils";

import type { ColorRGBA } from "types";

import s from "./styles.scss";

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

type Props = {
  value: { [string]: any },
  inputCanvas: ?HTMLCanvasElement,
  onSetPaletteOption: (string, any) => {},
  onAddPaletteColor: ColorRGBA => {},
  onSaveColorPalette: (string, Array<ColorRGBA>) => {},
  onDeleteColorPalette: string => {}
};

export default class ColorArray extends React.Component<*, Props> {
  render() {
    const currentTheme = Object.entries(THEMES).find(
      e => e[1] === this.props.value
    );
    const customThemeName = "Custom";
    const currentThemeName = currentTheme ? currentTheme[0] : customThemeName;

    const themePicker = (
      <select
        className={s.enum}
        value={currentThemeName}
        onChange={e =>
          this.props.onSetPaletteOption("colors", THEMES[e.target.value])}
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
    );

    let i = 0;
    const colorSwatch = (
      <div className={s.colorArray}>
        {this.props.value.map(c => {
          const color = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

          return (
            <div
              key={`${c}-${i++}`} // eslint-disable-line
              title={color}
              style={{
                minHeight: "16px",
                minWidth: "16px",
                backgroundColor: color
              }}
            />
          );
        })}
      </div>
    );

    const onAddColorButton = (
      <button
        onClick={() => {
          const colorString = prompt(
            'Add a color: "r,g,b,a" (0-255 for each, eg. 255,0,0,255 for red)'
          );
          const color = convertCsvToColor(colorString);

          if (color) {
            this.props.onAddPaletteColor(color);
          }
        }}
      >
        🖌 Add color
      </button>
    );

    const extractColorsButton = (
      <button
        onClick={() => {
          const ctx =
            this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
          if (ctx) {
            const topN = parseInt(prompt("Take the top n colors", 64), 10);

            const colors = uniqueColors(
              ctx.getImageData(
                0,
                0,
                (this.props.inputCanvas && this.props.inputCanvas.width) || 0,
                (this.props.inputCanvas && this.props.inputCanvas.height) || 0
              ).data,
              topN
            );
            this.props.onSetPaletteOption("colors", colors);
          }
        }}
      >
        🖼️ Top
      </button>
    );

    const extractAdaptiveColorsPalette = (
      <button
        onClick={() => {
          const ctx =
            this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
          if (ctx) {
            const topN = parseInt(prompt("Take the top 2^n colors", 4), 10);

            const colors = medianCutPalette(
              ctx.getImageData(
                0,
                0,
                (this.props.inputCanvas && this.props.inputCanvas.width) || 0,
                (this.props.inputCanvas && this.props.inputCanvas.height) || 0
              ).data,
              topN,
              true,
              "MID"
            );
            this.props.onSetPaletteOption("colors", colors);
          }
        }}
      >
        🖼️ Adapt
      </button>
    );

    const extractAdaptiveColorsPaletteLab = (
      <button
        onClick={() => {
          const ctx =
            this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
          if (ctx) {
            const topN = parseInt(prompt("Take the top 2^n colors", 4), 10);

            const colors = medianCutPalette(
              ctx.getImageData(
                0,
                0,
                (this.props.inputCanvas && this.props.inputCanvas.width) || 0,
                (this.props.inputCanvas && this.props.inputCanvas.height) || 0
              ).data,
              topN,
              true,
              "MID",
              "LAB"
            );
            this.props.onSetPaletteOption("colors", colors);
          }
        }}
      >
        🖼️ Adapt (Lab)
      </button>
    );

    const extractAdaptiveColorsPaletteAverage = (
      <button
        onClick={() => {
          const ctx =
            this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
          if (ctx) {
            const topN = parseInt(
              prompt("Take the top 2^n colors (averaged)", 4),
              10
            );

            const colors = medianCutPalette(
              ctx.getImageData(
                0,
                0,
                (this.props.inputCanvas && this.props.inputCanvas.width) || 0,
                (this.props.inputCanvas && this.props.inputCanvas.height) || 0
              ).data,
              topN,
              true,
              "AVERAGE"
            );
            this.props.onSetPaletteOption("colors", colors, true);
          }
        }}
      >
        🖼️ Adapt avg.
      </button>
    );

    const extractAdaptiveColorsPaletteAverageLab = (
      <button
        onClick={() => {
          const ctx =
            this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
          if (ctx) {
            const topN = parseInt(
              prompt("Take the top 2^n colors (averaged)", 4),
              10
            );

            const colors = medianCutPalette(
              ctx.getImageData(
                0,
                0,
                (this.props.inputCanvas && this.props.inputCanvas.width) || 0,
                (this.props.inputCanvas && this.props.inputCanvas.height) || 0
              ).data,
              topN,
              true,
              "AVERAGE",
              "LAB"
            );
            this.props.onSetPaletteOption("colors", colors, true);
          }
        }}
      >
        🖼️ Adapt avg. (Lab)
      </button>
    );

    const extractAdaptiveColorsPaletteFirst = (
      <button
        onClick={() => {
          const ctx =
            this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
          if (ctx) {
            const topN = parseInt(
              prompt("Take the top 2^n colors (averaged)", 4),
              10
            );

            const colors = medianCutPalette(
              ctx.getImageData(
                0,
                0,
                (this.props.inputCanvas && this.props.inputCanvas.width) || 0,
                (this.props.inputCanvas && this.props.inputCanvas.height) || 0
              ).data,
              topN,
              true,
              "FIRST"
            );
            this.props.onSetPaletteOption("colors", colors, true);
          }
        }}
      >
        🖼️ Adapt edge
      </button>
    );

    const extractAdaptiveColorsPaletteFirstLab = (
      <button
        onClick={() => {
          const ctx =
            this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
          if (ctx) {
            const topN = parseInt(
              prompt("Take the top 2^n colors (averaged)", 4),
              10
            );

            const colors = medianCutPalette(
              ctx.getImageData(
                0,
                0,
                (this.props.inputCanvas && this.props.inputCanvas.width) || 0,
                (this.props.inputCanvas && this.props.inputCanvas.height) || 0
              ).data,
              topN,
              true,
              "FIRST",
              "LAB"
            );
            this.props.onSetPaletteOption("colors", colors, true);
          }
        }}
      >
        🖼️ Adapt edge (Lab)
      </button>
    );

    const savePaletteButton = (
      <button
        onClick={() => {
          const name = prompt("Save current palette as");
          const savedName = `🎨 ${name}`;

          if (!name || THEMES[savedName]) {
            alert(
              "Could not save: name taken or invalid. Use a different name. "
            );
          } else {
            // $FlowFixMe
            this.props.onSaveColorPalette(savedName, this.props.value);
            this.forceUpdate();
          }
        }}
      >
        🎨 Save theme locally
      </button>
    );

    const deletePaletteButton = (
      <button
        onClick={() => {
          if (!currentTheme || !currentTheme[0]) {
            return;
          }

          this.props.onDeleteColorPalette(currentTheme[0]);
          this.forceUpdate();
        }}
      >
        🎨 Delete theme
      </button>
    );

    return (
      <div>
        <div>
          <div className={s.label}>Theme</div>
          {themePicker}
        </div>

        {colorSwatch}
        {onAddColorButton}
        {extractColorsButton}
        {extractAdaptiveColorsPalette}
        {extractAdaptiveColorsPaletteLab}
        {extractAdaptiveColorsPaletteAverage}
        {extractAdaptiveColorsPaletteAverageLab}
        {extractAdaptiveColorsPaletteFirst}
        {extractAdaptiveColorsPaletteFirstLab}
        {!currentTheme ? savePaletteButton : null}
        {currentTheme && currentTheme[0] && currentTheme[0].includes("🎨 ") // Hack!
          ? deletePaletteButton
          : null}
      </div>
    );
  }
}
