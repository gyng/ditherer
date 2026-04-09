import { useState, useRef } from "react";
import { useFilter } from "context/FilterContext";
import { filterList, filterCategories } from "filters";
import { ACTION, STRING, TEXT, COLOR_ARRAY, RANGE, BOOL, ENUM, PALETTE, COLOR } from "constants/controlTypes";
import { paletteList } from "palettes";
import s from "./styles.module.css";
import controls from "components/controls/styles.module.css";

// Perturb a filter's options from its defaults
const randomizeOptions = (base: any) => {
  const optionTypes = base.optionTypes || {};
  const defaults = base.defaults || base.options || {};
  const options = { ...defaults };

  for (const [key, oType] of Object.entries(optionTypes)) {
    if (key.startsWith("_")) continue;
    const spec = oType as any;

    switch (spec.type) {
      case RANGE: {
        const [min, max] = spec.range;
        const step = spec.step || 1;
        const def = defaults[key] ?? min;
        const spread = (max - min) * 0.5;
        const raw = def + (Math.random() - 0.5) * spread;
        const clamped = Math.max(min, Math.min(max, raw));
        options[key] = Math.round(clamped / step) * step;
        break;
      }
      case BOOL:
        options[key] = Math.random() < 0.3 ? !defaults[key] : defaults[key];
        break;
      case ENUM:
        if (spec.options?.length > 0 && Math.random() < 0.4) {
          const pick = spec.options[Math.floor(Math.random() * spec.options.length)];
          options[key] = pick.value ?? pick;
        }
        break;
      case PALETTE: {
        const palettePick = paletteList[Math.floor(Math.random() * paletteList.length)];
        const palOpts = { ...(defaults[key]?.options || {}) };
        if (palOpts.levels != null) {
          palOpts.levels = Math.max(2, Math.min(256,
            Math.round(palOpts.levels + (Math.random() - 0.5) * 128)
          ));
        }
        options[key] = { ...palettePick.palette, options: palOpts };
        break;
      }
      case COLOR: {
        const def = defaults[key] || [128, 128, 128];
        options[key] = def.map((c: number) =>
          Math.max(0, Math.min(255, Math.round(c + (Math.random() - 0.5) * 120)))
        );
        break;
      }
      case ACTION: case STRING: case TEXT: case COLOR_ARRAY:
        break;
    }
  }

  return options;
};

const getRandomFilter = () => {
  const entry = filterList[Math.floor(Math.random() * filterList.length)];
  const base = entry.filter;
  const options = randomizeOptions(base);
  return { displayName: entry.displayName, filter: { ...base, options, defaults: options } };
};

// Chain presets: curated multi-filter combos
const CHAIN_PRESETS: { name: string; filters: string[] }[] = [
  { name: "Retro TV", filters: ["VHS emulation", "CRT emulation", "Vignette"] },
  { name: "Lo-fi Print", filters: ["Sepia", "Halftone", "Film grain"] },
  { name: "Glitch Art", filters: ["Pixelsort", "Chromatic aberration", "Scan line shift"] },
  { name: "Watercolor", filters: ["Gaussian blur", "Kuwahara", "Posterize edges"] },
  { name: "Noir", filters: ["Grayscale", "Sharpen", "Vignette", "Film grain"] },
  { name: "Neon", filters: ["Edge glow", "Bloom", "Chromatic aberration"] },
];

