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
import FilterThumbnail from "./ChainList/FilterThumbnail";
import s from "./FilterCombobox.module.css";

const PREVIEW_SOURCE_SRC = `${import.meta.env.BASE_URL}test-assets/image/pepper.png`;

type FilterEntry = (typeof filterList)[number];
type SearchableFilter = FilterEntry & { keywords: string };

const RECENTS_KEY = "ditherer-filter-recents";
const MAX_RESULTS = 48;
const MAX_RECENTS = 6;

const CATEGORY_INTENTS: Record<string, string> = {
  Advanced: "procedural generative technical three dimensional 3d",
  "Blur & Edges": "soft focus sharpen detail outline smooth",
  Color: "palette grade tone hue saturation recolor",
  Distort: "warp bend stretch geometry transform",
  Dithering: "pixel art retro palette quantize limited color",
  Glitch: "broken corrupt noise digital error damage",
  Simulate: "emulate emulation device hardware medium",
  Stylize: "art artistic illustration drawing look",
};

const getIntentKeywords = (entry: FilterEntry) => {
  const text = `${entry.displayName} ${entry.description || ""}`.toLocaleLowerCase();
  return [
    CATEGORY_INTENTS[entry.category] || "",
    /vhs|ntsc|pal\b|secam|television|\btv\b|crt|pxl-2000|slow-scan|video signal/.test(text)
      ? "analog video television tape broadcast signal retro"
      : "",
    /film|camera|photo|daguerreotype|polaroid|mavica/.test(text)
      ? "photography photographic cinematic camera lens"
      : "",
    /grain|noise|static|speckle/.test(text) ? "grainy gritty noisy texture" : "",
    /print|paper|ink|newspaper|fax|risograph|halftone/.test(text)
      ? "print printing paper ink physical press"
      : "",
  ].join(" ");
};

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
    getIntentKeywords(entry),
  ].join(" ");
};

const allFilters = filterList
  .filter((entry): entry is FilterEntry => Boolean(entry))
  .map((entry): SearchableFilter => ({ ...entry, keywords: getSearchKeywords(entry) }));

const filterByName = new Map(allFilters.map((entry) => [entry.displayName, entry] as const));
const thumbFilterByName = new Map(
  allFilters.map((entry) => [
    entry.displayName,
    { displayName: entry.displayName, filter: entry.filter, category: entry.category },
  ] as const),
);
const searchIndex = buildFilterSearchIndex(allFilters);
const categoryEntries = Array.from(
  allFilters
    .filter((entry) => entry.displayName !== "None")
    .reduce((categories, entry) => {
      const entries = categories.get(entry.category) ?? [];
      entries.push(entry);
      categories.set(entry.category, entries);
      return categories;
    }, new Map<string, SearchableFilter[]>()),
  ([name, entries]) => ({
    name,
    entries: [...entries].sort((left, right) => left.displayName.localeCompare(right.displayName)),
    examples: entries.slice(0, 3).map((entry) => entry.displayName),
  }),
).sort((left, right) => left.name.localeCompare(right.name));
const allBrowseEntries = allFilters
  .filter((entry) => entry.displayName !== "None")
  .sort((left, right) => left.displayName.localeCompare(right.displayName));
const ALL_CATEGORY = {
  name: "All",
  entries: allBrowseEntries,
  examples: ["Every filter, A–Z"],
};
const browseCategories = [ALL_CATEGORY, ...categoryEntries];
const categoryByName = new Map(browseCategories.map((category) => [category.name, category] as const));

// Category to open into when replacing an existing filter, or null to land on
// the recents/browse overview.
const categoryForFilter = (name: string | undefined): string | null => {
  const entry = name ? filterByName.get(name) : undefined;
  return entry && categoryByName.has(entry.category) ? entry.category : null;
};

const readRecentNames = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    return [...new Set(stored.filter((name): name is string => typeof name === "string"))]
      .filter((name) => filterByName.has(name))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
};

