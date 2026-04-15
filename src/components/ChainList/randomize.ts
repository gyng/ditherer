import type {
  EnumOption,
  EnumOptionDefinition,
  EnumOptionGroup,
  FilterDefinition,
  FilterListEntry,
  FilterOptionDefinition,
  FilterOptionDefinitions,
  FilterOptionValues,
  PaletteOptionDefinition,
  RangeOptionDefinition,
} from "filters/types";
import { ACTION, STRING, TEXT, COLOR_ARRAY, RANGE, BOOL, ENUM, PALETTE, COLOR } from "constants/controlTypes";
import { paletteList } from "palettes";
import * as palettes from "palettes";
import { THEMES } from "palettes/user";

const getThemeKeys = (): string[] =>
  Object.keys(THEMES).filter((k) => k !== "EMPTY" && Array.isArray(THEMES[k]) && THEMES[k].length > 0);

const getRandomPresetPalette = () => {
  const themeKeys = getThemeKeys();
  const themeKey = themeKeys[Math.floor(Math.random() * themeKeys.length)];
  return { ...palettes.user, options: { colors: THEMES[themeKey] } };
};

const isRangeOption = (option: FilterOptionDefinition): option is RangeOptionDefinition =>
  option.type === RANGE && Array.isArray((option as RangeOptionDefinition).range);

const isEnumOption = (option: FilterOptionDefinition): option is EnumOptionDefinition =>
  option.type === ENUM && Array.isArray((option as EnumOptionDefinition).options);

export const isPaletteOption = (option: FilterOptionDefinition): option is PaletteOptionDefinition =>
  option.type === PALETTE;

const isEnumOptionGroup = (option: EnumOption | EnumOptionGroup): option is EnumOptionGroup =>
  Array.isArray((option as EnumOptionGroup).options);

// Perturb a filter's options from its defaults
export const randomizeOptions = (base: FilterDefinition): FilterOptionValues => {
  const optionTypes: FilterOptionDefinitions = base.optionTypes || {};
  const defaults: FilterOptionValues = base.defaults || base.options || {};
  const options: FilterOptionValues = { ...defaults };

  for (const [key, oType] of Object.entries(optionTypes)) {
    if (key.startsWith("_")) continue;

    switch (oType.type) {
      case RANGE: {
        if (!isRangeOption(oType) || oType.range.length < 2) break;
        const [min, max] = oType.range;
        const step = oType.step || 1;
        const def = typeof defaults[key] === "number" ? defaults[key] : min;
        const spread = (max - min) * 0.5;
        const raw = def + (Math.random() - 0.5) * spread;
        const clamped = Math.max(min, Math.min(max, raw));
        options[key] = Math.round(clamped / step) * step;
        break;
      }
      case BOOL:
        options[key] = Math.random() < 0.3 ? !defaults[key] : defaults[key];
        break;
      case ENUM:
        if (isEnumOption(oType) && oType.options.length > 0 && Math.random() < 0.4) {
          const pick = oType.options[Math.floor(Math.random() * oType.options.length)];
          if (isEnumOptionGroup(pick)) break;
          options[key] = pick.value ?? pick;
        }
        break;
      case PALETTE: {
        // Weighted random: 40% nearest with varied levels, 30% user with theme, 30% nearest default
        const roll = Math.random();
        const defaultPalette = defaults[key] as { options?: FilterOptionValues } | undefined;
        const palOpts = { ...(defaultPalette?.options || {}) };

        if (roll < 0.4) {
          // Nearest with randomized levels
          if (typeof palOpts.levels === "number") {
            palOpts.levels = Math.max(2, Math.min(256,
              Math.round(palOpts.levels + (Math.random() - 0.5) * 128)
            ));
          }
          options[key] = { ...paletteList[0].palette, options: palOpts };
        } else if (roll < 0.7) {
          // User/Adaptive palette with a random preset theme
          options[key] = getRandomPresetPalette();
        } else {
          // Keep default palette as-is
        }
        break;
      }
      case COLOR: {
        const def = Array.isArray(defaults[key]) ? defaults[key] : [128, 128, 128];
        options[key] = def.map((c) =>
          Math.max(0, Math.min(255, Math.round(c + (Math.random() - 0.5) * 120)))
        );
        break;
      }
      case ACTION: case STRING: case TEXT: case COLOR_ARRAY:
        break;
    }
  }

  return options;
};

export const createRandomFilterEntry = (entry: FilterListEntry, forcePresetPalette = false) => {
  const base = entry.filter;
  const options = randomizeOptions(base);

  if (forcePresetPalette) {
    const paletteKey = Object.entries(base.optionTypes || {}).find(([, spec]) => isPaletteOption(spec))?.[0];
    if (paletteKey) {
      options[paletteKey] = getRandomPresetPalette();
    }
  }

  return { displayName: entry.displayName, filter: { ...base, options, defaults: options } };
};
