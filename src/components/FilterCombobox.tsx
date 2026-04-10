import { useState } from "react";
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
  onClose?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  inline?: boolean;
}

const FilterCombobox = ({ onSelect, onClose, placeholder = "+ Add filter...", autoFocus = false, inline = false }: Props) => {
  const [open, setOpen] = useState(autoFocus);

  const handleSelect = (displayName: string) => {
    const entry = allFilters.find((f) => f.displayName === displayName);
    if (entry) onSelect(entry);
    setOpen(false);
    if (onClose) onClose();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={`${s.trigger} ${inline ? s.inlineTrigger : ""}`}
          role="combobox"
          aria-expanded={open}
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
          <Command className={s.command}>
            <Command.Input
              className={s.input}
              placeholder="Search filters..."
              autoFocus
            />
            <Command.List className={s.list}>
              <Command.Empty className={s.empty}>No filters found.</Command.Empty>
              {groups.map((group) => (
                <Command.Group key={group.category} heading={group.category} className={s.group}>
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.displayName}
                      value={item.displayName}
                      onSelect={handleSelect}
                      className={s.item}
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
