import { useState, useRef, useCallback } from "react";
import { useFilter } from "context/useFilter";
import useDraggable from "components/App/useDraggable";
import { filterList, noop } from "filters";
import { ACTION, STRING, TEXT, COLOR_ARRAY, RANGE, BOOL, ENUM, PALETTE, COLOR } from "constants/controlTypes";
import { paletteList } from "palettes";
import * as palettes from "palettes";
import { THEMES } from "palettes/user";
import ChainPreview from "./ChainPreview";
import FilterCombobox from "components/FilterCombobox";
import ModalInput from "components/ModalInput";
import { CHAIN_PRESETS, PRESET_CATEGORIES, buildPresetSignatureMap, getChainSignature, type PresetFilterEntry } from "./presets";
import LibraryBrowser from "./LibraryBrowser";
import s from "./styles.module.css";

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
        // Weighted random: 40% nearest with varied levels, 30% user with theme, 30% nearest default
        const roll = Math.random();
        const palOpts = { ...(defaults[key]?.options || {}) };

        if (roll < 0.4) {
          // Nearest with randomized levels
          if (palOpts.levels != null) {
            palOpts.levels = Math.max(2, Math.min(256,
              Math.round(palOpts.levels + (Math.random() - 0.5) * 128)
            ));
          }
          options[key] = { ...paletteList[0].palette, options: palOpts };
        } else if (roll < 0.7) {
          // User/Adaptive palette with a random preset theme
          const themeKeys = Object.keys(THEMES).filter(k => k !== "EMPTY" && Array.isArray(THEMES[k]) && THEMES[k].length > 0);
          const themeKey = themeKeys[Math.floor(Math.random() * themeKeys.length)];
          options[key] = { ...palettes.user, options: { colors: THEMES[themeKey] } };
        } else {
          // Keep default palette as-is
        }
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

const USER_CHAIN_PREFIX = "_chain_";

interface SavedChain {
  name: string;
  desc: string;
  filters: string[];
  stateJson: string; // full serialized state with options
}

const loadUserChains = (): SavedChain[] => {
  const chains: SavedChain[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(USER_CHAIN_PREFIX)) {
      try {
        chains.push(JSON.parse(localStorage.getItem(key) || ""));
      } catch { /* ignore */ }
    }
  }
  return chains;
};

