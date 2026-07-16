import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Command } from "cmdk";
import * as Popover from "@radix-ui/react-popover";
import { filterList } from "@gyng/ditherer-filters";
import {
  buildFilterSearchIndex,
  normalizeFilterSearchText,
  searchFilterIndex,
} from "./filterSearch";
import s from "./FilterCombobox.module.css";

type FilterEntry = (typeof filterList)[number];
type SearchableFilter = FilterEntry & { keywords: string };

const RECENTS_KEY = "ditherer-filter-recents";
const MAX_RESULTS = 48;
const MAX_QUICK_ACCESS = 12;

const getSearchKeywords = (entry: FilterEntry) => {
  const optionKeywords = Object.entries(entry.filter.optionTypes || {}).flatMap(([name, option]) => [
    name,
    option.label || "",
  ]);
  return [
    ...optionKeywords,
    entry.filter.temporal ? "temporal motion history time" : "",
    entry.filter.autoAnimate || entry.filter.optionTypes?.animate ? "animated animation moving" : "",
    entry.filter.requiresGL ? "gpu gl webgl shader" : "",
    entry.filter.noGL ? "cpu sequential" : "",
    entry.filter.noWASM ? "canvas" : "wasm",
  ].join(" ");
};

const allFilters = filterList
  .filter((entry): entry is FilterEntry => Boolean(entry))
  .map((entry): SearchableFilter => ({ ...entry, keywords: getSearchKeywords(entry) }));

const filterByName = new Map(allFilters.map((entry) => [entry.displayName, entry] as const));
const searchIndex = buildFilterSearchIndex(allFilters);
const exploreFilters = (() => {
  const categories = new Set<string>();
  return allFilters.filter((entry) => {
    if (entry.displayName === "None") return false;
    if (categories.has(entry.category)) return false;
    categories.add(entry.category);
    return true;
  }).slice(0, MAX_QUICK_ACCESS);
})();

const readRecentNames = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]") as unknown;
    return Array.isArray(stored)
      ? stored.filter((name): name is string => typeof name === "string").slice(0, MAX_QUICK_ACCESS)
      : [];
  } catch {
    return [];
  }
};

