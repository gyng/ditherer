import nearest from "./nearest";
import user from "./user";

export { default as nearest } from "./nearest";
export { default as user } from "./user";

export const paletteList = [
  { name: "Nearest", palette: nearest },
  { name: "User/Adaptive", palette: user }
];

// Serialize a palette for postMessage (strip functions)
export const serializePalette = (palette) => ({
  _serialized: true,
  name: palette.name,
  options: palette.options,
});

// Reconstruct a palette from serialized form (in worker context)
export const deserializePalette = (serialized) => {
  const found = paletteList.find(p => p.palette.name === serialized.name);
  const base = found ? found.palette : paletteList[0].palette;
  return { ...base, options: serialized.options };
};
