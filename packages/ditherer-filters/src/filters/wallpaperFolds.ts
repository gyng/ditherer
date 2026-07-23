// Framework-free reference for the wallpaper-group fundamental-domain folds used
// by Wallpaper Tiling. Each fold reduces a plane point (relative to the tiling
// centre, in pixels) into that group's fundamental domain; the tiling therefore
// carries exactly that group's symmetry. The GLSL chunk mirrors these so the
// shader and the unit tests (which check the actual crystallographic
// invariances) agree. Key fix: P2 is a genuine 180° ROTATION (no mirror lines),
// not the per-axis reflection that made it identical to PMM; P6M is a real
// hexagonal (6-fold + mirror) kaleidoscope, not an "approximate triangular fold".

const SQRT3 = Math.sqrt(3);

const modPos = (v: number, m: number): number => {
  const r = v % m;
  return r < 0 ? r + m : r;
};

const foldReflect = (v: number, size: number): number => {
  const m = modPos(v, 2 * size);
  return m < size ? m : 2 * size - m;
};

/** P1 (o): pure translation. */
export const foldP1 = (x: number, y: number, sz: number): [number, number] =>
  [modPos(x, sz), modPos(y, sz)];

/**
 * P2 (2222): 180° rotation, NO mirror lines. Cell is 2·sz × sz; the right half
 * is the 180° rotation of the left about (sz, sz/2), so both coordinates
 * transform together (a rotation) — unlike PMM which reflects each axis.
 */
export const foldP2 = (x: number, y: number, sz: number): [number, number] => {
  let fx = modPos(x, 2 * sz);
  let fy = modPos(y, sz);
  if (fx >= sz) { fx = 2 * sz - fx; fy = sz - fy; }
  return [fx, fy];
};

/** PMM (*2222): mirror lines on both axes. */
export const foldPMM = (x: number, y: number, sz: number): [number, number] =>
  [foldReflect(x, sz), foldReflect(y, sz)];

/** P4M (*442): square kaleidoscope — mirrors on both axes plus the diagonal. */
export const foldP4M = (x: number, y: number, sz: number): [number, number] => {
  let fx = foldReflect(x, sz);
  let fy = foldReflect(y, sz);
  if (fy > fx) { const t = fx; fx = fy; fy = t; }
  return [fx, fy];
};

/** Round axial hex coords (q, r) to the nearest hex-lattice centre. */
const hexRound = (q: number, r: number): [number, number] => {
  const x = q, z = r, y = -x - z;
  let rx = Math.round(x), rz = Math.round(z);
  const ry = Math.round(y);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  // Reset the axis with the largest rounding error to keep x+y+z=0. When that
  // is the (unreturned) y axis, rx and rz already stand.
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dz >= dy) rz = -rx - ry;
  return [rx, rz];
};

/**
 * P6M (*632): hexagonal 6-fold + mirror kaleidoscope. Reduce to the nearest
 * 6-fold centre on the triangular lattice, then fold the offset angle into a 30°
 * wedge (6 rotations × mirror = the D6 point group). The result is invariant
 * under 60° rotation, a mirror, and the hex lattice translations.
 */
export const foldP6M = (x: number, y: number, sz: number): [number, number] => {
  // Cartesian -> axial (basis a1=(1,0), a2=(1/2, √3/2), scaled by sz).
  const q = (x - y / SQRT3) / sz;
  const r = (y * 2 / SQRT3) / sz;
  const [cq, cr] = hexRound(q, r);
  const cx = (cq + cr / 2) * sz;
  const cy = (cr * SQRT3 / 2) * sz;
  const dx = x - cx, dy = y - cy;
  const rr = Math.hypot(dx, dy);
  let a = rr > 0 ? Math.atan2(dy, dx) : 0;
  a = modPos(a, Math.PI / 3);        // 6-fold
  a = Math.abs(a - Math.PI / 6);     // mirror within the 60° sector -> [0, 30°]
  // Map the wedge point into [0, sz]² for source sampling (deterministic from
  // the invariant offset, so the sampled pattern inherits the symmetry).
  const fx = rr * Math.cos(a);
  const fy = rr * Math.sin(a);
  return [Math.min(sz, fx * SQRT3), Math.min(sz, fy * 2 * SQRT3)];
};

// GLSL mirror (concatenate into a fragment shader). Signatures match the shader
// usage: each returns the folded coordinate in pixels.
export const WALLPAPER_FOLDS_GLSL = `
float wf_modPos(float v, float m) { float r = mod(v, m); return r < 0.0 ? r + m : r; }
float wf_foldReflect(float v, float sz) {
  float m = wf_modPos(v, 2.0 * sz);
  return m < sz ? m : 2.0 * sz - m;
}
vec2 wf_p1(vec2 p, float sz) { return vec2(wf_modPos(p.x, sz), wf_modPos(p.y, sz)); }
vec2 wf_p2(vec2 p, float sz) {
  float fx = wf_modPos(p.x, 2.0 * sz);
  float fy = wf_modPos(p.y, sz);
  if (fx >= sz) { fx = 2.0 * sz - fx; fy = sz - fy; }
  return vec2(fx, fy);
}
vec2 wf_pmm(vec2 p, float sz) { return vec2(wf_foldReflect(p.x, sz), wf_foldReflect(p.y, sz)); }
vec2 wf_p4m(vec2 p, float sz) {
  float fx = wf_foldReflect(p.x, sz);
  float fy = wf_foldReflect(p.y, sz);
  if (fy > fx) { float t = fx; fx = fy; fy = t; }
  return vec2(fx, fy);
}
vec2 wf_p6m(vec2 p, float sz) {
  const float S3 = 1.7320508075688772;
  float q = (p.x - p.y / S3) / sz;
  float r = (p.y * 2.0 / S3) / sz;
  // hex round (cube)
  float cx3 = q, cz3 = r, cy3 = -q - r;
  float rx = floor(cx3 + 0.5), ry = floor(cy3 + 0.5), rz = floor(cz3 + 0.5);
  float dx3 = abs(rx - cx3), dy3 = abs(ry - cy3), dz3 = abs(rz - cz3);
  if (dx3 > dy3 && dx3 > dz3) rx = -ry - rz;
  else if (dy3 > dz3) ry = -rx - rz;
  else rz = -rx - ry;
  float cq = rx, cr = rz;
  float cx = (cq + cr / 2.0) * sz;
  float cy = (cr * S3 / 2.0) * sz;
  vec2 d = p - vec2(cx, cy);
  float rr = length(d);
  float a = rr > 0.0 ? atan(d.y, d.x) : 0.0;   // atan(0,0) is spec-undefined
  a = wf_modPos(a, 3.14159265358979 / 3.0);
  a = abs(a - 3.14159265358979 / 6.0);
  return vec2(min(sz, rr * cos(a) * S3), min(sz, rr * sin(a) * 2.0 * S3));
}
`;
