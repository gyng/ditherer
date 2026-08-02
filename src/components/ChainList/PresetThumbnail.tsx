import { useMemo } from "react";
import type { FilterDefinition } from "@gyng/ditherer-filters";
import type { ChainPreset } from "./presets";
import Thumbnail, { type ThumbChainStep } from "./Thumbnail";

type FilterEntry = { displayName: string; filter: FilterDefinition; category: string };

type Props = {
  preset: ChainPreset;
  filterByName: Map<string, FilterEntry>;
  source: HTMLImageElement | HTMLCanvasElement | null;
};

export const PresetThumbnail = ({ preset, filterByName, source }: Props) => {
  const chain = useMemo<ThumbChainStep[]>(
    () => preset.filters.map((f) => ({ name: f.name, options: f.options })),
    [preset],
  );
  return (
    <Thumbnail
      cacheKey={`preset:${preset.name}`}
      chain={chain}
      filterByName={filterByName}
      source={source}
    />
  );
};

export default PresetThumbnail;
