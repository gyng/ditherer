import { useState, useRef } from "react";
import { useFilter } from "context/FilterContext";
import { filterList, filterCategories } from "filters";
import s from "./styles.module.css";
import controls from "components/controls/styles.module.css";

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
