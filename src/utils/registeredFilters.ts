import { filterIndex, type FilterDefinition } from "@gyng/ditherer-filters";

const hasOwn = Object.prototype.hasOwnProperty;

export const resolveRegisteredFilter = (name: unknown): FilterDefinition | undefined =>
  typeof name === "string" && hasOwn.call(filterIndex, name) ? filterIndex[name] : undefined;
