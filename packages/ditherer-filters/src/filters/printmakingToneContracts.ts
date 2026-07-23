// Shared, framework-free tone math for the pen-and-ink and relief printmaking
// stylizers (Crosshatch, Engraving, Woodcut, Stipple). Every function here is
// pure and unit-tested; the GLSL chunk at the bottom mirrors the same math so
// the GPU shaders and the JS fallbacks agree in behaviour. The unifying idea
// (Winkenbach & Salesin 1994; Secord 2002) is that tone is reproduced by the
// *density of marks*, not by a hard luminance threshold: darker regions get
// more stroke layers / denser dots, and the total inked area tracks darkness.

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

export const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, finite(value)));

/** Rec. 709 luminance of an 8-bit RGB triple, normalised to 0..1. */
export const luminance01 = (r: number, g: number, b: number): number =>
  clamp01((0.2126 * finite(r) + 0.7152 * finite(g) + 0.0722 * finite(b)) / 255);

// ---------------------------------------------------------------------------
// Hatching — prioritized stroke textures (Winkenbach & Salesin 1994)
// ---------------------------------------------------------------------------

/** Peak inked fraction a single fully-developed hatch layer contributes. */
export const HATCH_LAYER_COVERAGE = 0.5;

/**
 * Within-layer fill for hatch layer `layerIndex` of `layerCount` as darkness
 * rises. Layer 0 fills across darkness [0, 1/count], layer 1 across
 * [1/count, 2/count], and so on, so lighter tones show only the first layer
 * and shadows accumulate every layer. Returns 0..1.
 */
export const hatchLayerFill = (
  darkness: number,
  layerIndex: number,
  layerCount: number,
): number => {
  const count = Math.max(1, Math.floor(finite(layerCount, 1)));
  const idx = Math.max(0, Math.floor(finite(layerIndex)));
  if (idx >= count) return 0;
  return clamp01(clamp01(darkness) * count - idx);
};

/**
 * Half-width (px) of a hatch line so a layer at spacing `spacing` reaches
 * `fill * HATCH_LAYER_COVERAGE` areal coverage. A parallel-line screen of
 * spacing S and full width w covers w / S, so the half-width is
 * 0.5 * coverage * spacing.
 */
export const hatchLineHalfWidthPx = (
  fill: number,
  spacing: number,
  maxCoverage: number = HATCH_LAYER_COVERAGE,
): number => {
  const s = Math.max(1e-3, finite(spacing, 1));
  return 0.5 * clamp01(fill) * clamp01(maxCoverage) * s;
};

/**
 * Statistical inked fraction of `layerCount` hatch layers at the given
 * darkness, treating layers as independent screens: 1 - Π(1 - p_k). Monotone
 * in darkness, ~0 at white and near-1 at black. This is the tone the shader
 * reproduces on a flat patch, and the anchor the contracts assert against.
 */
export const hatchUnionCoverage = (
  darkness: number,
  layerCount: number,
  maxCoverage: number = HATCH_LAYER_COVERAGE,
): number => {
  const count = Math.max(1, Math.floor(finite(layerCount, 1)));
  let clear = 1;
  for (let k = 0; k < count; k++) {
    clear *= 1 - hatchLayerFill(darkness, k, count) * clamp01(maxCoverage);
  }
  return clamp01(1 - clear);
};

/**
 * Anti-aliased areal coverage of a mark of half-width `halfWidth` at distance
 * `distToCenter`, with an `aa`-wide linear edge centred on the geometric edge
 * (½ coverage exactly at the edge). A zero-width mark contributes no ink, so
 * a tone with no developed strokes stays bare paper.
 */
export const lineCoverage = (
  distToCenter: number,
  halfWidth: number,
  aa = 1,
): number => {
  const hw = Math.max(0, finite(halfWidth));
  if (hw <= 0) return 0;
  const edge = Math.max(1e-3, finite(aa, 1));
  return clamp01((hw - Math.abs(finite(distToCenter))) / edge + 0.5);
};

// ---------------------------------------------------------------------------
// Orientation — structure tensor / edge-tangent flow (Kyprianidis 2013)
// ---------------------------------------------------------------------------

/**
 * Unit tangent along an edge given the luminance gradient (gx, gy): the
 * direction perpendicular to the gradient, so strokes run along contours.
 * Falls back to the horizontal axis on a flat neighbourhood.
 */
export const gradientTangent = (gx: number, gy: number): [number, number] => {
  const x = finite(gx);
  const y = finite(gy);
  const mag = Math.hypot(x, y);
  if (mag < 1e-4) return [1, 0];
  return [-y / mag, x / mag];
};

/**
 * Principal tangent angle (radians) of the 2×2 structure tensor
 * [[gxx, gxy], [gxy, gyy]] — the minor-eigenvector direction, along which
 * image structure is coherent. Used for form-following gouges/lines.
 */
