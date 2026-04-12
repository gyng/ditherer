import nearest from "./nearest";
import user from "./user";
import type { PaletteDefinition, PaletteListEntry, SerializedPalette } from "./types";

export { default as nearest } from "./nearest";
export { default as user } from "./user";
export type { PaletteDefinition, PaletteListEntry, SerializedPalette } from "./types";

export const paletteList: PaletteListEntry[] = [
  { name: "Nearest", palette: nearest },
  { name: "User/Adaptive", palette: user }
];

// Serialize a palette for postMessage (strip functions)
export const serializePalette = (
  palette: PaletteDefinition,
): SerializedPalette => ({
  _serialized: true,
  name: palette.name,
  options: palette.options,
});

// Reconstruct a palette from serialized form (in worker context)
export const deserializePalette = (
  serialized: Partial<SerializedPalette> | null | undefined,
): PaletteDefinition => {
  const serializedName = typeof serialized?.name === "string" ? serialized.name : "";
  const serializedOptions =
    typeof serialized?.options === "object" && serialized.options != null
      ? serialized.options
      : {};
  const found = paletteList.find(p => p.palette.name === serializedName);
  const base = found ? found.palette : paletteList[0].palette;
  return { ...base, options: serializedOptions };
};
