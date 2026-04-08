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

// Convert a desired color count to median cut recursion depth (rounds up to nearest power of 2)
const colorCountToDepth = (n: number): number => Math.max(1, Math.ceil(Math.log2(n)));

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
  type: "addColor" | "extract" | "savePalette" | "importPalette";
  defaultValue?: string;
};

export default class ColorArray extends React.Component<any, any> {
  state = {
    extractMode: LAB_ADAPT_AVERAGE,
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
      case "extract": {
        const ctx = this.props.inputCanvas && this.props.inputCanvas.getContext("2d");
        if (ctx) {
          const count = parseInt(value, 10);
          if (count > 0) {
            const imageData = ctx.getImageData(
              0, 0,
              this.props.inputCanvas.width || 0,
              this.props.inputCanvas.height || 0
            ).data;

            let colors;
            if (this.state.extractMode === TOP) {
              colors = uniqueColors(imageData, count);
            } else {
              const mode = modeMap[this.state.extractMode];
              colors = medianCutPalette(
                imageData,
                colorCountToDepth(count),
                true,
                mode.adaptMode,
                mode.colorMode
              );
            }
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
            <option key={key} value={key} data-colors={val}>
              {key}
            </option>
          );
        })}
        <option key={customThemeName} value={customThemeName} disabled>
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
              tabIndex={0}
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

    const extractButton = (
      <button
        onClick={() => {
          this.setState({
            modal: {
              type: "extract",
              defaultValue: "16"
            }
          });
        }}
      >
        🖼️ Extract
      </button>
    );

    const extractOptions = (
      <div>
        <Enum
          name="Algorithm"
          value={this.state.extractMode}
          types={{
            options: [
              { name: "LAB Median cut (average)", value: LAB_ADAPT_AVERAGE },
              { name: "LAB Median cut (median)", value: LAB_ADAPT_MID },
              { name: "RGB Median cut (average)", value: RGB_ADAPT_AVERAGE },
              { name: "RGB Median cut (median)", value: RGB_ADAPT_MID },
              { name: "Top N by frequency", value: TOP },
            ]
          }}
          onSetFilterOption={(name, value) => {
            this.setState({ extractMode: value });
          }}
        />
        {extractButton}
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
      extract: "Number of colors to extract",
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
