import { useState, useRef } from "react";
import { useFilter } from "context/FilterContext";
import { filterList, filterCategories } from "filters";
import { ACTION, STRING, TEXT, COLOR_ARRAY, RANGE, BOOL, ENUM, PALETTE, COLOR } from "constants/controlTypes";
import { paletteList } from "palettes";
import s from "./styles.module.css";
import controls from "components/controls/styles.module.css";

// Perturb a filter's defaults to create interesting random variations
const getRandomFilter = () => {
  const entry = filterList[Math.floor(Math.random() * filterList.length)];
  const base = entry.filter;
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
        // Perturb: offset within ~50% of range, centered on default
        const spread = (max - min) * 0.5;
        const raw = def + (Math.random() - 0.5) * spread;
        const clamped = Math.max(min, Math.min(max, raw));
        options[key] = Math.round(clamped / step) * step;
        break;
      }
      case BOOL:
        options[key] = Math.random() < 0.3 ? !defaults[key] : defaults[key];
        break;
      case ENUM: {
        if (spec.options && spec.options.length > 0) {
          if (Math.random() < 0.4) {
            const pick = spec.options[Math.floor(Math.random() * spec.options.length)];
            options[key] = pick.value ?? pick;
          }
        }
        break;
      }
      case PALETTE: {
        // Keep palette type but perturb sub-options like levels
        const palettePick = paletteList[Math.floor(Math.random() * paletteList.length)];
        const palDefaults = defaults[key]?.options || {};
        const palOpts = { ...palDefaults };
        if (palOpts.levels != null) {
          const spread = 128;
          palOpts.levels = Math.max(2, Math.min(256,
            Math.round(palOpts.levels + (Math.random() - 0.5) * spread)
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
      case ACTION:
      case STRING:
      case TEXT:
      case COLOR_ARRAY:
        // Skip — keep defaults
        break;
    }
  }

  const filter = { ...base, options, defaults: options };
  return { displayName: entry.displayName, filter };
};

const ChainList = () => {
  const { state, actions } = useFilter();
  const { chain, activeIndex } = state;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

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

  return (
    <div>
      <div className={s.chainList}>
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
      <div className={s.addRow}>
        <select
          className={controls.enum}
          value=""
          onChange={(e) => {
            const name = e.target.value;
            if (!name) return;
            const filter = filterList.find((f) => f && f.displayName === name);
            if (filter) {
              actions.chainAdd(name, filter.filter);
            }
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
      </div>
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
