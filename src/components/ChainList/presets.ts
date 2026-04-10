export interface PresetFilterEntry {
  name: string;
  options?: Record<string, unknown>;
}

export interface ChainPreset {
  name: string;
  desc: string;
  filters: PresetFilterEntry[];
  category: string;
}

const f = (name: string, options?: Record<string, unknown>): PresetFilterEntry =>
  options ? { name, options } : { name };

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
};

const stableStringify = (value: unknown) => JSON.stringify(stableValue(value));

type DefaultsResolver = (name: string) => Record<string, unknown>;

const canonicalizeOptions = (
  name: string,
  options?: Record<string, unknown>,
  resolveDefaults?: DefaultsResolver
) => {
  const defaults = resolveDefaults ? resolveDefaults(name) : {};
  const merged = {
    ...defaults,
    ...(options || {}),
  };

  const overrides = Object.keys(merged)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      if (key.startsWith("_")) return acc;
      if (stableStringify(merged[key]) === stableStringify(defaults[key])) return acc;
      acc[key] = stableValue(merged[key]);
      return acc;
    }, {});

  return Object.keys(overrides).length > 0 ? overrides : null;
};

export const getPresetSignature = (
  filters: PresetFilterEntry[],
  resolveDefaults?: DefaultsResolver
) => JSON.stringify(
  filters.map((entry) => ({
    name: entry.name,
    options: canonicalizeOptions(entry.name, entry.options, resolveDefaults),
  }))
);

export const getChainSignature = (
  chain: Array<{ displayName: string; filter: { options?: Record<string, unknown>; defaults?: Record<string, unknown> } }>,
  resolveDefaults?: DefaultsResolver
) => JSON.stringify(
  chain.map((entry) => ({
    name: entry.displayName,
    options: canonicalizeOptions(entry.displayName, entry.filter.options || entry.filter.defaults, resolveDefaults),
  }))
);

export const findDuplicatePresetGroups = (presets: ChainPreset[], resolveDefaults?: DefaultsResolver) => {
  const bySignature = new Map<string, string[]>();

  for (const preset of presets) {
    const signature = getPresetSignature(preset.filters, resolveDefaults);
    const existing = bySignature.get(signature);
    if (existing) {
      existing.push(preset.name);
    } else {
      bySignature.set(signature, [preset.name]);
    }
  }

  return [...bySignature.values()].filter((names) => names.length > 1);
};