const rememberRecentName = (displayName: string, current: string[]) => {
  const next = [displayName, ...current.filter((name) => name !== displayName)].slice(0, MAX_QUICK_ACCESS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
  return next;
};

const uniqueEntries = (entries: Array<SearchableFilter | undefined>) => {
  const seen = new Set<string>();
  return entries.filter((entry): entry is SearchableFilter => {
    if (!entry || seen.has(entry.displayName)) return false;
    seen.add(entry.displayName);
    return true;
  });
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlightMatch = (text: string, query: string): ReactNode => {
  const terms = normalizeFilterSearchText(query).split(" ").filter((term) => term.length >= 2);
  if (terms.length === 0) return text;
  const matcher = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  return text.split(matcher).map((part, index) =>
    terms.some((term) => part.toLocaleLowerCase() === term)
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : part
  );
};

const getBadges = (entry: SearchableFilter) => [
  entry.filter.requiresGL ? "GL" : null,
  entry.filter.temporal ? "TEMP" : null,
  entry.filter.autoAnimate || entry.filter.optionTypes?.animate ? "ANIM" : null,
].filter((badge): badge is string => Boolean(badge));

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
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(currentValue ?? "");
  const [recentNames, setRecentNames] = useState(readRecentNames);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const normalizedQuery = normalizeFilterSearchText(query);

  const searchResult = useMemo(
    () => searchFilterIndex(searchIndex, query, MAX_RESULTS),
    [query],
  );

  const quickAccessEntries = useMemo(() => uniqueEntries([
    currentValue ? filterByName.get(currentValue) : undefined,
    ...recentNames.map((name) => filterByName.get(name)),
    ...exploreFilters,
  ]).slice(0, MAX_QUICK_ACCESS), [currentValue, recentNames]);

  const resultEntries = normalizedQuery ? searchResult.items : quickAccessEntries;
  const hasRecentEntries = recentNames.some((name) => filterByName.has(name));

  useEffect(() => {
    if (!open || !listRef.current || !currentValue || query) return;
    requestAnimationFrame(() => {
      const element = listRef.current?.querySelector(`[data-value="${CSS.escape(currentValue)}"]`);
      if (element && "scrollIntoView" in element) {
        (element as HTMLElement).scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    });
  }, [currentValue, open, query]);

  useEffect(() => {
    if (!open) {
      if (currentValue) setValue(currentValue);
      return;
    }
    const firstResult = resultEntries[0];
    if (firstResult && !resultEntries.some((entry) => entry.displayName === value)) {
      setValue(firstResult.displayName);
    }
  }, [currentValue, open, resultEntries, value]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    onClose?.();
  }, [onClose]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setRecentNames(readRecentNames());
      setQuery("");
      setOpen(true);
      return;
    }
    close();
  };

  const handleSelect = (displayName: string) => {
    const entry = filterByName.get(displayName);
    if (entry) {
      setRecentNames((current) => rememberRecentName(displayName, current));
      onSelect(entry);
      setValue(displayName);
    }
    close();
  };

  const handleTriggerKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    const isNext = event.key === "ArrowDown" || event.key === "ArrowRight";
    const isPrevious = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!isNext && !isPrevious) return;
    event.preventDefault();
    const currentIndex = allFilters.findIndex((entry) => entry.displayName === (currentValue ?? value));
    const nextIndex = currentIndex < 0
      ? (isNext ? 0 : allFilters.length - 1)
      : isNext
        ? Math.min(allFilters.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
    const next = allFilters[nextIndex];
    if (!next) return;
    setValue(next.displayName);
    (onChange ?? onSelect)(next);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [currentValue, onChange, onSelect, open, value]);

  const resultStatus = normalizedQuery
    ? searchResult.total === 0
      ? "No matches"
      : searchResult.total > resultEntries.length
        ? `${resultEntries.length} of ${searchResult.total} matches`
        : `${searchResult.total} ${searchResult.total === 1 ? "match" : "matches"}`
    : hasRecentEntries
      ? `${resultEntries.length} recent and suggested`
      : `${resultEntries.length} filters to explore`;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          className={`${s.trigger} ${inline ? s.inlineTrigger : ""}`}
          role="combobox"
          aria-label={currentValue ? `Replace ${currentValue} filter` : placeholder}
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
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
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          data-testid="filter-typeahead"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <Command
            className={s.command}
            value={value}
            onValueChange={setValue}
            shouldFilter={false}
            loop
          >
            <div className={s.searchShell}>
              <span className={s.searchGlyph} aria-hidden="true">Find</span>
              <Command.Input
                ref={inputRef}
                className={s.input}
                value={query}
                onValueChange={setQuery}
                placeholder="Search name, category, effect…"
                aria-label="Search filters"
                autoFocus
              />
              {query ? (
                <button
                  type="button"
                  className={s.clearButton}
                  aria-label="Clear filter search"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className={s.statusBar} aria-live="polite">
              <span className={s.statusLamp} />
              <span>{resultStatus}</span>
              <span className={s.registryCount}>{allFilters.length} total</span>
            </div>
            <Command.List id={listId} ref={listRef} className={s.list}>
              <Command.Empty className={s.empty}>
                <strong>No matching filters</strong>
                <span>Try a look, medium, or technique: “glitch”, “film”, “ray tracing”.</span>
              </Command.Empty>
              {resultEntries.length > 0 ? (
                <Command.Group
                  heading={normalizedQuery ? "Best matches" : hasRecentEntries ? "Recent + explore" : "Explore filters"}
                  className={s.group}
                >
                  {resultEntries.map((item) => {
                    const badges = getBadges(item);
                    return (
                      <Command.Item
                        key={item.displayName}
                        value={item.displayName}
                        onSelect={handleSelect}
                        className={s.item}
                        data-value={item.displayName}
                        data-testid="filter-typeahead-item"
                      >
                        <span className={s.itemHeader}>
                          <strong className={s.itemName}>{highlightMatch(item.displayName, query)}</strong>
                          <span className={s.itemCategory}>{item.category}</span>
                        </span>
                        <span className={s.itemBody}>
                          <span className={s.itemDescription}>{highlightMatch(item.description || "No description", query)}</span>
                          {badges.length > 0 ? (
                            <span className={s.badges} aria-label={`Capabilities: ${badges.join(", ")}`}>
                              {badges.map((badge) => (
                                <span
                                  key={badge}
                                  className={`${s.badge} ${
                                    badge === "ANIM"
                                      ? s.badgeAnim
                                      : badge === "TEMP"
                                        ? s.badgeTemp
                                        : s.badgeGL
                                  }`}
                                >
                                  {badge}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ) : null}
            </Command.List>
            <div className={s.footer} aria-hidden="true">
              <span><kbd>↑↓</kbd> move</span>
              <span><kbd>Enter</kbd> choose</span>
              <span><kbd>Esc</kbd> close</span>
            </div>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default FilterCombobox;
