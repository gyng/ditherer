import { useState, useRef, useCallback } from "react";
import { useFilter } from "context/useFilter";
import { filterList, filterCategories } from "filters";
import { ACTION, STRING, TEXT, COLOR_ARRAY, RANGE, BOOL, ENUM, PALETTE, COLOR } from "constants/controlTypes";
import { paletteList } from "palettes";
import * as palettes from "palettes";
import { THEMES } from "palettes/user";
import ChainPreview from "./ChainPreview";
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

// Chain presets: curated multi-filter combos, alphabetized within each category
const CHAIN_PRESETS: { name: string; desc: string; filters: string[]; category: string }[] = [
  // Dithering
  { name: "Amber Terminal", desc: "Monochrome amber phosphor dithering with CRT glow", filters: ["Ordered (Amber CRT)", "Scanline", "Bloom"], category: "Dithering" },
  { name: "Gameboy Screen", desc: "4-shade green LCD with visible scan lines and edge darkening", filters: ["Ordered (Gameboy)", "Scanline", "Vignette"], category: "Dithering" },
  { name: "PICO-8 Demake", desc: "Chunky pixels quantized to the PICO-8 16-color palette", filters: ["Pixelate", "Ordered (PICO-8)", "Sharpen"], category: "Dithering" },
  { name: "Vaporwave Dither", desc: "Pastel error-diffused dithering with dreamy bloom and color fringe", filters: ["Floyd-Steinberg (Vaporwave test)", "Bloom", "Chromatic aberration"], category: "Dithering" },

  // Color
  { name: "Duotone Poster", desc: "Two-tone flat poster with bold tonal contrast", filters: ["Grayscale", "Duotone", "Posterize", "Sharpen"], category: "Color" },
  { name: "Gradient Remap", desc: "Map luminance to a custom color gradient with soft glow", filters: ["Grayscale", "Gradient map", "Bloom"], category: "Color" },
  { name: "HDR Tone Map", desc: "Aggressive local contrast with dodged highlights and burned shadows", filters: ["CLAHE", "Levels", "Dodge / Burn", "Sharpen"], category: "Color" },
  { name: "Infrared Film", desc: "False-color IR — white foliage, dark skies, pink cast", filters: ["Infrared photography", "Color balance", "Film grain"], category: "Color" },
  { name: "Solarized", desc: "Sabattier effect — partial tone reversal with shifted hues", filters: ["Solarize", "Color shift", "Levels"], category: "Color" },

  // Stylize
  { name: "ASCII Art", desc: "Render the image as a grid of ASCII characters sized by luminance", filters: ["ASCII", "Sharpen"], category: "Stylize" },
  { name: "Currency Engraving", desc: "Fine parallel lines on aged paper — banknote illustration style", filters: ["Engraving", "Sharpen", "Sepia"], category: "Stylize" },
  { name: "Dot Matrix Printer", desc: "Fixed-pitch impact dots on warm aged paper", filters: ["Dot matrix", "Sepia", "Film grain"], category: "Stylize" },
  { name: "Lo-fi Print", desc: "Warm-toned halftone print with film grain texture", filters: ["Sepia", "Halftone", "Film grain"], category: "Stylize" },
  { name: "Mosaic", desc: "Irregular tile grid with grout lines — ancient mosaic look", filters: ["Mosaic tile", "Sharpen", "Vignette"], category: "Stylize" },
  { name: "Neon", desc: "Glowing edge outlines on dark background with color fringe", filters: ["Invert", "Edge glow", "Bloom", "Chromatic aberration"], category: "Stylize" },
  { name: "Pixel Art", desc: "Chunky pixels quantized to limited colors then upscaled crisp", filters: ["Pixelate", "Quantize (No dithering)", "Pixel art upscale"], category: "Stylize" },
  { name: "Risograph", desc: "Multi-layer spot color separation with misregistration and grain", filters: ["Risograph (multi-layer)", "Film grain", "Sharpen"], category: "Stylize" },
  { name: "Sketch", desc: "Pencil strokes following edge flow with soft vignette", filters: ["Pencil sketch", "Sharpen", "Vignette"], category: "Stylize" },
  { name: "Stained Glass", desc: "Voronoi cells with dark leading and glowing colored glass", filters: ["Stained glass", "Edge glow", "Bloom"], category: "Stylize" },
  { name: "Watercolor", desc: "Soft wet-on-wet painting with outlined edges", filters: ["Gaussian blur", "Kuwahara", "Watercolor bleed", "Posterize edges"], category: "Stylize" },
  { name: "Woodblock Print", desc: "Japanese woodblock style — sumi ink carved lines on cream", filters: ["Woodcut (Ukiyo-e)", "Sharpen", "Vignette"], category: "Stylize" },

  // Distort
  { name: "Earthquake", desc: "Violent displacement — Perlin warping, sine waves, and shaky rows", filters: ["Turbulence", "Wave", "Jitter"], category: "Distort" },
  { name: "Funhouse Mirror", desc: "Carnival mirror — bulging center with barrel edges and asymmetric stretch", filters: ["Spherize", "Lens distortion", "Stretch"], category: "Distort" },
  { name: "Kaleidoscope", desc: "Radial symmetry with prismatic color splitting and soft glow", filters: ["Mirror / Kaleidoscope", "Chromatic aberration", "Bloom"], category: "Distort" },
  { name: "Melt", desc: "Organic pixel melting — warped, smeared, and dripping by luminance", filters: ["Liquify", "Smudge", "Pixel drift"], category: "Distort" },

  // Glitch
  { name: "Bit Rot", desc: "Digital decay — crushed bit depth, exploding pixels, and block artifacts", filters: ["Bit crush", "Pixel scatter", "JPEG artifact"], category: "Glitch" },
  { name: "Broadcast Failure", desc: "Corrupted broadcast — smeared I-frames, split channels, shifted lines", filters: ["Datamosh", "Channel separation", "Scan line shift"], category: "Glitch" },
  { name: "Corrupted", desc: "Audio-mangled data with block artifacts and static noise", filters: ["Data bend", "Glitch blocks", "Chromatic aberration", "Analog static"], category: "Glitch" },
  { name: "Data Corruption", desc: "Broken compression — smeared blocks and DCT artifacts", filters: ["Glitch blocks", "Data bend", "JPEG artifact"], category: "Glitch" },
  { name: "Glitch Art", desc: "Sorted pixel streaks, split channels, shifted scan lines", filters: ["Pixelsort", "Chromatic aberration", "Scan line shift", "JPEG artifact"], category: "Glitch" },
  { name: "VHS Pause", desc: "Frozen VHS frame — tracking errors, torn fields, and static snow", filters: ["VHS emulation", "Interlace tear", "Analog static"], category: "Glitch" },

  // Simulate
  { name: "Blueprint", desc: "Architectural line drawing — white lines on blue", filters: ["Grayscale", "Contour lines", "Invert"], category: "Simulate" },
  { name: "Cyberpunk", desc: "Neon-soaked CRT with chromatic split and bloom glow", filters: ["Chromatic posterize", "Chromatic aberration", "Bloom", "CRT emulation"], category: "Simulate" },
  { name: "Daguerreotype", desc: "1839 silver-plate photography with soft vignette and grain", filters: ["Daguerreotype", "Vignette", "Film grain"], category: "Simulate" },
  { name: "Fax Machine", desc: "Thermal fax output — binary with scan artifacts and speckle", filters: ["Fax machine", "Film grain", "Sharpen"], category: "Simulate" },
  { name: "Film Projector", desc: "Flickering 8mm home movie with gate weave and sprocket burns", filters: ["Projection film", "Film grain", "Vignette", "Light leak"], category: "Simulate" },
  { name: "Mavica Photo", desc: "Sony Mavica floppy disk camera — 640x480, heavy JPEG, CCD noise", filters: ["Mavica FD7", "JPEG artifact", "Film grain"], category: "Simulate" },
  { name: "Newsprint", desc: "Black-and-white newspaper with coarse halftone dots", filters: ["Grayscale", "Newspaper", "Sharpen"], category: "Simulate" },
  { name: "Photocopier", desc: "High-contrast office copier with speckle and generation loss", filters: ["Photocopier", "Film grain"], category: "Simulate" },
  { name: "Receipt Printer", desc: "Narrow thermal receipt — low-res dots with ink fade", filters: ["Thermal printer", "Film grain"], category: "Simulate" },
  { name: "Retro TV", desc: "VHS tracking errors, CRT phosphor mask, and corner vignette", filters: ["VHS emulation", "CRT emulation", "Vignette"], category: "Simulate" },
  { name: "Surveillance", desc: "Grainy security camera feed with night vision and compression", filters: ["Grayscale", "Night vision", "Scanline", "JPEG artifact"], category: "Simulate" },
  { name: "Thermal", desc: "FLIR-style heat map with posterized temperature bands", filters: ["Thermal camera", "Posterize", "Bloom"], category: "Simulate" },

  // Photo
  { name: "Faded Film", desc: "Sun-bleached emulsion with light leaks and soft grain", filters: ["Sepia", "Light leak", "Film grain", "Vignette"], category: "Photo" },
  { name: "Noir", desc: "High-contrast black and white with grain and vignette", filters: ["Grayscale", "Levels", "Sharpen", "Vignette", "Film grain"], category: "Photo" },
  { name: "Polaroid", desc: "Instant film look with faded edges and subtle grain", filters: ["Polaroid", "Vignette", "Film grain"], category: "Photo" },
  { name: "Vintage Photo", desc: "Warm sepia toning with chemical grain and light bleed", filters: ["Sepia", "Film grain", "Vignette", "Light leak"], category: "Photo" },

  // Blur & Edges
  { name: "Dream Sequence", desc: "Soft vaseline-lens glow with warm light bleed — flashback cinema", filters: ["Gaussian blur", "Bloom", "Light leak", "Sepia"], category: "Blur & Edges" },
  { name: "Embossed Metal", desc: "Raised relief surface — metallic highlight and shadow from edges", filters: ["Emboss", "Levels", "Sharpen"], category: "Blur & Edges" },
  { name: "Miniature World", desc: "Fake tilt-shift diorama — selective focus makes scenes look tiny", filters: ["Tilt shift", "Bloom", "Vignette", "Levels"], category: "Blur & Edges" },

  // Advanced
  { name: "Cellular Life", desc: "Conway's Game of Life with neon-glowing cell boundaries", filters: ["Cellular automata", "Edge glow", "Bloom"], category: "Advanced" },
  { name: "Flow Painting", desc: "Curl noise streamlines blended with thick painterly strokes", filters: ["Flow field", "Oil painting", "Bloom"], category: "Advanced" },
  { name: "Fractal Overlay", desc: "Mandelbrot fractal color-mapped and blended with the source image", filters: ["Fractal", "Gradient map", "Blend"], category: "Advanced" },
];