// Chain presets: curated multi-filter combos, alphabetized within each category
export const CHAIN_PRESETS: ChainPreset[] = [
  { name: "Amber Terminal", desc: "Monochrome amber phosphor dithering with CRT glow", filters: [f("Ordered (Amber CRT)"), f("Scanline"), f("Bloom")], category: "Dithering" },
  { name: "Gameboy Screen", desc: "4-shade green LCD with visible scan lines and edge darkening", filters: [f("Ordered (Gameboy)"), f("Scanline"), f("Vignette")], category: "Dithering" },
  { name: "Median Palette", desc: "Adaptive median-cut palette reduction for a compact posterized color set", filters: [f("Median Cut"), f("Sharpen")], category: "Dithering" },
  { name: "Octree Palette", desc: "Adaptive octree palette reduction with a slightly harsher retro posterization bias", filters: [f("Octree Quantize"), f("Sharpen")], category: "Dithering" },
  { name: "PICO-8 Demake", desc: "Chunky pixels quantized to the PICO-8 16-color palette", filters: [f("Pixelate"), f("Ordered (PICO-8)"), f("Sharpen")], category: "Dithering" },
  { name: "Vaporwave Dither", desc: "Pastel error-diffused dithering with dreamy bloom and color fringe", filters: [f("Floyd-Steinberg (Vaporwave test)"), f("Bloom"), f("Chromatic aberration")], category: "Dithering" },

  { name: "Acid Trip", desc: "Temporal color cycling through solarized bloom", filters: [f("Temporal color cycle"), f("Solarize"), f("Bloom")], category: "Color" },
  { name: "Cutout", desc: "Luminance-based matte cutout with clean graphic separation", filters: [f("Luma Matte"), f("Duotone")], category: "Color" },
  { name: "Duotone Poster", desc: "Two-tone flat poster with bold tonal contrast", filters: [f("Grayscale"), f("Duotone"), f("Posterize"), f("Sharpen")], category: "Color" },
  { name: "Empty Room", desc: "Static structures remain while moving people gradually disappear", filters: [f("Scene Separation", { mode: "BACKGROUND", learnRate: 0.02 })], category: "Color" },
  { name: "Gradient Remap", desc: "Map luminance to a custom color gradient with soft glow", filters: [f("Grayscale"), f("Gradient map"), f("Bloom")], category: "Color" },
  { name: "HDR Tone Map", desc: "Aggressive local contrast with dodged highlights and burned shadows", filters: [f("CLAHE"), f("Levels"), f("Dodge / Burn"), f("Sharpen")], category: "Color" },
  { name: "Hue Bands", desc: "Map broad hue families into a deliberate palette while keeping image structure intact", filters: [f("Palette Mapper by Hue Bands"), f("Sharpen")], category: "Color" },
  { name: "Infrared Film", desc: "False-color IR — white foliage, dark skies, pink cast", filters: [f("Infrared photography"), f("Color balance"), f("Film grain")], category: "Color" },
  { name: "Photo Pro", desc: "Gentle tonal shaping and sharpening for a polished photographic finish", filters: [f("Levels"), f("Curves"), f("Sharpen")], category: "Color" },
  { name: "Psychedelic", desc: "Motion-reactive rainbow cycling with bloom and color split", filters: [f("Temporal color cycle"), f("Bloom"), f("Chromatic aberration")], category: "Color" },
  { name: "Red Coat", desc: "Keep one accent hue vivid while the rest falls back toward monochrome", filters: [f("Color Pop"), f("Vignette")], category: "Color" },
  { name: "Resonator", desc: "Motion-reactive color echo with a glowing amplified difference image", filters: [f("Echo Combiner"), f("Bloom"), f("Chromatic aberration")], category: "Color" },
  { name: "Shop Photo", desc: "Commercial-style tone cleanup with local contrast and vignette", filters: [f("Curves"), f("CLAHE"), f("Vignette")], category: "Color" },
  { name: "Solarized", desc: "Sabattier effect — partial tone reversal with boosted contrast", filters: [f("Solarize"), f("Levels"), f("Bloom")], category: "Color" },
  { name: "Virtual Greenscreen", desc: "Remove static background, keep only moving foreground", filters: [f("Scene Separation", { mode: "FOREGROUND", background: "TRANSPARENT" })], category: "Color" },
  { name: "Zine Cover", desc: "Two-ink offset print on warm paper stock with a poster-like finish", filters: [f("Duplex / Offset Print"), f("Film grain")], category: "Color" },

  { name: "Dream Sequence", desc: "Soft vaseline-lens glow with warm light bleed — flashback cinema", filters: [f("Gaussian blur"), f("Bloom"), f("Light leak"), f("Sepia")], category: "Blur & Edges" },
  { name: "Embossed Metal", desc: "Raised relief surface — metallic highlight and shadow from edges", filters: [f("Emboss"), f("Levels"), f("Sharpen")], category: "Blur & Edges" },
  { name: "Ghost", desc: "Temporal echo with soft glow — moving subjects leave ghostly trails", filters: [f("Temporal Exposure", { mode: "BLEND", blendFactor: 0.7 }), f("Bloom")], category: "Blur & Edges" },
  { name: "Miniature World", desc: "Fake tilt-shift diorama — selective focus makes scenes look tiny", filters: [f("Tilt shift"), f("Bloom"), f("Vignette"), f("Levels")], category: "Blur & Edges" },
  { name: "Motion Neon", desc: "Neon-traced motion outlines with chromatic splitting", filters: [f("Temporal edge"), f("Bloom"), f("Chromatic aberration")], category: "Blur & Edges" },

  { name: "Band Pass", desc: "Middle image frequencies isolated into a technical texture-study view", filters: [f("Frequency Filter"), f("Bloom")], category: "Advanced" },
  { name: "Cellular Life", desc: "Conway's Game of Life with neon-glowing cell boundaries", filters: [f("Cellular automata"), f("Edge glow"), f("Bloom")], category: "Advanced" },
  { name: "Flow Painting", desc: "Curl noise streamlines blended with thick painterly strokes", filters: [f("Flow field"), f("Oil painting"), f("Bloom")], category: "Advanced" },
  { name: "Fractal Overlay", desc: "Mandelbrot fractal with source image colors and edge glow", filters: [f("Fractal"), f("Edge glow"), f("Bloom")], category: "Advanced" },
  { name: "Infinite Tunnel", desc: "Zooming recursive video feedback with optional rainbow-vortex energy and fractal bloom", filters: [f("Video feedback"), f("Bloom")], category: "Advanced" },
  {
    name: "Meeting Meltdown",
    desc: "Recursive video-call panes with digital UI drift and compression wear",
    filters: [
      f("Infinite call windows", {
        layout: "GRID_2X2",
        depth: 6,
        scalePerDepth: 0.84,
        drift: 0.02,
        mix: 0.75,
        uiChrome: true,
        digitalDegrade: 0.45,
        accentHue: 205,
      }),
      f("JPEG artifact"),
      f("Sharpen"),
    ],
    category: "Advanced",
  },
  {
    name: "Motion Compass",
    desc: "Animated motion arrows reveal direction changes like a technical field overlay",
    filters: [
      f("Motion Vectors", {
        display: "OVERLAY",
        colorMode: "DIRECTION",
        glyphMode: "NEEDLE",
        sourceMode: "LUMA",
        temporalSmoothing: 0.45,
        spatialSmoothing: 0.35,
        backgroundDim: 0.55,
      }),
    ],
    category: "Advanced",
  },
  { name: "Stargate", desc: "Temporal slit scan with chromatic aberration and glow", filters: [f("Slit scan"), f("Chromatic aberration"), f("Bloom")], category: "Advanced" },
  {
    name: "Traffic Trails",
    desc: "Motion vectors plus glow for a kinetic traffic-map feel on live footage",
    filters: [
      f("Motion Vectors", {
        display: "TRAILS",
        colorMode: "MAGNITUDE",
        glyphMode: "DOT",
        sourceMode: "LUMA",
        temporalSmoothing: 0.55,
        spatialSmoothing: 0.25,
        trailDecay: 0.92,
        backgroundDim: 0.3,
      }),
      f("Bloom"),
      f("Chromatic aberration"),
    ],
    category: "Advanced",
  },

  { name: "Earthquake", desc: "Violent displacement — Perlin warping, sine waves, and shaky rows", filters: [f("Turbulence"), f("Wave"), f("Jitter")], category: "Distort" },
  { name: "F-Zero Floor", desc: "Console-racer ground plane rushing toward the horizon", filters: [f("Mode 7"), f("Bloom"), f("Vignette")], category: "Distort" },
  { name: "Funhouse Mirror", desc: "Carnival mirror — bulging center with barrel edges and asymmetric stretch", filters: [f("Spherize"), f("Lens distortion"), f("Stretch")], category: "Distort" },
  { name: "Heat Shimmer", desc: "Motion-reactive heat distortion with glow", filters: [f("Wake turbulence"), f("Bloom")], category: "Distort" },
  { name: "Hex World", desc: "Staggered hex cells with soft glow — honeycomb posterization", filters: [f("Hex pixelate"), f("Bloom")], category: "Distort" },
  { name: "Iso Stack", desc: "Poster-like isometric slab extrusion with bold depth and arcade shading", filters: [f("Isometric Extrude"), f("Sharpen")], category: "Distort" },
  { name: "Kaleidoscope", desc: "Radial symmetry with prismatic color splitting and soft glow", filters: [f("Mirror / Kaleidoscope"), f("Chromatic aberration"), f("Bloom")], category: "Distort" },
  { name: "Melt", desc: "Organic pixel melting — warped, smeared, and dripping by luminance", filters: [f("Liquify"), f("Smudge"), f("Pixel drift")], category: "Distort" },
  { name: "Time Mirror", desc: "Different parts of the image pull from different moments in recent history", filters: [f("Time-warp Displacement"), f("Bloom")], category: "Distort" },
  { name: "Time Slice", desc: "Temporal slit scan — each column is a different moment", filters: [f("Slit scan"), f("Sharpen")], category: "Distort" },
  { name: "Tunnel Wrap", desc: "Wrap the image into a circular tunnel and add a subtle glow", filters: [f("Polar transform"), f("Bloom")], category: "Distort" },

  { name: "Bit Rot", desc: "Severe digital decay — crushed bits, channel corruption, scattered pixels, heavy compression", filters: [f("Bit crush"), f("Channel shift"), f("Pixel scatter"), f("JPEG artifact"), f("JPEG artifact")], category: "Glitch" },
  { name: "Broadcast Failure", desc: "Corrupted broadcast — smeared I-frames, split channels, shifted lines", filters: [f("Datamosh"), f("Channel separation"), f("Scan line shift")], category: "Glitch" },
  { name: "Color Freeze", desc: "Freeze-frame glitch with optional RGB channel splitting, from subtle holds to hard color-split corruption", filters: [f("Freeze frame glitch"), f("Chromatic aberration")], category: "Glitch" },
  { name: "Data Corruption", desc: "Broken compression — smeared blocks and DCT artifacts", filters: [f("Glitch blocks"), f("Data bend"), f("JPEG artifact")], category: "Glitch" },
  { name: "Glitch Art", desc: "Sorted pixel streaks, split channels, shifted scan lines", filters: [f("Pixelsort"), f("Chromatic aberration"), f("Scan line shift"), f("JPEG artifact")], category: "Glitch" },
  { name: "Panorama Glitch", desc: "Temporal slit scan with JPEG corruption", filters: [f("Slit scan"), f("JPEG artifact")], category: "Glitch" },
  { name: "VHS Pause", desc: "Frozen VHS frame — tracking errors, torn fields, and static snow", filters: [f("VHS emulation"), f("Interlace tear"), f("Analog static")], category: "Glitch" },

  { name: "ASCII Art", desc: "Render the image as a grid of ASCII characters sized by luminance", filters: [f("ASCII"), f("Sharpen")], category: "Stylize" },
  { name: "Cel Panel", desc: "Flat cartoon shading with crisp ink contours", filters: [f("Toon / Cel Shade"), f("Vignette")], category: "Stylize" },
  { name: "Censored", desc: "Moving areas become pixelated blocks", filters: [f("Motion pixelate"), f("Sharpen")], category: "Stylize" },
  { name: "Crystal Poster", desc: "Broad crystalized planes with dark seams and a polished poster finish", filters: [f("Facet / Crystalize Grid"), f("Bloom")], category: "Stylize" },
  { name: "Embroidery Hoop", desc: "Threaded X-stitches on warm fabric with a handmade feel", filters: [f("Cross-stitch"), f("Vignette")], category: "Stylize" },
  { name: "Currency Engraving", desc: "Fine parallel lines on aged paper — banknote illustration style", filters: [f("Engraving"), f("Sharpen"), f("Sepia")], category: "Stylize" },
  { name: "Dot Matrix Printer", desc: "Fixed-pitch impact dots on warm aged paper", filters: [f("Dot matrix"), f("Sepia"), f("Film grain")], category: "Stylize" },
  { name: "Etching", desc: "Short ink marks build tone like a coarse engraved print", filters: [f("Halftone Line"), f("Sepia"), f("Vignette")], category: "Stylize" },
  { name: "Ghost Dance", desc: "Chronophotography ghosts with bloom, balancing Marey-style strobing and dreamy color-fringed echoes", filters: [f("Chronophotography"), f("Bloom"), f("Chromatic aberration")], category: "Stylize" },
  { name: "Living Photo", desc: "Freeze the still parts of the scene while motion stays alive", filters: [f("Scene Separation", { mode: "FREEZE_STILL", frozenFrame: "FIRST", feather: 10 }), f("Vignette")], category: "Stylize" },
  { name: "Lo-fi Print", desc: "Warm-toned halftone print with film grain texture", filters: [f("Sepia"), f("Halftone"), f("Film grain")], category: "Stylize" },
  { name: "Mosaic", desc: "Irregular tile grid with grout lines — ancient mosaic look", filters: [f("Mosaic tile"), f("Sharpen"), f("Vignette")], category: "Stylize" },
  { name: "Neon", desc: "Glowing edge outlines on dark background with color fringe", filters: [f("Invert"), f("Edge glow"), f("Bloom"), f("Chromatic aberration")], category: "Stylize" },
  { name: "Neon Afterglow", desc: "Neon edges with complementary-colored ghosts", filters: [f("Edge glow"), f("After-image"), f("Bloom")], category: "Stylize" },
  { name: "Night City", desc: "Posterized neon signage and glowing street-edge contours without the CRT simulation layer", filters: [f("Posterize edges"), f("Chromatic aberration"), f("Bloom")], category: "Stylize" },
  { name: "Pixel Art", desc: "Chunky pixels quantized to limited colors then upscaled crisp", filters: [f("Pixelate"), f("Quantize (No dithering)"), f("Pixel art upscale")], category: "Stylize" },
  { name: "POV Display", desc: "Horizontal bands each show a slightly different recent moment", filters: [f("POV Bands")], category: "Stylize" },
  { name: "Pop Art", desc: "Warhol-style Ben-Day dots with flat posterized colors and glow", filters: [f("Pop art"), f("Posterize"), f("Bloom")], category: "Stylize" },
  { name: "Protest Poster", desc: "Bold stamped silhouette on warm paper with rough edges", filters: [f("Stamp"), f("Sharpen")], category: "Stylize" },
  { name: "Risograph", desc: "Multi-layer spot color separation with misregistration and grain", filters: [f("Risograph (multi-layer)"), f("Film grain"), f("Sharpen")], category: "Stylize" },
  { name: "Sketch", desc: "Pencil strokes following edge flow with soft vignette", filters: [f("Pencil sketch"), f("Sharpen"), f("Vignette")], category: "Stylize" },
  { name: "Sprite Sheet", desc: "Game-like chunky color blocks with bold sprite borders", filters: [f("Pixelate"), f("Pixel outline"), f("Posterize")], category: "Stylize" },
  { name: "Stained Glass", desc: "Voronoi cells with dark leading and glowing colored glass", filters: [f("Stained glass"), f("Edge glow"), f("Bloom")], category: "Stylize" },
  { name: "Stop-Mo Comic", desc: "Choppy held frames with flatter comic-style tones", filters: [f("Stop Motion"), f("Posterize")], category: "Stylize" },
  { name: "Triangle World", desc: "Faceted triangular cells with crisp low-poly structure", filters: [f("Triangle pixelate"), f("Sharpen")], category: "Stylize" },
  { name: "Watercolor", desc: "Soft wet-on-wet painting with outlined edges", filters: [f("Gaussian blur"), f("Kuwahara"), f("Watercolor bleed"), f("Posterize edges")], category: "Stylize" },
  { name: "Woodblock Print", desc: "Japanese woodblock style — sumi ink carved lines on cream", filters: [f("Woodcut (Ukiyo-e)"), f("Sharpen"), f("Vignette")], category: "Stylize" },

  { name: "Blueprint", desc: "Architectural line drawing — white lines on blue", filters: [f("Grayscale"), f("Contour lines"), f("Invert")], category: "Simulate" },
  { name: "Cyberpunk", desc: "Neon-soaked CRT with chromatic split and bloom glow", filters: [f("Chromatic posterize"), f("Chromatic aberration"), f("Bloom"), f("CRT emulation")], category: "Simulate" },
  { name: "Daguerreotype", desc: "1839 silver-plate photography with soft vignette and grain", filters: [f("Daguerreotype"), f("Vignette"), f("Film grain")], category: "Simulate" },
  { name: "Fax Machine", desc: "Thermal fax output — binary with scan artifacts and speckle", filters: [f("Fax machine"), f("Film grain"), f("Sharpen")], category: "Simulate" },
  { name: "Film Projector", desc: "Flickering 8mm home movie with gate weave and sprocket burns", filters: [f("Projection film"), f("Film grain"), f("Vignette"), f("Light leak")], category: "Simulate" },
  { name: "Frame Diff", desc: "Technical frame-to-frame motion highlight on a dark background", filters: [f("Motion Analysis", { renderMode: "DIFFERENCE", source: "PREVIOUS_FRAME" })], category: "Simulate" },
  { name: "Heat Vision", desc: "Motion detection with bloom glow — thermal camera aesthetic", filters: [f("Motion Analysis", { renderMode: "HEATMAP", source: "EMA" }), f("Bloom"), f("Color shift")], category: "Simulate" },
  { name: "Ink Spread", desc: "Cheap paper stock with dark regions bleeding into the fibers", filters: [f("Ink Bleed"), f("Sharpen")], category: "Simulate" },
  { name: "Lenticular Card", desc: "Holographic rainbow sheen with scanlines and glow", filters: [f("Lenticular"), f("Scanline"), f("Bloom")], category: "Simulate" },
  { name: "Lo-fi Webcam", desc: "Chunky pixels with JPEG artifacts and film grain", filters: [f("Pixelate"), f("JPEG artifact"), f("Film grain"), f("Vignette")], category: "Simulate" },
  { name: "Mavica Photo", desc: "Sony Mavica floppy disk camera — 640x480, heavy JPEG, CCD noise", filters: [f("Mavica FD7"), f("JPEG artifact"), f("Film grain")], category: "Simulate" },
  { name: "Matrix", desc: "Digital rain — source image visible through falling katakana characters", filters: [f("Levels"), f("Matrix rain")], category: "Simulate" },
  { name: "Misprint", desc: "Silkscreen poster layers drift slightly out of register over warm paper", filters: [f("Screen Print / Misregistration"), f("Film grain")], category: "Simulate" },
  { name: "Newsprint", desc: "Black-and-white newspaper with coarse halftone dots", filters: [f("Grayscale"), f("Newspaper"), f("Sharpen")], category: "Simulate" },
  { name: "Photocopier", desc: "High-contrast office copier with speckle and generation loss", filters: [f("Photocopier"), f("Film grain")], category: "Simulate" },
  { name: "Privacy Mode", desc: "Moving areas heavily pixelated and blurred", filters: [f("Motion pixelate"), f("Gaussian blur")], category: "Simulate" },
  { name: "Receipt Printer", desc: "Narrow thermal receipt — low-res dots with ink fade", filters: [f("Thermal printer"), f("Film grain")], category: "Simulate" },
  { name: "Retinal Burn", desc: "Bright objects leave complementary-colored after-images", filters: [f("After-image"), f("Bloom")], category: "Simulate" },
  { name: "Retro 3D", desc: "Classic red/cyan glasses effect with posterized comic contrast", filters: [f("Anaglyph 3D"), f("Sharpen")], category: "Simulate" },
  { name: "Retro TV", desc: "Consumer tape playback through a CRT tube with tracking wear and rounded-screen falloff", filters: [f("VHS emulation"), f("CRT emulation"), f("Vignette")], category: "Simulate" },
  { name: "Security Camera", desc: "Monochrome security feed with an explicit motion-analysis overlay for moving subjects", filters: [f("Grayscale"), f("Motion Analysis", { renderMode: "MASK", source: "EMA" }), f("Scanline"), f("Film grain")], category: "Simulate" },
  { name: "Shutter Smear", desc: "Slow-shutter averaging with soft tonal drag across motion", filters: [f("Temporal Exposure", { mode: "SHUTTER", windowSize: 8 }), f("Levels")], category: "Simulate" },
  { name: "Surveillance", desc: "Night-vision CCTV look with scanlines, compression, and no analysis overlay", filters: [f("Grayscale"), f("Night vision"), f("Scanline"), f("JPEG artifact")], category: "Simulate" },
  { name: "Surveillance Wall", desc: "Tiles updating at staggered rates with scanlines and grain", filters: [f("Time mosaic"), f("Scanline"), f("Film grain")], category: "Simulate" },
  { name: "Thermal", desc: "FLIR-style heat map with posterized temperature bands", filters: [f("Thermal camera"), f("Posterize"), f("Bloom")], category: "Simulate" },
  { name: "Underwater", desc: "Motion-reactive ripple distortion with chromatic split", filters: [f("Wake turbulence"), f("Chromatic aberration"), f("Bloom")], category: "Simulate" },

  { name: "Double Exposure", desc: "Classic film double exposure with bloom and tonal control", filters: [f("Blend"), f("Bloom"), f("Levels")], category: "Photo" },
  { name: "Noir", desc: "High-contrast black and white with grain and vignette", filters: [f("Grayscale"), f("Levels"), f("Sharpen"), f("Vignette"), f("Film grain")], category: "Photo" },
  { name: "Polaroid", desc: "Instant film look with faded edges and subtle grain", filters: [f("Polaroid"), f("Vignette"), f("Film grain")], category: "Photo" },
  { name: "Vintage Photo", desc: "Warm sepia toning with chemical grain and light bleed", filters: [f("Sepia"), f("Film grain"), f("Vignette"), f("Light leak")], category: "Photo" },
];

export const PRESET_CATEGORIES = [...new Set(CHAIN_PRESETS.map((preset) => preset.category))];

export const buildPresetSignatureMap = (resolveDefaults?: DefaultsResolver) => new Map(
  CHAIN_PRESETS.map((preset) => [getPresetSignature(preset.filters, resolveDefaults), preset] as const)
);
