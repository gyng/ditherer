// @flow

/* eslint-disable no-alert, react/no-unused-prop-types, react/prop-types, jsx-a11y/accessible-emoji */

import React from "react";

import { THEMES } from "palettes/user";
import { rgba, uniqueColors, medianCutPalette } from "utils";

import type { ColorRGBA } from "types";
import type { AdaptMode, ColorMode } from "utils";

import Enum from "./Enum";
import s from "./styles.scss";

export const TOP = "TOP";
export const RGB_ADAPT_MID = "RGB_ADAPT_MID";
export const RGB_ADAPT_AVERAGE = "RGB_ADAPT_AVERAGE";
export const RGB_ADAPT_FIRST = "RGB_ADAPT_FIRST";
export const LAB_ADAPT_MID = "LAB_ADAPT_MID";
export const LAB_ADAPT_AVERAGE = "LAB_ADAPT_AVERAGE";
export const LAB_ADAPT_FIRST = "LAB_ADAPT_FIRST";
export const modeMap = {
  [RGB_ADAPT_MID]: { colorMode: "RGB", adaptMode: "MID" },
  [RGB_ADAPT_AVERAGE]: { colorMode: "RGB", adaptMode: "AVERAGE" },
  [RGB_ADAPT_FIRST]: { colorMode: "RGB", adaptMode: "FIRST" },
  [LAB_ADAPT_MID]: { colorMode: "LAB", adaptMode: "MID" },
  [LAB_ADAPT_AVERAGE]: { colorMode: "LAB", adaptMode: "AVERAGE" },
  [LAB_ADAPT_FIRST]: { colorMode: "LAB", adaptMode: "FIRST" }
};

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

type State = {
  extractMode: string
};

export default class ColorArray extends React.Component<Props, State> {
  constructor() {
    super();

    this.state = {
      extractMode: TOP
    };
  }

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

    const extractTopButton = (
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
        🖼️ Extract TOP
      </button>
    );

    const extractAdaptiveButton = (
      name: string,
      ignoreAlpha: boolean,
      colorMode: ColorMode,
      adaptMode: AdaptMode
    ) => (
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
              ignoreAlpha,
              adaptMode,
              colorMode
            );
            this.props.onSetPaletteOption("colors", colors);
          }
        }}
      >
        🖼️ {`Extract ${name}`}
      </button>
    );

    const extractOptions = (
      <div>
        {
          // $FlowFixMe
          <Enum
            name="Algorithm"
            value={this.state.extractMode}
            types={{
              options: [
                { name: "Top", value: TOP },
                { name: "RGB Adaptive (mid)", value: RGB_ADAPT_MID },
                { name: "RGB Adaptive (average)", value: RGB_ADAPT_AVERAGE },
                { name: "RGB Adaptive (first)", value: RGB_ADAPT_FIRST },
                { name: "LAB Adaptive (mid)", value: LAB_ADAPT_MID },
                { name: "LAB Adaptive (average)", value: LAB_ADAPT_AVERAGE },
                { name: "LAB Adaptive (first)", value: LAB_ADAPT_FIRST }
              ]
            }}
            onSetFilterOption={(name: string, value: any) => {
              this.setState({ extractMode: value });
            }}
          />
        }

        {this.state.extractMode === TOP
          ? extractTopButton
          : extractAdaptiveButton(
              this.state.extractMode,
              true,
              modeMap[this.state.extractMode].colorMode,
              modeMap[this.state.extractMode].adaptMode
            )}
      </div>
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
        🎨 Save locally
      </button>
    );

    const exportPaletteButton = (
      <button
        onClick={() => {
          const w = window.open("");
          w.document.write(
            `Copy this:
            <textarea>${JSON.stringify(this.props.value)}</textarea>
            <hr>
            Dev:
            <textarea>${this.props.value
              .map(c => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`)
              .join(",\n")}</textarea>`
          );
        }}
      >
        🎨 Export
      </button>
    );

    const importPaletteButton = (
      <button
        onClick={() => {
          const json = window.prompt("Paste theme JSON");
          const imported = JSON.parse(json);
          this.props.onSetPaletteOption("colors", imported);
        }}
      >
        🎨 Import
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
        🎨 Delete
      </button>
    );

    return (
      <div>
        <div className={s.label}>Theme</div>
        {themePicker}
        {colorSwatch}
        {onAddColorButton}
        <div className={s.group}>
          <span className={s.name}>Extract from input</span>
          {extractOptions}
        </div>
        {!currentTheme ? savePaletteButton : null}

        {importPaletteButton}
        {!currentTheme ? exportPaletteButton : null}
        {currentTheme && currentTheme[0] && currentTheme[0].includes("🎨 ") // Hack!
          ? deletePaletteButton
          : null}
      </div>
    );
  }
}
