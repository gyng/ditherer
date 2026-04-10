import { useState, useRef, useEffect, useCallback } from "react";
import { Command } from "cmdk";
import * as Popover from "@radix-ui/react-popover";
import { filterList } from "filters";
import s from "./FilterCombobox.module.css";

// Use the same type as filterList entries — consumers get the full object
type FilterEntry = (typeof filterList)[number];

const allFilters = filterList.filter((f) => f) as FilterEntry[];

const groupByCategory = (items: FilterEntry[]) => {
  const groups: { category: string; items: FilterEntry[] }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!seen.has(item.category)) {
      seen.add(item.category);
      groups.push({ category: item.category, items: [] });
    }
    groups.find((g) => g.category === item.category)!.items.push(item);
  }
  return groups;
};

const groups = groupByCategory(allFilters);

interface Props {
  onSelect: (entry: FilterEntry) => void;
  /** Optional preview-change callback fired when the value changes via arrow-key nav (does not close). Falls back to onSelect if absent. */
  onChange?: (entry: FilterEntry) => void;
  onClose?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  inline?: boolean;
  /** Display name of the currently-selected filter — used for highlighting + keyboard nav */
  currentValue?: string;
}

const FilterCombobox = ({
  onSelect,
  onChange,
  onClose,
  placeholder = "+ Add filter...",
  autoFocus = false,
  inline = false,
  currentValue,
}: Props) => {
  const [open, setOpen] = useState(autoFocus);
  // cmdk's controlled value: the currently-highlighted item
  const [value, setValue] = useState(currentValue ?? "");
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // When the popover opens, scroll the highlighted item into view exactly once.
  // We intentionally do NOT depend on `value` so cmdk's hover updates don't snap back.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const target = currentValue;
    if (!target) return;
    // Defer one frame so cmdk has rendered the list
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-value="${CSS.escape(target)}"]`);
      if (el && "scrollIntoView" in el) {
        (el as HTMLElement).scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    });
  }, [open]);

  const handleSelect = (displayName: string) => {
    const entry = allFilters.find((f) => f.displayName === displayName);
    if (entry) onSelect(entry);
    setValue(displayName);
    setOpen(false);
    if (onClose) onClose();
  };

  // Native-select-style arrow key nav while trigger is focused (popover closed)
  const handleTriggerKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    const isNext = e.key === "ArrowDown" || e.key === "ArrowRight";
    const isPrev = e.key === "ArrowUp" || e.key === "ArrowLeft";
    if (!isNext && !isPrev) return;
    e.preventDefault();
    const currentIdx = allFilters.findIndex((f) => f.displayName === (currentValue ?? value));
    let nextIdx: number;
    if (currentIdx < 0) {
      nextIdx = isNext ? 0 : allFilters.length - 1;
    } else {
      nextIdx = isNext
        ? Math.min(allFilters.length - 1, currentIdx + 1)
        : Math.max(0, currentIdx - 1);
    }
    const next = allFilters[nextIdx];
    if (next) {
      setValue(next.displayName);
      // Preview change without closing/committing. Fall back to onSelect if no onChange handler.
      (onChange ?? onSelect)(next);
      // Refocus the trigger after React re-renders so the user can keep arrow-keying
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  }, [open, currentValue, value, onChange, onSelect]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          className={`${s.trigger} ${inline ? s.inlineTrigger : ""}`}
          role="combobox"
          aria-expanded={open}
          tabIndex={0}
          onKeyDown={handleTriggerKeyDown}
        >
          {placeholder}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={s.content}
          align="start"
          sideOffset={2}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command className={s.command} value={value} onValueChange={setValue}>
            <Command.Input
              className={s.input}
              placeholder="Search filters..."
              autoFocus
            />
            <Command.List ref={listRef} className={s.list}>
              <Command.Empty className={s.empty}>No filters found.</Command.Empty>
              {groups.map((group) => (
                <Command.Group key={group.category} heading={group.category} className={s.group}>
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.displayName}
                      value={item.displayName}
                      onSelect={handleSelect}
                      className={s.item}
                      data-value={item.displayName}
                    >
                      {item.displayName}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default FilterCombobox;
