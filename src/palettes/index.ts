import nearest from "./nearest";
import user from "./user";

export { default as nearest } from "./nearest";
export { default as user } from "./user";

export const paletteList = [
  { name: "Nearest", palette: nearest },
  { name: "User/Adaptive", palette: user },
];
