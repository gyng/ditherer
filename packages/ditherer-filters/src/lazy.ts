import type { FilterDefinition } from "./filters/types";
import { filterLoaders } from "./generated/filter-loaders";

export const lazyFilterNames = Object.freeze(Object.keys(filterLoaders));

export const loadFilter = async (name: string): Promise<FilterDefinition> => {
  const loader = filterLoaders[name as keyof typeof filterLoaders];
  if (!loader) throw new Error(`Unknown filter: ${name}`);
  return loader();
};
