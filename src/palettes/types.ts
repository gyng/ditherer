export type PaletteColor = [number, number, number, number];

export type PaletteOptions = Record<string, unknown>;

export interface PaletteDefinition<TOptions extends PaletteOptions = PaletteOptions> {
  [key: string]: unknown;
  name: string;
  getColor: (color: number[], options?: TOptions) => number[];
  options: TOptions;
  defaults?: TOptions;
  optionTypes?: Record<string, unknown>;
}

export interface SerializedPalette<TOptions extends PaletteOptions = PaletteOptions> {
  [key: string]: unknown;
  _serialized: true;
  name: string;
  options: TOptions;
}

export interface PaletteListEntry<TOptions extends PaletteOptions = PaletteOptions> {
  name: string;
  palette: PaletteDefinition<TOptions>;
}
