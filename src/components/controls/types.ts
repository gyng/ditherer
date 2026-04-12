import type { FilterOptionDefinition, FilterOptionDefinitions, FilterOptionValues } from "filters/types";

export type ControlSetter = (optionName: string, value: unknown, chainIndex?: number) => void;
export type PaletteColorSaver = (name: string, colors: number[][]) => void;
export type PaletteColorDeleter = (name: string) => void;

interface ControlMeta {
  label?: string;
  desc?: string;
}

export interface ControlProps<TDefinition = FilterOptionDefinition, TValue = unknown> {
  name: string;
  types: TDefinition;
  value: TValue;
  hideLabel?: boolean;
  onSetFilterOption: ControlSetter;
}

export type BoolControlProps = ControlProps<ControlMeta, boolean>;
export type EnumControlProps = ControlProps<
  ControlMeta & {
    options: Array<{ name?: string; value: string | number } | { label: string; options: Array<{ name?: string; value: string | number }> }>;
  },
  string | number
>;
export type RangeControlProps = ControlProps<ControlMeta & { range: number[] }, number> & {
  step?: number;
};
export type StringControlProps = ControlProps<ControlMeta, string>;
export type TextControlProps = ControlProps<ControlMeta, string>;
export type ColorControlProps = {
  name: string;
  value: string | number[];
  onSetFilterOption: ControlSetter;
};

export interface NestedControlsProps {
  optionTypes?: FilterOptionDefinitions;
  options?: FilterOptionValues;
  inputCanvas?: HTMLCanvasElement | null;
  onSetFilterOption?: ControlSetter;
  onSetPaletteOption?: ControlSetter;
  onAddPaletteColor?: (color: number[]) => void;
  onSaveColorPalette?: PaletteColorSaver;
  onDeleteColorPalette?: PaletteColorDeleter;
}

export interface PaletteValue extends FilterOptionValues {
  name: string;
  optionTypes?: FilterOptionDefinitions;
  options?: FilterOptionValues;
}

export interface PaletteControlProps extends ControlProps<ControlMeta, PaletteValue> {
  paletteOptions?: FilterOptionValues;
  inputCanvas?: HTMLCanvasElement | null;
  onSetPaletteOption: ControlSetter;
  onAddPaletteColor: (color: number[]) => void;
  onSaveColorPalette: PaletteColorSaver;
  onDeleteColorPalette: PaletteColorDeleter;
}