export const structureTensorTangentAngle = (
  gxx: number,
  gyy: number,
  gxy: number,
): number => {
  const a = finite(gxx);
  const b = finite(gyy);
  const c = finite(gxy);
  // Major-eigenvector (gradient) orientation, then rotate 90° to the tangent.
  const gradientAngle = 0.5 * Math.atan2(2 * c, a - b);
  return gradientAngle + Math.PI / 2;
};

/** Tensor coherence 0..1: 1 where structure is strongly oriented, 0 isotropic. */
export const structureTensorCoherence = (
  gxx: number,
  gyy: number,
  gxy: number,
): number => {
  const a = finite(gxx);
  const b = finite(gyy);
  const c = finite(gxy);
  const trace = a + b;
  if (trace < 1e-8) return 0;
  const disc = Math.sqrt(Math.max(0, (a - b) * (a - b) + 4 * c * c));
  return clamp01(disc / trace);
};

// ---------------------------------------------------------------------------
// Engraving — swelling burin lines + dot-and-lozenge shadow structure
// ---------------------------------------------------------------------------

/**
 * Fill of each engraving tone structure as darkness rises: the primary burin
 * lines swell first, a crossing secondary set enters the mid-shadows, and a
 * lozenge/dot texture fills the deepest shadows — the classic copperplate
 * tone ladder. Each field is 0..1 and monotone in darkness.
 */
export const engravingShadowStructure = (
  darkness: number,
): { primaryFill: number; secondaryFill: number; lozengeFill: number } => {
  const d = clamp01(darkness);
  return {
    primaryFill: clamp01(d / 0.55),
    secondaryFill: clamp01((d - 0.4) / 0.4),
    lozengeFill: clamp01((d - 0.72) / 0.28),
  };
};

// ---------------------------------------------------------------------------
// Stipple — constant-radius, density-modulated dots (Secord 2002; Ulichney)
// ---------------------------------------------------------------------------

/**
 * Stipple dot radius (px). Deliberately independent of tone: stippling varies
 * dot *density*, not size (the previous filter grew the radius, which is
 * amplitude-modulated halftone, not stippling).
 */
export const stippleDotRadiusPx = (maxDotSize: number): number =>
  Math.max(0.5, 0.5 * Math.max(1, finite(maxDotSize, 1)));

/**
 * Whether a stipple cell carries a dot, given local darkness and the cell's
 * blue-noise threshold (both 0..1). Because thresholds are ~uniform, the
 * fraction of inked cells equals darkness — density tracks tone.
 */
export const stippleDotPresent = (
  darkness: number,
  blueNoiseThreshold: number,
): boolean => clamp01(darkness) > clamp01(blueNoiseThreshold);

/** Expected inked-cell density for a flat patch of the given darkness. */
export const stippleExpectedDensity = (darkness: number): number =>
  clamp01(darkness);

/** Anti-aliased coverage of a round dot at squared distance `distSq` (px²). */
export const dotCoverage = (distSq: number, radiusPx: number, aa = 0.75): number => {
  const dist = Math.sqrt(Math.max(0, finite(distSq)));
  return lineCoverage(dist, Math.max(0, finite(radiusPx)), aa);
};

// ---------------------------------------------------------------------------
// Shared GLSL — identical math for the fragment shaders
// ---------------------------------------------------------------------------

export const PRINTMAKING_TONE_GLSL = `
float pm_clamp01(float v) { return clamp(v, 0.0, 1.0); }
float pm_luma(vec3 c) { return pm_clamp01(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b); }

// Within-layer fill for hatch layer k of n as darkness rises.
float pm_hatchLayerFill(float darkness, float layerIndex, float layerCount) {
  if (layerIndex >= layerCount) return 0.0;
  return pm_clamp01(pm_clamp01(darkness) * layerCount - layerIndex);
}

// Half-width (px) so a spacing-S screen reaches fill*maxCoverage area.
float pm_hatchHalfWidth(float fill, float spacing, float maxCoverage) {
  return 0.5 * pm_clamp01(fill) * pm_clamp01(maxCoverage) * max(spacing, 1e-3);
}

// Anti-aliased mark coverage, ½ at the geometric edge; zero width => no ink.
float pm_lineCoverage(float distToCenter, float halfWidth, float aa) {
  if (halfWidth <= 0.0) return 0.0;
  return pm_clamp01((halfWidth - abs(distToCenter)) / max(aa, 1e-3) + 0.5);
}

// Unit tangent perpendicular to the gradient (runs along contours).
vec2 pm_gradientTangent(float gx, float gy) {
  float mag = length(vec2(gx, gy));
  if (mag < 1e-4) return vec2(1.0, 0.0);
  return vec2(-gy, gx) / mag;
}

// Principal tangent angle of the structure tensor [[gxx,gxy],[gxy,gyy]].
// atan(0,0) is spec-undefined, so a flat neighbourhood returns a stable axis.
float pm_tensorTangentAngle(float gxx, float gyy, float gxy) {
  if (abs(gxy) < 1e-8 && abs(gxx - gyy) < 1e-8) return 1.57079632679;
  return 0.5 * atan(2.0 * gxy, gxx - gyy) + 1.57079632679;
}
`;
