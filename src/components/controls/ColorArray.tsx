import React from "react";
import { RgbaColorPicker, type RgbaColor } from "react-colorful";

import {
  findMatchingThemeKey,
  getThemeDescription,
  medianCutPalette,
  rgba,
  THEMES,
  THEME_CATEGORIES,
  uniqueColors,
} from "@gyng/ditherer-filters";
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
type ExtractMode = typeof TOP | typeof RGB_ADAPT_MID | typeof RGB_ADAPT_AVERAGE | typeof RGB_ADAPT_FIRST | typeof LAB_ADAPT_MID | typeof LAB_ADAPT_AVERAGE | typeof LAB_ADAPT_FIRST;
type AdaptModeEntry = { colorMode: string; adaptMode: string };

export const modeMap: Record<Exclude<ExtractMode, typeof TOP>, AdaptModeEntry> = {
  [RGB_ADAPT_MID]: { colorMode: "RGB", adaptMode: "MID" },
  [RGB_ADAPT_AVERAGE]: { colorMode: "RGB", adaptMode: "AVERAGE" },
  [RGB_ADAPT_FIRST]: { colorMode: "RGB", adaptMode: "FIRST" },
  [LAB_ADAPT_MID]: { colorMode: "LAB", adaptMode: "MID" },
  [LAB_ADAPT_AVERAGE]: { colorMode: "LAB", adaptMode: "AVERAGE" },
  [LAB_ADAPT_FIRST]: { colorMode: "LAB", adaptMode: "FIRST" }
};

// Convert a desired color count to median cut recursion depth (rounds up to nearest power of 2)
const colorCountToDepth = (n: number): number => Math.max(1, Math.ceil(Math.log2(n)));

type PaletteColor = number[];

interface ColorArrayProps {
  name?: string;
  inputCanvas?: HTMLCanvasElement | null;
  value: PaletteColor[];
  onAddPaletteColor: (color: PaletteColor) => void;
  onSetPaletteOption: (name: string, value: unknown) => void;
  onSetFilterOption?: (name: string, value: unknown) => void;
  onSaveColorPalette: (name: string, colors: PaletteColor[]) => void;
  onDeleteColorPalette: (name: string) => void;
}

interface ColorArrayState {
  extractMode: ExtractMode;
  modal: ModalState;
  pickerOpen: boolean;
  pickerColor: RgbaColor;
  extractCollapsed: boolean;
  paletteQuery: string;
  favoritePalettes: string[];
  recentPalettes: string[];
}

const readPaletteNames = (key: string): string[] => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
  } catch {
    return [];
  }
};

const PALETTE_FAVORITES_KEY = "ditherer-palette-favorites";
const PALETTE_RECENTS_KEY = "ditherer-palette-recents";

const onDeleteColor = (
  e: React.KeyboardEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
  props: ColorArrayProps
) => {
  const colorIndex = parseInt(e.currentTarget.dataset.idx || "0", 10);
  props.onSetPaletteOption(
    "colors",
    props.value.filter(
      (_, idx) => idx !== colorIndex
    )
  );
};

type ModalState = null | {
  type: "extract" | "savePalette" | "importPalette";
  defaultValue?: string;
};

export default class ColorArray extends React.Component<ColorArrayProps, ColorArrayState> {
  state: ColorArrayState = {
    extractMode: LAB_ADAPT_AVERAGE,
    modal: null as ModalState,
    pickerOpen: false,
    pickerColor: { r: 255, g: 0, b: 0, a: 1 },
    extractCollapsed: true,
    paletteQuery: "",
    favoritePalettes: readPaletteNames(PALETTE_FAVORITES_KEY),
    recentPalettes: readPaletteNames(PALETTE_RECENTS_KEY)
  };

  selectTheme = (name: string) => {
    const colors = THEMES[name];
    if (!colors) return;
    const recentPalettes = [name, ...this.state.recentPalettes.filter((entry) => entry !== name)].slice(0, 8);
    localStorage.setItem(PALETTE_RECENTS_KEY, JSON.stringify(recentPalettes));
    this.setState({ recentPalettes });
    this.props.onSetPaletteOption("colors", colors);
  };

  toggleFavoriteTheme = (name: string) => {
    if (!THEMES[name]) return;
    const favoritePalettes = this.state.favoritePalettes.includes(name)
      ? this.state.favoritePalettes.filter((entry) => entry !== name)
      : [...this.state.favoritePalettes, name];
    localStorage.setItem(PALETTE_FAVORITES_KEY, JSON.stringify(favoritePalettes));
    this.setState({ favoritePalettes });
  };

