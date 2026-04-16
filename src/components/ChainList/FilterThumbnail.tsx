import { useMemo } from "react";
import type { FilterDefinition } from "filters/types";
import Thumbnail, { type ThumbChainStep } from "./Thumbnail";

type FilterEntry = { displayName: string; filter: FilterDefinition; category: string };

type Props = {
  filter: FilterEntry;
  filterByName: Map<string, FilterEntry>;
  source: HTMLImageElement | HTMLCanvasElement | null;
};

export const FilterThumbnail = ({ filter, filterByName, source }: Props) => {
  const chain = useMemo<ThumbChainStep[]>(
    () => [{ name: filter.displayName }],
    [filter.displayName],
  );
  return (
    <Thumbnail
      cacheKey={`filter:${filter.displayName}`}
      chain={chain}
      filterByName={filterByName}
      source={source}
    />
  );
};

export default FilterThumbnail;
