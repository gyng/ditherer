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
  THRESHOLD_MAP_PREVIEW,
} from "constants/controlTypes";

export type FilterOptionValues = Record<string, unknown>;

export type FilterCanvas = HTMLCanvasElement | OffscreenCanvas;

type BivariantCallback<TArgs extends unknown[], TResult> = {
  bivarianceHack(...args: TArgs): TResult;
}["bivarianceHack"];

export type FilterFunction<TOptions extends FilterOptionValues = FilterOptionValues> =
  BivariantCallback<
    [input: FilterCanvas, options?: TOptions, dispatch?: unknown],
    FilterCanvas | Promise<FilterCanvas>
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
  | typeof THRESHOLD_MAP_PREVIEW
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

export type ThresholdMapPreviewOptionDefinition<TOptions extends FilterOptionValues = FilterOptionValues> =
  BaseOptionDefinition<TOptions, never> & {
    sourceOption?: string;
    polarityOption?: string;
  };

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
  | ThresholdMapPreviewOptionDefinition<TOptions>
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
  // UI hint — the filter reacts to frame-to-frame state (phosphor decay,
  // after-image trails, VHS ghosting, …). Used by the library browser to
  // show a "temporal" badge and by the chain preview to animate the pill.
  temporal?: boolean;
  // When true, adding this filter to the chain also kicks off the animation
  // loop. Intended for filters whose "interesting" state is a transient burst
  // (CRT Degauss's decaying wobble, etc.) that a first-time user won't see
  // unless time advances.
  autoAnimate?: boolean;
  // Animation speed to use when `autoAnimate` is true. Defaults to 20 fps if
  // unspecified (matching the hand-coded Play/Stop ACTION handlers).
  autoAnimateFps?: number;
  // Declare when a backend fundamentally can't accelerate this filter so the
  // UI can communicate "don't ask us to optimise this further" and we don't
  // waste effort porting. The string is the short reason shown in the tooltip.
  // Example: error-diffusion has a serial pixel dependency → `noGL: "..."`.
  noGL?: string;
  noWASM?: string;
  // When true, this filter has no JS or WASM implementation — it only runs
  // via its GL renderer. On devices where WebGL2 isn't available the
  // dispatcher renders a "WebGL2 required" stub canvas instead of calling
  // the filter function. Library-browser rows for `requiresGL` filters are
  // disabled on unsupported hardware.
  requiresGL?: boolean;
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

// UI hint — "this filter reacts to frame-to-frame state" (temporal smoothing,
// motion trails, phosphor decay, …). Independent of dispatch routing; the
// library browser shows a "temp" badge and the chain-preview animates it.
export const hasTemporalBehavior = (entry: FilterListEntry): boolean =>
  entry.filter?.temporal === true;