const rememberRecentName = (displayName: string, current: string[]) => {
  const next = [displayName, ...current.filter((name) => name !== displayName)].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
  return next;
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

type Capability = { label: string; detail: string; tone: "gl" | "temp" | "anim" | "cpu" };

const getCapabilities = (entry: SearchableFilter): Capability[] => [
  entry.filter.requiresGL ? { label: "WebGL2", detail: "Requires WebGL2", tone: "gl" as const } : null,
  entry.filter.temporal ? { label: "Temporal", detail: "Uses frame history", tone: "temp" as const } : null,
  entry.filter.autoAnimate || entry.filter.optionTypes?.animate
    ? { label: "Animated", detail: "Can evolve over time", tone: "anim" as const }
    : null,
  entry.filter.noGL ? { label: "CPU", detail: "Sequential CPU path", tone: "cpu" as const } : null,
].filter((capability): capability is Capability => Boolean(capability));

interface Props {
  onSelect: (entry: FilterEntry) => void;
  onClose?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  inline?: boolean;
  /** Display name of the currently-selected filter, shown as replacement context. */
  currentValue?: string;
}

const FilterCombobox = ({
  onSelect,
  onClose,
  placeholder = "+ Add filter...",
  autoFocus = false,
  inline = false,
  currentValue,
}: Props) => {
  const [open, setOpen] = useState(autoFocus);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(currentValue ?? "");
  const [activeCategory, setActiveCategory] = useState<string | null>(
    () => (autoFocus ? categoryForFilter(currentValue) : null),
  );
  const [recentNames, setRecentNames] = useState(readRecentNames);
  const [previewSource, setPreviewSource] = useState<HTMLImageElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const popupId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const normalizedQuery = normalizeFilterSearchText(query);

  const searchResult = useMemo(
    () => searchFilterIndex(searchIndex, query, MAX_RESULTS),
    [query],
  );
  const recentEntries = useMemo(
    () => recentNames.map((name) => filterByName.get(name)).filter((entry): entry is SearchableFilter => Boolean(entry)),
    [recentNames],
  );
  const selectedCategory = activeCategory ? categoryByName.get(activeCategory) : undefined;
  const resultEntries = normalizedQuery
    ? searchResult.items
    : selectedCategory?.entries ?? [];
  const resultTotal = normalizedQuery ? searchResult.total : selectedCategory?.entries.length ?? 0;
  const showingResults = normalizedQuery.length > 0 || Boolean(selectedCategory);
  const selectedEntry = resultEntries.find((entry) => entry.displayName === value) ?? resultEntries[0];

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

  useEffect(() => {
    if (!open || !listRef.current || !value || !showingResults) return;
    requestAnimationFrame(() => {
      const element = listRef.current?.querySelector(`[data-value="${CSS.escape(value)}"]`);
      if (element && "scrollIntoView" in element) {
        (element as HTMLElement).scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    });
  }, [open, showingResults, value]);

  useEffect(() => {
    if (!open || previewSource) return;
    const img = new Image();
    img.onload = () => setPreviewSource(img);
    img.src = PREVIEW_SOURCE_SRC;
  }, [open, previewSource]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveCategory(null);
    onClose?.();
  }, [onClose]);

  const openFinder = useCallback(() => {
    setRecentNames(readRecentNames());
    setQuery("");
    // When replacing an existing filter, open straight into its category so the
    // sibling filters (and the current one, highlighted) are right there.
    setActiveCategory(categoryForFilter(currentValue));
    setValue(currentValue ?? "");
    setOpen(true);
  }, [currentValue]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      openFinder();
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

  const openFromNavigationKey = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    openFinder();
  }, [open, openFinder]);

  const browseCategory = (category: string) => {
    const first = categoryByName.get(category)?.entries[0];
    setActiveCategory(category);
    setQuery("");
    if (first) setValue(first.displayName);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const resultStatus = normalizedQuery
    ? searchResult.total === 0
      ? "No matches"
      : searchResult.total > resultEntries.length
        ? `${resultEntries.length} of ${searchResult.total} matches`
        : `${searchResult.total} ${searchResult.total === 1 ? "match" : "matches"}`
    : selectedCategory
      ? `${resultEntries.length}${resultTotal > resultEntries.length ? ` of ${resultTotal}` : ""} ${selectedCategory.name} filters`
      : `${categoryEntries.length} categories · ${allFilters.length} total`;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          className={`${s.trigger} ${inline ? s.inlineTrigger : ""}`}
          role="combobox"
          aria-label={currentValue ? `Replace ${currentValue} filter` : placeholder}
          aria-controls={open ? popupId : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          tabIndex={0}
          onKeyDown={openFromNavigationKey}
        >
          {placeholder}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          id={popupId}
          className={s.content}
          role="dialog"
          align="start"
          side="bottom"
          sideOffset={5}
          collisionPadding={8}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
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
            <header className={s.finderHeader}>
              <span className={s.finderEyebrow}>Filter finder</span>
              <strong id={titleId} className={s.finderTitle}>
                {currentValue ? `Replace ${currentValue}` : "Add a filter"}
              </strong>
              <span id={descriptionId} className={s.finderDescription}>
                Search by look, medium, technique, or hardware.
              </span>
            </header>
            <div className={s.searchShell}>
              <span className={s.searchGlyph} aria-hidden="true" />
              <Command.Input
                ref={inputRef}
                className={s.input}
                value={query}
                onValueChange={(nextQuery) => {
                  setQuery(nextQuery);
                  setActiveCategory(null);
                }}
                placeholder="Try ‘grainy’, ‘CRT’, ‘edge’, ‘dither’…"
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
                    setActiveCategory(null);
                    inputRef.current?.focus();
                  }}
                >
                  ×
                </button>
              ) : <span className={s.searchHint} aria-hidden="true">type</span>}
            </div>
            <div className={s.statusBar} aria-live="polite">
              {selectedCategory ? (
                <button type="button" className={s.backButton} onClick={() => setActiveCategory(null)}>
                  ← Categories
                </button>
              ) : <span className={s.statusLamp} aria-hidden="true" />}
              <span>{resultStatus}</span>
              {showingResults ? (
                <span className={s.registryCount}>
                  {normalizedQuery ? "Global ranked search" : "A–Z category browse"}
                </span>
              ) : null}
            </div>

            {!showingResults ? (
              <div className={s.landing} data-testid="filter-typeahead-overview">
                {recentEntries.length > 0 ? (
                  <section className={s.recents} aria-labelledby={`${titleId}-recent`}>
                    <div className={s.sectionHeading}>
                      <strong id={`${titleId}-recent`}>Recently used</strong>
                      <span>Fast return</span>
                    </div>
                    <div className={s.recentGrid}>
                      {recentEntries.map((entry) => (
                        <button
                          type="button"
                          key={entry.displayName}
                          className={s.recentButton}
                          data-recent-value={entry.displayName}
                          onClick={() => handleSelect(entry.displayName)}
                        >
                          <strong>{entry.displayName}</strong>
                          <span>{entry.category}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
                <section className={s.browser} aria-labelledby={`${titleId}-browse`}>
                  <div className={s.sectionHeading}>
                    <strong id={`${titleId}-browse`}>Browse by type</strong>
                    <span>Recognition beats recall</span>
                  </div>
                  <div className={s.categoryGrid}>
                    {browseCategories.map((category) => (
                      <button
                        type="button"
                        key={category.name}
                        className={`${s.categoryButton} ${category.name === "All" ? s.categoryButtonAll : ""}`}
                        aria-label={`Browse ${category.name} filters (${category.entries.length})`}
                        onClick={() => browseCategory(category.name)}
                      >
                        <span className={s.categoryHeader}>
                          <strong>{category.name}</strong>
                          <span>{category.entries.length}</span>
                        </span>
                        <span className={s.categoryExamples}>{category.examples.join(" · ")}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <div className={s.resultsLayout}>
                <Command.List id={listId} ref={listRef} className={s.list}>
                  {resultEntries.length === 0 ? (
                    <div className={s.empty}>
                      <strong>No matching filters</strong>
                      <span>Try a broader intent such as “glitch”, “film”, “soft”, or “motion”.</span>
                      <button type="button" onClick={() => { setQuery(""); setActiveCategory(null); }}>
                        Browse categories
                      </button>
                    </div>
                  ) : (
                    <Command.Group
                      heading={normalizedQuery ? "Best matches" : `${selectedCategory?.name} filters`}
                      className={s.group}
                    >
                      {resultEntries.map((item) => {
                        const capabilities = getCapabilities(item);
                        return (
                          <Command.Item
                            key={item.displayName}
                            value={item.displayName}
                            onSelect={handleSelect}
                            onPointerMove={() => setValue(item.displayName)}
                            className={s.item}
                            data-value={item.displayName}
                            data-testid="filter-typeahead-item"
                          >
                            <span className={s.itemText}>
                              <strong className={s.itemName}>{highlightMatch(item.displayName, query)}</strong>
                              <span className={s.itemCategory}>{item.category}</span>
                            </span>
                            {currentValue === item.displayName ? <span className={s.currentBadge}>Current</span> : null}
                            {capabilities.slice(0, 2).map((capability) => (
                              <span key={capability.label} className={`${s.badge} ${s[`badge_${capability.tone}`]}`}>
                                {capability.label}
                              </span>
                            ))}
                          </Command.Item>
                        );
                      })}
                    </Command.Group>
                  )}
                </Command.List>
                <aside className={s.detailPane} aria-live="polite">
                  {selectedEntry ? (
                    <>
                      <div className={s.detailPreview} aria-hidden="true">
                        <FilterThumbnail
                          filter={selectedEntry}
                          filterByName={thumbFilterByName}
                          source={previewSource}
                        />
                      </div>
                      <span className={s.detailCategory}>{selectedEntry.category}</span>
                      <strong className={s.detailTitle}>{selectedEntry.displayName}</strong>
                      <p className={s.detailDescription}>{selectedEntry.description || "No description available."}</p>
                      <div className={s.detailFacts}>
                        <span>{Object.keys(selectedEntry.filter.optionTypes || {}).length} controls</span>
                        {getCapabilities(selectedEntry).map((capability) => (
                          <span key={capability.detail}>{capability.detail}</span>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={s.chooseButton}
                        onClick={() => handleSelect(selectedEntry.displayName)}
                      >
                        {currentValue ? "Use this replacement" : "Add this filter"}
                      </button>
                    </>
                  ) : (
                    <div className={s.detailPlaceholder}>Broaden the search or browse a category.</div>
                  )}
                </aside>
              </div>
            )}
            <footer className={s.footer}>
              <span className={s.safetyNote}>
                {currentValue ? `Esc keeps ${currentValue}` : "Nothing changes until you choose"}
              </span>
              <span><kbd>↑↓</kbd> inspect</span>
              <span><kbd>Enter</kbd> choose</span>
              <span><kbd>Esc</kbd> close</span>
            </footer>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default FilterCombobox;