const ChainList = () => {
  const { state, actions } = useFilter();
  const { chain, activeIndex } = state;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ top: number; left: number } | null>(null);
  const [pinnedPreviews, setPinnedPreviews] = useState<Map<string, { top: number; left: number }>>(new Map());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showLibraryBrowser, setShowLibraryBrowser] = useState(false);
  const [libraryInitialTab, setLibraryInitialTab] = useState<"filters" | "presets">("filters");
  const [libraryInitialQuery, setLibraryInitialQuery] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [savedChains, setSavedChains] = useState<SavedChain[]>(loadUserChains);
  const [loadedSavedName, setLoadedSavedName] = useState<string | null>(null);
  const dragCounter = useRef(0);
  const libraryDragRef = useRef<HTMLDivElement | null>(null);
  const libraryDrag = useDraggable(libraryDragRef, { defaultPosition: { x: 560, y: 90 } });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveDefaults = useCallback((name: string) => {
    const match = filterList.find((filter) => filter.displayName === name);
    return (match?.filter.defaults || match?.filter.options || {}) as Record<string, unknown>;
  }, []);
  const presetBySignature = buildPresetSignatureMap(resolveDefaults);

  const handleMouseEnter = useCallback((entryId: string, e: React.MouseEvent) => {
    if (dragIndex !== null) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredEntryId(entryId);
      setHoverPos({ top: rect.top, left: rect.right + 8 });
    }, 150);
  }, [dragIndex]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoveredEntryId(null);
    setHoverPos(null);
  }, []);

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

  const resolvePresetFilter = (entry: PresetFilterEntry) => {
    const filter = filterList.find((f) => f && f.displayName === entry.name);
    if (!filter) return null;

    return {
      displayName: entry.name,
      filter: {
        ...filter.filter,
        options: {
          ...(filter.filter.defaults || filter.filter.options || {}),
          ...(entry.options || {}),
        },
      },
    };
  };

  const addFilterByName = (entry: PresetFilterEntry) => {
    const resolved = resolvePresetFilter(entry);
    if (resolved) actions.chainAdd(resolved.displayName, resolved.filter);
  };

  const randomChain = () => {
    // Pick 2-4 random filters, weighted toward interesting categories
    const candidates = filterList.filter((f) => f && f.category !== "Advanced");
    if (candidates.length === 0) return;
    const count = 2 + Math.floor(Math.random() * 3); // 2-4 filters
    const picked: typeof candidates = [];
    const usedCategories = new Set<string>();
    for (let i = 0; i < count; i++) {
      // Prefer filters from categories we haven't used yet
      const pool = candidates.filter((f) => !usedCategories.has(f.category) && !picked.includes(f));
      const source = pool.length > 0 ? pool : candidates.filter((f) => !picked.includes(f));
      if (source.length === 0) break;
      const pick = source[Math.floor(Math.random() * source.length)];
      picked.push(pick);
      usedCategories.add(pick.category);
    }
    if (picked.length === 0) return;
    actions.selectFilter(picked[0].displayName, picked[0].filter);
    for (let i = 1; i < picked.length; i++) {
      actions.chainAdd(picked[i].displayName, picked[i].filter);
    }
  };

  const loadPreset = (preset: typeof CHAIN_PRESETS[0]) => {
    // Set first filter via selectFilter (resets chain to 1 entry)
    const first = resolvePresetFilter(preset.filters[0]);
    if (!first) return;
    actions.selectFilter(first.displayName, first.filter);
    // Add remaining filters
    for (let i = 1; i < preset.filters.length; i++) {
      addFilterByName(preset.filters[i]);
    }
  };

  const openPresetBrowserForFilter = useCallback((filterDisplayName: string) => {
    setLibraryInitialTab("presets");
    setLibraryInitialQuery(filterDisplayName);
    setShowLibraryBrowser(true);
  }, []);

  const handleLibraryDialogMouseDown = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-no-drag='true']")) return;
    libraryDrag.onMouseDown(event);
  }, [libraryDrag]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't intercept keys when the user is typing in an input/textarea/contenteditable
    // (e.g. the filter typeahead) — let the field handle Backspace, arrows, space, etc.
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable
    ) {
      return;
    }
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
        } else if (chain[activeIndex]) {
          // Last entry: replace with noop instead of removing.
          actions.selectFilter("None", noop);
        }
        break;
    }
  };

  return (
    <div>
      {/* Chain toolbar */}
      <div className={s.addRow}>
        <button
          className={s.addBtn}
          onClick={() => {
            setLibraryInitialTab("filters");
            setLibraryInitialQuery("");
            setShowLibraryBrowser(true);
          }}
          title="Open full filter/preset browser"
        >
          Browse
        </button>
        <select
          className={s.presetSelect}
          value=""
          onChange={(e) => {
            const preset = CHAIN_PRESETS.find((p) => p.name === e.target.value);
            if (preset) { loadPreset(preset); setLoadedSavedName(null); }
          }}
          title="Load a preset"
        >
          <option value="" disabled>&#9733;</option>
          {PRESET_CATEGORIES.map((cat) => (
            <optgroup key={cat} label={cat}>
              {CHAIN_PRESETS
                .filter((p) => p.category === cat)
                .map((p) => (
                  <option key={p.name} value={p.name} title={p.desc}>{p.name}</option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          className={s.addBtn}
          onClick={randomChain}
          title="Random filter chain"
        >
          &#9861;
        </button>
        <button
          className={s.addBtn}
          onClick={() => {
            const url = actions.getExportUrl(state);
            setShareUrl(url);
            if (navigator.clipboard) {
              navigator.clipboard.writeText(url).catch(() => { /* fall through to modal */ });
            }
          }}
          title="Share filter chain (copies URL to clipboard)"
        >
          &#8679;
        </button>
        <button
          className={s.addBtn}
          onClick={() => setShowClearConfirm(true)}
          title="Clear filter chain"
        >
          &#10005;
        </button>
        <span style={{ flex: 1 }} />
        <button
          className={s.addBtn}
          onClick={() => {
            const name = prompt("Save chain as:");
            if (!name) return;
            const stateJson = actions.exportState(state);
            const filters = chain.map((e) => e.displayName);
            const data: SavedChain = { name, desc: filters.join(" \u2192 "), filters, stateJson };
            localStorage.setItem(USER_CHAIN_PREFIX + name, JSON.stringify(data));
            setSavedChains(loadUserChains());
            setLoadedSavedName(name);
          }}
          title="Save current chain with settings"
        >
          &#9660; Save
        </button>
        {savedChains.length > 0 && (
          <select
            className={s.presetSelect}
            value=""
            onChange={(e) => {
              const saved = savedChains.find((c) => c.name === e.target.value);
              if (saved) {
                actions.importState(saved.stateJson);
                setLoadedSavedName(saved.name);
              }
            }}
            title="Load a saved chain"
          >
            <option value="" disabled>&#9650; Load</option>
            {savedChains.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        )}
        {loadedSavedName && (
          <button
            className={s.addBtn}
            onClick={() => {
              localStorage.removeItem(USER_CHAIN_PREFIX + loadedSavedName);
              setSavedChains(loadUserChains());
              setLoadedSavedName(null);
            }}
            title={`Delete "${loadedSavedName}"`}
          >
            &#10005; Del
          </button>
        )}
      </div>

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
              onMouseEnter={(e) => handleMouseEnter(entry.id, e)}
              onMouseLeave={handleMouseLeave}
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
              {editingEntryId === entry.id ? (
                <FilterCombobox
                  inline
                  autoFocus
                  placeholder={entry.displayName}
                  currentValue={entry.displayName}
                  onChange={(f) => {
                    // Arrow-key preview: swap the filter in place but keep the editor open
                    actions.chainReplace(entry.id, f.displayName, f.filter);
                  }}
                  onSelect={(f) => {
                    actions.chainReplace(entry.id, f.displayName, f.filter);
                    setEditingEntryId(null);
                  }}
                  onClose={() => setEditingEntryId(null)}
                />
              ) : (
                <span
                  className={s.entryName}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingEntryId(entry.id);
                  }}
                  title="Click to search and replace filter"
                >
                  {entry.displayName}
                </span>
              )}
              {stepTime && (
                <span className={s.entryTime}>
                  {stepTime.ms.toFixed(0)}ms
                </span>
              )}
              {entry.filter?.optionTypes?.animate && (
                <button
                  className={`${s.removeBtn} ${actions.isAnimating() ? s.animActive : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    entry.filter.optionTypes.animate.action(
                      actions, state.inputCanvas, entry.filter.func, entry.filter.options
                    );
                  }}
                  title={actions.isAnimating() ? "Stop animation" : "Play animation"}
                >
                  {actions.isAnimating() ? "\u23F9" : "\u25B6"}
                </button>
              )}
              <button
                className={s.removeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  const match = filterList.find((f) => f && f.displayName === entry.displayName);
                  if (match) actions.chainReplace(entry.id, entry.displayName, match.filter);
                }}
                title="Reset to defaults"
              >
                &#8634;
              </button>
              <button
                className={s.removeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  const base = entry.filter;
                  const opts = randomizeOptions(base);
                  actions.chainReplace(entry.id, entry.displayName, { ...base, options: opts });
                }}
                title="Re-roll options"
              >
                ~
              </button>
              <button
                className={s.removeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  openPresetBrowserForFilter(entry.displayName);
                }}
                title="Open preset browser and search for presets using this filter"
              >
                &#9734;
              </button>
              <button
                className={s.removeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  // Removing the last entry would leave the chain empty, which
                  // breaks the rest of the UI; replace it with a noop instead
                  // so the user always has at least one (inert) entry.
                  if (chain.length <= 1) {
                    actions.selectFilter("None", noop);
                  } else {
                    actions.chainRemove(entry.id);
                  }
                }}
                title="Remove"
              >
                x
              </button>
              <button
                className={s.removeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.chainDuplicate(entry.id);
                }}
                title="Duplicate"
              >
                +
              </button>
              <button
                className={`${s.removeBtn} ${pinnedPreviews.has(entry.id) ? s.animActive : ""}`}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setHoveredEntryId(entry.id);
                  setHoverPos({ top: rect.top, left: rect.right + 8 });
                }}
                onMouseLeave={() => {
                  setHoveredEntryId(null);
                  setHoverPos(null);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = new Map(pinnedPreviews);
                  if (next.has(entry.id)) {
                    next.delete(entry.id);
                  } else {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    next.set(entry.id, { top: rect.top, left: rect.right + 8 });
                  }
                  setPinnedPreviews(next);
                }}
                title={pinnedPreviews.has(entry.id) ? "Unpin preview" : "Pin preview"}
              >
                &#9673;
              </button>
            </div>
          );
        })}
      </div>

      {/* Pinned previews */}
      {Array.from(pinnedPreviews.entries()).map(([id, pos]) => {
        const previewCanvas = actions.getIntermediatePreview(id);
        if (!previewCanvas) return null;
        const stepIndex = chain.findIndex((e) => e.id === id);
        return (
          <ChainPreview
            key={id}
            sourceCanvas={previewCanvas}
            top={pos.top}
            left={pos.left}
            stepNumber={stepIndex + 1}
            pinned
          />
        );
      })}
      {/* Hover preview (only if not already pinned) */}
      {hoveredEntryId && hoverPos && !pinnedPreviews.has(hoveredEntryId) && (() => {
        const previewCanvas = actions.getIntermediatePreview(hoveredEntryId);
        if (!previewCanvas) return null;
        const stepIndex = chain.findIndex((e) => e.id === hoveredEntryId);
        return (
          <ChainPreview
            sourceCanvas={previewCanvas}
            top={hoverPos.top}
            left={hoverPos.left}
            stepNumber={stepIndex + 1}
          />
        );
      })()}

      {/* Add filter row */}
      <div className={s.addRow}>
        <FilterCombobox
          placeholder="+ Add filter..."
          onSelect={(f) => actions.chainAdd(f.displayName, f.filter)}
        />
        <button
          className={s.addBtn}
          onClick={() => {
            setLibraryInitialTab("filters");
            setLibraryInitialQuery("");
            setShowLibraryBrowser(true);
          }}
          title="Open full filter/preset browser"
        >
          Browse
        </button>
        <button
          className={s.addBtn}
          onClick={() => {
            const { displayName, filter } = getRandomFilter();
            actions.chainAdd(displayName, { ...filter, options: filter.options || filter.defaults });
          }}
          title="Add a random filter"
        >
          ?
        </button>
      </div>

      {/* Active filter / preset description */}
      {(() => {
        const activeEntry = chain[activeIndex];
        if (!activeEntry) return null;
        const matchedPreset = presetBySignature.get(getChainSignature(chain, resolveDefaults));
        if (matchedPreset) {
          return <div className={s.description}>{matchedPreset.desc}</div>;
        }
        // Show saved chain name if loaded
        if (loadedSavedName) {
          const saved = savedChains.find((c) => c.name === loadedSavedName);
          if (saved) return <div className={s.description}>{saved.name}: {saved.desc}</div>;
        }
        const match = filterList.find(
          (f) => f && f.displayName === activeEntry.displayName
        );
        return match?.description ? (
          <div className={s.description}>{match.description}</div>
        ) : null;
      })()}

      {showClearConfirm && (
        <div className={s.confirmOverlay} onClick={() => setShowClearConfirm(false)}>
          <div className={s.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <div className={s.confirmTitleBar}>
              <span className={s.confirmTitleText}>ditherer.exe</span>
              <button
                className={s.confirmTitleClose}
                onClick={() => setShowClearConfirm(false)}
              >
                &#10005;
              </button>
            </div>
            <div className={s.confirmBody}>
              <div className={s.confirmIcon}>&#9888;</div>
              <div className={s.confirmMessage}>
                Clear the filter chain?<br />
                <span className={s.confirmSub}>This action cannot be undone.</span>
              </div>
            </div>
            <div className={s.confirmButtons}>
              <button
                className={s.confirmBtn}
                autoFocus
                onClick={() => {
                  setShowClearConfirm(false);
                  // Reset to a single noop entry so the user has a clean
                  // baseline to build a new chain from.
                  actions.selectFilter("None", noop);
                }}
              >
                OK
              </button>
              <button
                className={s.confirmBtn}
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showLibraryBrowser && (
        <div
          ref={libraryDragRef}
          role="presentation"
          className={s.libraryBrowserFloat}
        >
          <LibraryBrowser
            open={showLibraryBrowser}
            onClose={() => setShowLibraryBrowser(false)}
            onAddFilter={(entry) => actions.chainAdd(entry.displayName, entry.filter)}
            onLoadPreset={(preset) => {
              loadPreset(preset);
              setLoadedSavedName(null);
            }}
            initialTab={libraryInitialTab}
            initialQuery={libraryInitialQuery}
            onDialogMouseDown={handleLibraryDialogMouseDown}
            previewSource={state.inputImage}
            previewVideo={state.video}
          />
        </div>
      )}

      {shareUrl !== null && (
        <ModalInput
          title="Share URL (copied to clipboard)"
          defaultValue={shareUrl}
          onConfirm={() => setShareUrl(null)}
          onCancel={() => setShareUrl(null)}
        />
      )}
    </div>
  );
};

export default ChainList;
