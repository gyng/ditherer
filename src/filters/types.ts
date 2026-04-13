import type {
  ACTION,
  BOOL,
  COLOR,
  COLOR_ARRAY,
  CURVE,
  ENUM,
  PALETTE,
  RANGE,
  STRING,
  TEXT,
} from "constants/controlTypes";

export type FilterOptionValues = Record<string, unknown>;

export type FilterCanvas = HTMLCanvasElement | OffscreenCanvas;

type BivariantCallback<TArgs extends unknown[], TResult> = {
  bivarianceHack(...args: TArgs): TResult;
}["bivarianceHack"];

export type FilterFunction<TOptions extends FilterOptionValues = FilterOptionValues> =
  BivariantCallback<
    [input: FilterCanvas, options?: TOptions, dispatch?: unknown],
    FilterCanvas
  >;

type FilterControlType =
  | typeof ACTION
  | typeof BOOL
  | typeof COLOR
  | typeof COLOR_ARRAY
  | typeof CURVE
  | typeof ENUM
  | typeof PALETTE
  | typeof RANGE
  | typeof STRING
  | typeof TEXT
  | string;

export type EnumOptionValue = string | number;

export interface EnumOption {
  name?: string;
  value: EnumOptionValue;
}

export interface EnumOptionGroup {
  label: string;
  options: EnumOption[];
}

interface BaseOptionDefinition<
  TOptions extends FilterOptionValues = FilterOptionValues,
  TDefault = unknown,
> {
  type: FilterControlType;
  default?: TDefault;
  label?: string;
  desc?: string;
  visibleWhen?: BivariantCallback<[options: TOptions], boolean>;
}

export interface RangeOptionDefinition<
  TOptions extends FilterOptionValues = FilterOptionValues,
> extends BaseOptionDefinition<TOptions, number> {
  range: number[];
  step?: number;
}

export type BoolOptionDefinition<TOptions extends FilterOptionValues = FilterOptionValues> =
  BaseOptionDefinition<TOptions, boolean>;

export type StringOptionDefinition<TOptions extends FilterOptionValues = FilterOptionValues> =
  BaseOptionDefinition<TOptions, string>;

export type TextOptionDefinition<TOptions extends FilterOptionValues = FilterOptionValues> =
  BaseOptionDefinition<TOptions, string>;

export type ColorOptionDefinition<TOptions extends FilterOptionValues = FilterOptionValues> =
  BaseOptionDefinition<TOptions, string>;

export type ColorArrayOptionDefinition<TOptions extends FilterOptionValues = FilterOptionValues> =
  BaseOptionDefinition<TOptions, string[]>;

export type CurveOptionDefinition<TOptions extends FilterOptionValues = FilterOptionValues> =
  BaseOptionDefinition<TOptions, unknown>;

export type PaletteOptionDefinition<TOptions extends FilterOptionValues = FilterOptionValues> =
  BaseOptionDefinition<TOptions, Record<string, unknown>>;

export interface EnumOptionDefinition<
  TOptions extends FilterOptionValues = FilterOptionValues,
> extends BaseOptionDefinition<TOptions, EnumOptionValue> {
  options: Array<EnumOption | EnumOptionGroup>;
}

export interface ActionOptionDefinition<
  TOptions extends FilterOptionValues = FilterOptionValues,
> extends BaseOptionDefinition<TOptions, never> {
  action: BivariantCallback<
    [
      actions: unknown,
      inputCanvas: FilterCanvas | null,
      filterFunc?: FilterFunction<TOptions>,
      options?: TOptions,
    ],
    void
  >;
}

export type FilterOptionDefinition<TOptions extends FilterOptionValues = FilterOptionValues> =
  | ActionOptionDefinition<TOptions>
  | BoolOptionDefinition<TOptions>
  | ColorArrayOptionDefinition<TOptions>
  | ColorOptionDefinition<TOptions>
  | CurveOptionDefinition<TOptions>
  | EnumOptionDefinition<TOptions>
  | PaletteOptionDefinition<TOptions>
  | RangeOptionDefinition<TOptions>
  | StringOptionDefinition<TOptions>
  | TextOptionDefinition<TOptions>;

export type FilterOptionDefinitions<TOptions extends FilterOptionValues = FilterOptionValues> =
  Record<string, FilterOptionDefinition<TOptions>>;

export interface FilterDefinition<TOptions extends FilterOptionValues = FilterOptionValues> {
  name: string;
  func: FilterFunction<TOptions>;
  optionTypes?: FilterOptionDefinitions<TOptions>;
  options?: TOptions;
  defaults?: TOptions;
  description?: string;
  mainThread?: boolean;
}

export interface FilterListEntry<TOptions extends FilterOptionValues = FilterOptionValues> {
  displayName: string;
  filter: FilterDefinition<TOptions>;
  category: string;
  description: string;
}

export function defineFilter<
  const TDefaults extends FilterOptionValues,
  TDefinitions extends FilterOptionDefinitions<TDefaults>,
>(
  filter: Omit<FilterDefinition<TDefaults>, "optionTypes" | "options" | "defaults"> & {
    optionTypes: TDefinitions;
    defaults: TDefaults;
    options?: TDefaults;
  },
): FilterDefinition<TDefaults>;
export function defineFilter<TOptions extends FilterOptionValues>(
  filter: FilterDefinition<TOptions>,
): FilterDefinition<TOptions>;
export function defineFilter<TOptions extends FilterOptionValues>(
  filter: FilterDefinition<TOptions>,
): FilterDefinition<TOptions> {
  return filter;
}

export const isMainThreadFilter = (
  filter: Pick<FilterDefinition, "mainThread"> | null | undefined,
): boolean => filter?.mainThread === true;

export const hasTemporalBehavior = (entry: FilterListEntry): boolean =>
  isMainThreadFilter(entry.filter);
