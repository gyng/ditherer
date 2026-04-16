import { useEffect, useState } from "react";
import { getFilterBackends, subscribeFilterBackends } from "utils";
import s from "./libraryBrowser.module.css";

type Props = {
  filterNames: string[];  // one or more display names to aggregate
};

// Poll `getFilterBackends` reactively: subscribe to new-backend events and
// re-read the map on change. The map only grows as filters run, so a
// useState snapshot is fine as long as we refresh when the set changes.
const useBackends = (filterNames: string[]): Set<string> => {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeFilterBackends(() => setTick(t => t + 1)), []);
  // tick is referenced so the effect triggers a re-read; ESLint would
  // otherwise consider `tick` unused.
  void tick;
  const all = getFilterBackends();
  const merged = new Set<string>();
  for (const name of filterNames) {
    const s2 = all.get(name);
    if (!s2) continue;
    for (const b of s2) merged.add(b);
  }
  return merged;
};

export const BackendTags = ({ filterNames }: Props) => {
  const backends = useBackends(filterNames);
  const hasGL = backends.has("WebGL2");
  const hasWasm = backends.has("WASM");
  if (!hasGL && !hasWasm) return null;
  return (
    <>
      {hasGL ? <span className={`${s.tag} ${s.tagGL}`} title="WebGL2 accelerated">GL</span> : null}
      {hasWasm ? <span className={`${s.tag} ${s.tagWasm}`} title="WASM accelerated">WASM</span> : null}
    </>
  );
};

export default BackendTags;