  handleModalConfirm = (value: string) => {
    const { modal } = this.state;
    if (!modal) return;

    switch (modal.type) {
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
              const mode = modeMap[this.state.extractMode as Exclude<ExtractMode, typeof TOP>];
              colors = medianCutPalette(
                imageData,
                colorCountToDepth(count),
                true,
                mode.adaptMode,
                mode.colorMode
              ) as PaletteColor[];
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

    const currentThemeKey = findMatchingThemeKey(this.props.value);
    const currentTheme = currentThemeKey ? [currentThemeKey, THEMES[currentThemeKey]] as const : null;
    const customThemeName = "Custom";
    const currentThemeName = currentThemeKey || customThemeName;
    const currentThemeDescription = currentThemeKey ? getThemeDescription(currentThemeKey) : null;
    const paletteNeedle = this.state.paletteQuery.trim().toLowerCase();
    const matchesPaletteQuery = (name: string, desc = "") =>
      !paletteNeedle || `${name} ${desc}`.toLowerCase().includes(paletteNeedle);
    const namedOptions = (names: string[]) => names
      .filter((name) => THEMES[name] && matchesPaletteQuery(name, getThemeDescription(name) || ""))
      .map((name) => <option key={name} value={name}>{name}</option>);

    const themePicker = (
      <select
        className={s.enum}
        aria-label="Palette theme"
        value={currentThemeName}
        onChange={e => this.selectTheme(e.target.value)}
      >
        {this.state.favoritePalettes.length > 0 && (
          <optgroup label="Favorites">{namedOptions(this.state.favoritePalettes)}</optgroup>
        )}
        {this.state.recentPalettes.length > 0 && (
          <optgroup label="Recent">{namedOptions(this.state.recentPalettes)}</optgroup>
        )}
        {Object.entries(THEME_CATEGORIES).map(([cat, entries]) => (
          <optgroup key={cat} label={cat}>
            {entries
              .filter(e => THEMES[e.key] && matchesPaletteQuery(e.key, e.desc))
              .map(e => (
                <option key={e.key} value={e.key} title={e.desc}>
                  {e.key}
                </option>
              ))}
          </optgroup>
        ))}
        {/* User-saved palettes (prefixed with 🎨) not in categories */}
        {Object.keys(THEMES)
          .filter(k => k.startsWith("🎨") && matchesPaletteQuery(k))
          .map(k => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        <option key={customThemeName} value={customThemeName} disabled>
          Custom
        </option>
      </select>
    );

    const colorSwatch = (
      <div className={s.colorArray}>
        {this.props.value.map((c, colorIndex) => {
          const color = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

          return (
            <div
              key={`${c}-${colorIndex}`}
              className={s.color}
              data-idx={colorIndex}
              title={`${color} - click to remove`}
              aria-label={`Remove palette color ${colorIndex + 1}, ${color}`}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
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

    const colorPicker = (
      <div>
        <button
          onClick={() => this.setState({ pickerOpen: !this.state.pickerOpen })}
        >
          {this.state.pickerOpen ? "🖌 Close picker" : "🖌 Add color"}
        </button>
        {this.state.pickerOpen && (
          <div className={s.pickerContainer}>
            <RgbaColorPicker
              color={this.state.pickerColor}
              onChange={color => this.setState({ pickerColor: color })}
            />
            <div className={s.pickerPreview}>
              <div
                className={s.pickerSwatch}
                style={{
                  backgroundColor: `rgba(${this.state.pickerColor.r}, ${this.state.pickerColor.g}, ${this.state.pickerColor.b}, ${this.state.pickerColor.a})`
                }}
              />
              <button
                style={{ flex: 1 }}
                onClick={() => {
                  const c = this.state.pickerColor;
                  this.props.onAddPaletteColor(
                    rgba(c.r, c.g, c.b, Math.round(c.a * 255)) as PaletteColor
                  );
                }}
              >
                + Add to palette
              </button>
            </div>
          </div>
        )}
      </div>
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
            this.setState({ extractMode: String(value) as ExtractMode });
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
      extract: "Number of colors to extract",
      savePalette: "Save current palette as",
      importPalette: "Paste theme JSON"
    };

    return (
      <div>
        <div className={s.paletteSearchRow}>
          <input
            className={s.paletteSearch}
            type="search"
            value={this.state.paletteQuery}
            onChange={(event) => this.setState({ paletteQuery: event.target.value })}
            placeholder="Search palettes…"
            aria-label="Search palette themes"
          />
          <button
            className={s.paletteFavoriteButton}
            disabled={!currentThemeKey}
            aria-label={currentThemeKey && this.state.favoritePalettes.includes(currentThemeKey)
              ? `Remove ${currentThemeKey} from favorite palettes`
              : `Add ${currentThemeKey || "current palette"} to favorite palettes`}
            aria-pressed={Boolean(currentThemeKey && this.state.favoritePalettes.includes(currentThemeKey))}
            onClick={() => currentThemeKey && this.toggleFavoriteTheme(currentThemeKey)}
            title="Favorite this palette"
          >
            {currentThemeKey && this.state.favoritePalettes.includes(currentThemeKey) ? "★" : "☆"}
          </button>
        </div>
        <label className={s.themeSelectLabel}>
          <span className={s.label}>Theme</span>
          {themePicker}
        </label>
        {currentThemeName !== customThemeName && currentThemeDescription && (
          <div className={s.themeDesc}>{currentThemeDescription}</div>
        )}
        {colorSwatch}
        {colorPicker}
        <div className={s.group}>
          <button
            type="button"
            className={[s.name, s.groupDisclosure].join(" ")}
            aria-expanded={!this.state.extractCollapsed}
            onClick={() => this.setState({ extractCollapsed: !this.state.extractCollapsed })}
          >
            Extract from input {this.state.extractCollapsed ? "[+]" : "[-]"}
          </button>
          {!this.state.extractCollapsed && extractOptions}
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