const PRESET_CATEGORIES = [...new Set(CHAIN_PRESETS.map((p) => p.category))];

const ChainList = () => {
  const { state, actions } = useFilter();
  const { chain, activeIndex } = state;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ top: number; left: number } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const dragCounter = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const addFilterByName = (name: string) => {
    const filter = filterList.find((f) => f && f.displayName === name);
    if (filter) actions.chainAdd(name, filter.filter);
  };

  const loadPreset = (preset: typeof CHAIN_PRESETS[0]) => {
    // Set first filter via selectFilter (resets chain to 1 entry)
    const first = filterList.find((f) => f && f.displayName === preset.filters[0]);
    if (!first) return;
    actions.selectFilter(preset.filters[0], first);
    // Add remaining filters
    for (let i = 1; i < preset.filters.length; i++) {
      addFilterByName(preset.filters[i]);
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
                disabled={chain.length <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.chainRemove(entry.id);
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
            </div>
          );
        })}
      </div>

      {hoveredEntryId && hoverPos && (() => {
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
            actions.chainAdd(displayName, { ...filter, options: filter.options || filter.defaults });
          }}
          title="Add a random filter"
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
        <select
          className={s.presetSelect}
          value=""
          onChange={(e) => {
            const preset = CHAIN_PRESETS.find((p) => p.name === e.target.value);
            if (preset) loadPreset(preset);
          }}
          title="Load a chain preset"
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
          onClick={() => {
            if (chain.length <= 1) return;
            setShowClearConfirm(true);
          }}
          title="Clear filter chain"
          disabled={chain.length <= 1}
        >
          &#10005;
        </button>
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
                  const defaultFilter = filterList.find((f) => f && f.displayName === chain[0]?.displayName) || filterList[0];
                  actions.selectFilter(defaultFilter.displayName, defaultFilter);
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
    </div>
  );
};

export default ChainList;
