import React from "react";

import { THEMES } from "palettes/user";
import { rgba, uniqueColors, medianCutPalette } from "utils";
import ModalInput from "components/ModalInput";

import Enum from "./Enum";
import s from "./styles.module.css";

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

const convertCsvToColor = (csv) => {
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

const onDeleteColor = (e, props) => {
  props.onSetPaletteOption(
    "colors",
    props.value.filter(
      (_, idx) => idx !== parseInt(e.target.dataset.idx, 10) - 1
    )
  );
};

type ModalState = null | {
  type: "addColor" | "extractTop" | "extractAdaptive" | "savePalette" | "importPalette";
  defaultValue?: string;
};

export default class ColorArray extends React.Component {
  state = {
    extractMode: TOP,
    modal: null as ModalState
  };

  handleModalConfirm = (value: string) => {
    const { modal } = this.state;
    if (!modal) return;

    switch (modal.type) {
      case "addColor": {
        const color = convertCsvToColor(value);
        if (color) this.props.onAddPaletteColor(color);
        break;
      }
      case "extractTop": {
        const ctx = this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
        if (ctx) {
          const topN = parseInt(value, 10);
          if (topN > 0) {
            const colors = uniqueColors(
              ctx.getImageData(0, 0, this.props.inputCanvas.width || 0, this.props.inputCanvas.height || 0).data,
              topN
            );
            this.props.onSetPaletteOption("colors", colors);
          }
        }
        break;
      }
      case "extractAdaptive": {
        const ctx = this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
        if (ctx) {
          const topN = parseInt(value, 10);
          if (topN > 0) {
            const mode = modeMap[this.state.extractMode];
            const colors = medianCutPalette(
              ctx.getImageData(0, 0, this.props.inputCanvas.width || 0, this.props.inputCanvas.height || 0).data,
              topN,
              true,
              mode.adaptMode,
              mode.colorMode
            );
            this.props.onSetPaletteOption("colors", colors);
          }
        }
        break;
      }
      case "savePalette": {
        const savedName = `🎨 ${value}`;
        if (!value || THEMES[savedName]) {
          alert("Could not save: name taken or invalid. Use a different name.");
        } else {
          this.props.onSaveColorPalette(savedName, this.props.value);
          this.forceUpdate();
        }
        break;
      }
      case "importPalette": {
        try {
          const imported = JSON.parse(value);
          this.props.onSetPaletteOption("colors", imported);
        } catch {
          // invalid JSON — ignore
        }
        break;
      }
    }

    this.setState({ modal: null });
  };

  render() {
    if (!this.props.value || !Array.isArray(this.props.value)) {
      return <div>No colors</div>;
    }

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
          this.props.onSetPaletteOption("colors", THEMES[e.target.value])
        }
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
              key={`${c}-${i++}`}
              className={s.color}
              data-idx={i}
              title={`${color} - click to remove`}
              role="button"
              tabIndex="0"
              onKeyPress={e => {
                if (e.key === "Enter") {
                  onDeleteColor(e, this.props);
                }
              }}
              onClick={e => {
                onDeleteColor(e, this.props);
              }}
              style={{
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
          this.setState({
            modal: {
              type: "addColor",
              defaultValue: "255,0,0,255"
            }
          });
        }}
      >
        🖌 Add color
      </button>
    );

    const extractTopButton = (
      <button
        onClick={() => {
          this.setState({
            modal: {
              type: "extractTop",
              defaultValue: "64"
            }
          });
        }}
      >
        🖼️ Extract TOP
      </button>
    );

    const extractAdaptiveButton = (name) => (
      <button
        onClick={() => {
          this.setState({
            modal: {
              type: "extractAdaptive",
              defaultValue: "4"
            }
          });
        }}
      >
        🖼️ {`Extract ${name}`}
      </button>
    );

    const extractOptions = (
      <div>
        {
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
            onSetFilterOption={(name, value) => {
              this.setState({ extractMode: value });
            }}
          />
        }

        {this.state.extractMode === TOP
          ? extractTopButton
          : extractAdaptiveButton(this.state.extractMode)}
      </div>
    );

    const savePaletteButton = (
      <button
        onClick={() => {
          this.setState({ modal: { type: "savePalette" } });
        }}
      >
        🎨 Save locally
      </button>
    );

    const exportPaletteButton = (
      <button
        onClick={() => {
          const blob = new Blob([JSON.stringify(this.props.value)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "palette.json";
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        🎨 Export
      </button>
    );

    const importPaletteButton = (
      <button
        onClick={() => {
          this.setState({ modal: { type: "importPalette" } });
        }}
      >
        🎨 Import palette
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

    const modalTitles = {
      addColor: "Add a color (r,g,b,a — 0-255 each)",
      extractTop: "Take the top n colors",
      extractAdaptive: "Take the top 2^n colors",
      savePalette: "Save current palette as",
      importPalette: "Paste theme JSON"
    };

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
        {currentTheme && currentTheme[0] && currentTheme[0].includes("🎨 ")
          ? deletePaletteButton
          : null}

        {this.state.modal && (
          <ModalInput
            title={modalTitles[this.state.modal.type]}
            defaultValue={this.state.modal.defaultValue || ""}
            multiline={this.state.modal.type === "importPalette"}
            onConfirm={this.handleModalConfirm}
            onCancel={() => this.setState({ modal: null })}
          />
        )}
      </div>
    );
  }
}