const ChainList = () => {
  const { state, actions } = useFilter();
  const { chain, activeIndex } = state;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const dragCounter = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIndex !== null && index !== dragIndex) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex) {
      actions.chainReorder(dragIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragCounter.current = 0;
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
    dragCounter.current = 0;
  };

  const addFilterByName = (name: string) => {
    const filter = filterList.find((f) => f && f.displayName === name);
    if (filter) actions.chainAdd(name, filter.filter);
  };

  const loadPreset = (preset: typeof CHAIN_PRESETS[0]) => {
    // Clear chain and add preset filters
    for (const name of preset.filters) {
      addFilterByName(name);
    }
  };

  // Filtered results for search
  const searchResults = searchQuery.length > 0
    ? filterList.filter(
        (f) => f && f.displayName.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 12)
    : [];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (e.altKey && activeIndex < chain.length - 1) {
          actions.chainReorder(activeIndex, activeIndex + 1);
        } else if (!e.altKey && activeIndex < chain.length - 1) {
          actions.chainSetActive(activeIndex + 1);
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (e.altKey && activeIndex > 0) {
          actions.chainReorder(activeIndex, activeIndex - 1);
        } else if (!e.altKey && activeIndex > 0) {
          actions.chainSetActive(activeIndex - 1);
        }
        break;
      case " ":
        e.preventDefault();
        if (chain[activeIndex]) actions.chainToggle(chain[activeIndex].id);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (chain.length > 1 && chain[activeIndex]) {
          actions.chainRemove(chain[activeIndex].id);
        }
        break;
    }
  };

  return (
    <div>
      <div
        className={s.chainList}
        role="listbox"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Filter chain"
      >
        {chain.map((entry, index) => {
          const isActive = index === activeIndex;
          const classes = [
            s.entry,
            isActive ? s.active : "",
            !entry.enabled ? s.disabled : "",
            dragIndex === index ? s.dragging : "",
            dragOverIndex === index ? s.dragOver : "",
          ].filter(Boolean).join(" ");

          const stepTime = state.stepTimes?.find(
            (st) => st.name === entry.displayName
          );

          return (
            <div
              key={entry.id}
              className={classes}
              draggable
              role="option"
              aria-selected={isActive}
              onClick={() => actions.chainSetActive(index)}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              <span className={s.dragHandle}>&#9776;</span>
              <input
                className={s.entryCheckbox}
                type="checkbox"
                checked={entry.enabled}
                onChange={(e) => {
                  e.stopPropagation();
                  actions.chainToggle(entry.id);
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <span className={s.entryNumber}>{index + 1}.</span>
              <select
                className={s.entrySelect}
                value={entry.displayName}
                onChange={(e) => {
                  e.stopPropagation();
                  const name = e.target.value;
                  const filter = filterList.find((f) => f && f.displayName === name);
                  if (filter) {
                    actions.chainReplace(entry.id, name, filter.filter);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {filterCategories.map((cat) => (
                  <optgroup key={cat} label={cat}>
                    {filterList
                      .filter((f) => f && f.category === cat)
                      .map((f) => (
                        <option key={f.displayName} value={f.displayName}>
                          {f.displayName}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              {stepTime && (
                <span className={s.entryTime}>
                  {stepTime.ms.toFixed(0)}ms
                </span>
              )}
              <button
                className={s.removeBtn}
                disabled={chain.length <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.chainRemove(entry.id);
                }}
                title="Remove"
              >
                x
              </button>
            </div>
          );
        })}
      </div>

      {/* Add filter row: search, browse dropdown, random, re-roll */}
      <div className={s.addRow}>
        {searchOpen ? (
          <div className={s.searchContainer}>
            <input
              ref={searchRef}
              className={s.searchInput}
              type="text"
              placeholder="Search filters..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  setSearchQuery("");
                } else if (e.key === "Enter" && searchResults.length > 0) {
                  addFilterByName(searchResults[0].displayName);
                  setSearchQuery("");
                  setSearchOpen(false);
                }
              }}
              autoFocus
            />
            {searchResults.length > 0 && (
              <div className={s.searchResults}>
                {searchResults.map((f) => (
                  <div
                    key={f.displayName}
                    className={s.searchResult}
                    onClick={() => {
                      addFilterByName(f.displayName);
                      setSearchQuery("");
                      setSearchOpen(false);
                    }}
                  >
                    <span className={s.searchResultName}>{f.displayName}</span>
                    <span className={s.searchResultCategory}>{f.category}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <select
            className={controls.enum}
            value=""
            onChange={(e) => {
              const name = e.target.value;
              if (!name) return;
              addFilterByName(name);
            }}
          >
            <option value="" disabled>
              + Add filter...
            </option>
            {filterCategories.map((cat) => (
              <optgroup key={cat} label={cat}>
                {filterList
                  .filter((f) => f && f.category === cat)
                  .map((f) => (
                    <option key={f.displayName} value={f.displayName}>
                      {f.displayName}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        )}
        <button
          className={s.addBtn}
          onClick={() => {
            setSearchOpen(!searchOpen);
            setSearchQuery("");
          }}
          title={searchOpen ? "Browse filters" : "Search filters"}
        >
          {searchOpen ? "=" : "/"}
        </button>
        <button
          className={s.addBtn}
          onClick={() => {
            const { displayName, filter } = getRandomFilter();
            actions.chainAdd(displayName, filter);
          }}
          title="Add a random filter with perturbed settings"
        >
          ?
        </button>
        <button
          className={s.addBtn}
          onClick={() => {
            const entry = chain[activeIndex];
            if (!entry) return;
            const base = entry.filter;
            const options = randomizeOptions(base);
            actions.chainReplace(entry.id, entry.displayName, { ...base, options });
          }}
          title="Re-roll options for the active filter"
        >
          ~
        </button>
      </div>

      {/* Chain presets */}
      <div className={s.addRow}>
        <select
          className={controls.enum}
          value=""
          onChange={(e) => {
            const name = e.target.value;
            if (!name) return;
            const preset = CHAIN_PRESETS.find((p) => p.name === name);
            if (preset) loadPreset(preset);
          }}
        >
          <option value="" disabled>
            Presets...
          </option>
          {CHAIN_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} ({p.filters.length})
            </option>
          ))}
        </select>
      </div>

      {/* Active filter description */}
      {(() => {
        const activeEntry = chain[activeIndex];
        if (!activeEntry) return null;
        const match = filterList.find(
          (f) => f && f.displayName === activeEntry.displayName
        );
        return match?.description ? (
          <div className={s.description}>{match.description}</div>
        ) : null;
      })()}
    </div>
  );
};

export default ChainList;
