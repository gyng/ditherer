// Framework-free reference for the divergence-free curl-noise turbulence used by
// Wake Turbulence. A 2-D field taken as the curl of a scalar potential ψ —
// v = (∂ψ/∂y, −∂ψ/∂x) — is divergence-free (incompressible), the defining
// property of real turbulent flow (Bridson et al., "Curl-Noise for Procedural
// Fluid Flow", 2007). The old warp used a stationary axis-aligned sinusoid,
// which is neither turbulent nor incompressible. The GLSL chunk mirrors this so
// the shader and these unit tests agree.

const hash2 = (x: number, y: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise in [0,1] over a unit lattice. */
export const valueNoise = (x: number, y: number): number => {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const a = hash2(ix, iy),
    b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1),
    d = hash2(ix + 1, iy + 1);
  const ux = smooth(fx),
    uy = smooth(fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};

/**
 * Divergence-free curl of the value-noise potential at (x, y):
 * v = (∂ψ/∂y, −∂ψ/∂x), estimated by central differences with step `eps`.
 */
export const curlNoise = (x: number, y: number, eps = 1): [number, number] => {
  const e = Math.max(1e-3, eps);
  const dpdx = (valueNoise(x + e, y) - valueNoise(x - e, y)) / (2 * e);
  const dpdy = (valueNoise(x, y + e) - valueNoise(x, y - e)) / (2 * e);
  return [dpdy, -dpdx];
};

/**
 * Discrete divergence of the curl field at (x, y). Uses the SAME step for the
 * inner curl gradient and the outer divergence difference, so the mixed second
 * differences cancel exactly for a curl field (~0). A gradient/curl-free field
 * would instead evaluate to the Laplacian (non-zero) — which is the point.
 */
export const curlDivergence = (x: number, y: number, h = 1): number => {
  const [vxp] = curlNoise(x + h, y, h);
  const [vxm] = curlNoise(x - h, y, h);
  const vyp = curlNoise(x, y + h, h)[1];
  const vym = curlNoise(x, y - h, h)[1];
  return (vxp - vxm) / (2 * h) + (vyp - vym) / (2 * h);
};

// GLSL mirror (concatenate into a fragment shader).
export const TURBULENCE_GLSL = `
float tf_hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float tf_valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  float a = tf_hash2(i);
  float b = tf_hash2(i + vec2(1.0, 0.0));
  float c = tf_hash2(i + vec2(0.0, 1.0));
  float d = tf_hash2(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
// Divergence-free curl of the noise potential.
vec2 tf_curlNoise(vec2 p, float eps) {
  float e = max(1e-3, eps);
  float dpdx = (tf_valueNoise(p + vec2(e, 0.0)) - tf_valueNoise(p - vec2(e, 0.0))) / (2.0 * e);
  float dpdy = (tf_valueNoise(p + vec2(0.0, e)) - tf_valueNoise(p - vec2(0.0, e))) / (2.0 * e);
  return vec2(dpdy, -dpdx);
}
`;
