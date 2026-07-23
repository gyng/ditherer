// Framework-free reference for cylindrical-mirror anamorphosis geometry. A
// reflective cylinder of radius R_c stands on the plane; a point at height z on
// the cylinder reflects, by the law of reflection, to a plane point at radius
// r = R_c + z·cot(α) for a viewer at elevation α — i.e. the radial map is
// LINEAR in the image height, not the arbitrary log/exp the old filter used.
// Angle is preserved (the mirror is rotationally symmetric). The GLSL chunk
// mirrors this so the shader and these unit-tested helpers agree.

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const finite = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

const TWO_PI = Math.PI * 2;

/**
 * Normalized source height for the anamorphic annulus (R_c ≤ r ≤ R_max): the
 * linear reflection map. 1 at the cylinder wall (nearest reflection), 0 at the
 * outer rim of the drawing. Linear in r, so the midpoint radius maps to 0.5 —
 * unlike a log map.
 */
export const anamorphAnnulusHeight = (r: number, cylR: number, maxR: number): number => {
  const span = Math.max(1e-3, finite(maxR) - finite(cylR));
  return clamp01((finite(maxR) - finite(r)) / span);
};

/**
 * Normalized source height for the inner mirror-preview disc (r < R_c): the
 * undistorted image wrapped onto the disc, 0 at the centre and 1 at the rim, so
 * it joins the annulus continuously at r = R_c (both give height 1 there).
 */
export const anamorphDiscHeight = (r: number, cylR: number): number =>
  clamp01(finite(r) / Math.max(1e-3, finite(cylR)));

/** Angle (plus twist) wrapped to a source column fraction in [0, 1). */
export const anamorphAngleU = (theta: number, twist: number): number => {
  const u = (finite(theta) + finite(twist)) / TWO_PI;
  return u - Math.floor(u);
};

// GLSL mirror (concatenate into a fragment shader).
export const ANAMORPH_GLSL = `
float am_annulusHeight(float r, float cylR, float maxR) {
  float span = max(1e-3, maxR - cylR);
  return clamp((maxR - r) / span, 0.0, 1.0);
}
float am_discHeight(float r, float cylR) {
  return clamp(r / max(1e-3, cylR), 0.0, 1.0);
}
float am_angleU(float theta, float twist) {
  float u = (theta + twist) / 6.28318530717958647;
  return u - floor(u);
}
`;
