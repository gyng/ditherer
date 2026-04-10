import { useState, useRef, useCallback } from "react";
import { useFilter } from "context/useFilter";
import { filterList, noop } from "filters";
import { ACTION, STRING, TEXT, COLOR_ARRAY, RANGE, BOOL, ENUM, PALETTE, COLOR } from "constants/controlTypes";
import { paletteList } from "palettes";
import * as palettes from "palettes";
import { THEMES } from "palettes/user";
import ChainPreview from "./ChainPreview";
import FilterCombobox from "components/FilterCombobox";
import ModalInput from "components/ModalInput";
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
  { name: "Solarized", desc: "Sabattier effect — partial tone reversal with boosted contrast", filters: ["Solarize", "Levels", "Bloom"], category: "Color" },

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
  { name: "Bit Rot", desc: "Severe digital decay — crushed bits, channel corruption, scattered pixels, heavy compression", filters: ["Bit crush", "Channel shift", "Pixel scatter", "JPEG artifact", "JPEG artifact"], category: "Glitch" },
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
  { name: "Matrix", desc: "Digital rain — source image visible through falling katakana characters", filters: ["Levels", "Matrix rain"], category: "Simulate" },
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
  { name: "Fractal Overlay", desc: "Mandelbrot fractal with source image colors and edge glow", filters: ["Fractal", "Edge glow", "Bloom"], category: "Advanced" },

  // Temporal — existing
  { name: "Heat Vision", desc: "Motion detection with bloom glow — thermal camera aesthetic", filters: ["Motion detect", "Bloom", "Color shift"], category: "Simulate" },
  { name: "Light Painting", desc: "Edge-detected light trails accumulating over time", filters: ["Edge glow", "Long exposure"], category: "Simulate" },
  { name: "Ghost", desc: "Temporal echo with soft glow — moving subjects leave ghostly trails", filters: ["Frame blend", "Bloom"], category: "Blur & Edges" },
  { name: "Motion Neon", desc: "Neon-traced motion outlines with chromatic splitting", filters: ["Temporal edge", "Bloom", "Chromatic aberration"], category: "Blur & Edges" },
  { name: "Retro Monitor", desc: "CRT phosphor persistence with scanlines — green lingers longest", filters: ["CRT emulation", "Phosphor decay", "Scanline"], category: "Simulate" },
  { name: "Security Camera", desc: "Grainy monochrome security feed with motion overlay", filters: ["Grayscale", "Motion detect", "Scanline", "Film grain"], category: "Simulate" },

  // Temporal — new filters
  { name: "Activity Map", desc: "Accumulated motion heatmap with bloom glow", filters: ["Motion heatmap", "Bloom"], category: "Simulate" },
  { name: "Acid Trip", desc: "Temporal color cycling through solarized bloom", filters: ["Temporal color cycle", "Solarize", "Bloom"], category: "Color" },
  { name: "Censored", desc: "Moving areas become pixelated blocks", filters: ["Motion pixelate", "Sharpen"], category: "Stylize" },
  { name: "Color Freeze", desc: "RGB channels freeze independently — color-split glitch", filters: ["Freeze frame glitch", "Chromatic aberration"], category: "Glitch" },
  { name: "Frozen Glitch", desc: "Random blocks freeze in time — corrupted buffer", filters: ["Freeze frame glitch"], category: "Glitch" },
  { name: "Ghost Dance", desc: "Isolated moving subject stroboscopic ghosts with bloom", filters: ["Chronophotography", "Bloom", "Chromatic aberration"], category: "Stylize" },
  { name: "Heat Shimmer", desc: "Motion-reactive heat distortion with glow", filters: ["Wake turbulence", "Bloom"], category: "Distort" },
  { name: "Infinite Tunnel", desc: "Zooming recursive video feedback — fractal patterns", filters: ["Video feedback", "Bloom"], category: "Advanced" },
  { name: "Lucid Dream", desc: "Dreamy temporal blur with light leak and warm tones", filters: ["Gaussian blur", "Bloom", "Light leak", "Sepia", "Frame blend"], category: "Blur & Edges" },
  { name: "Neon Afterglow", desc: "Neon edges with complementary-colored ghosts", filters: ["Edge glow", "After-image", "Bloom"], category: "Stylize" },
  { name: "Panorama Glitch", desc: "Temporal slit scan with JPEG corruption", filters: ["Slit scan", "JPEG artifact"], category: "Glitch" },
  { name: "Privacy Mode", desc: "Moving areas heavily pixelated and blurred", filters: ["Motion pixelate", "Gaussian blur"], category: "Simulate" },
  { name: "Psychedelic", desc: "Motion-reactive rainbow cycling with bloom and color split", filters: ["Temporal color cycle", "Bloom", "Chromatic aberration"], category: "Color" },
  { name: "Rainbow Vortex", desc: "Color-shifting recursive zoom with chromatic split", filters: ["Video feedback", "Bloom", "Chromatic aberration"], category: "Advanced" },
  { name: "Retinal Burn", desc: "Bright objects leave complementary-colored after-images", filters: ["After-image", "Bloom"], category: "Simulate" },
  { name: "Stargate", desc: "Temporal slit scan with chromatic aberration and glow", filters: ["Slit scan", "Chromatic aberration", "Bloom"], category: "Advanced" },
  { name: "Stroboscope", desc: "Étienne-Jules Marey stroboscopic photography with glow", filters: ["Chronophotography", "Levels", "Bloom"], category: "Stylize" },
  { name: "Surveillance Wall", desc: "Tiles updating at staggered rates with scanlines and grain", filters: ["Time mosaic", "Scanline", "Film grain"], category: "Simulate" },
  { name: "Time Slice", desc: "Temporal slit scan — each column is a different moment", filters: ["Slit scan", "Sharpen"], category: "Distort" },
  { name: "Underwater", desc: "Motion-reactive ripple distortion with chromatic split", filters: ["Wake turbulence", "Chromatic aberration", "Bloom"], category: "Simulate" },
  { name: "Virtual Greenscreen", desc: "Remove static background, keep only moving foreground", filters: ["Background subtraction"], category: "Color" },

  // Non-temporal new presets
  { name: "Cyanotype", desc: "UV-exposed blueprint print — white on Prussian blue", filters: ["Grayscale", "Invert", "Blend", "Vignette"], category: "Color" },
  { name: "Double Exposure", desc: "Classic film double exposure with bloom and tonal control", filters: ["Blend", "Bloom", "Levels"], category: "Photo" },
  { name: "Glitch VHS", desc: "VHS tracking errors with block displacement and color split", filters: ["VHS emulation", "Glitch blocks", "Chromatic aberration"], category: "Glitch" },
  { name: "Lenticular Card", desc: "Holographic rainbow sheen with scanlines and glow", filters: ["Lenticular", "Scanline", "Bloom"], category: "Simulate" },
  { name: "Lo-fi Webcam", desc: "Chunky pixels with JPEG artifacts and film grain", filters: ["Pixelate", "JPEG artifact", "Film grain", "Vignette"], category: "Simulate" },
  { name: "Night City", desc: "Cyberpunk neon outlines with chromatic split and bloom", filters: ["Posterize edges", "Chromatic aberration", "Bloom"], category: "Stylize" },
  { name: "Pop Art", desc: "Warhol-style Ben-Day dots with flat posterized colors and glow", filters: ["Pop art", "Posterize", "Bloom"], category: "Stylize" },
  { name: "X-Ray", desc: "Medical X-ray — inverted grayscale with glow", filters: ["Grayscale", "Invert", "Levels", "Bloom"], category: "Simulate" },
];

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
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [savedChains, setSavedChains] = useState<SavedChain[]>(loadUserChains);
  const [loadedSavedName, setLoadedSavedName] = useState<string | null>(null);
  const PRESET_CATEGORIES = [...new Set(CHAIN_PRESETS.map((p) => p.category))];
  const dragCounter = useRef(0);
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
    const first = filterList.find((f) => f && f.displayName === preset.filters[0]);
    if (!first) return;
    actions.selectFilter(preset.filters[0], first.filter);
    // Add remaining filters
    for (let i = 1; i < preset.filters.length; i++) {
      addFilterByName(preset.filters[i]);
    }
  };

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
        const chainNames = chain.map((e) => e.displayName);
        // Check built-in presets
        const matchedPreset = CHAIN_PRESETS.find((p) =>
          p.filters.length === chainNames.length && p.filters.every((f, i) => f === chainNames[i])
        );
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
