// Framework-free reference for the divergence projection that makes a velocity
// field incompressible (Jos Stam, "Stable Fluids", 1999). The GLSL passes in
// stableFluids.ts mirror this exact math — central-difference divergence, a
// Jacobi relaxation of the pressure Poisson equation ∇²p = div, and the
// velocity correction v ← v − ∇p. This module is pure and unit-tested so the
// projection is verified independently of the GPU path.

const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Central-difference divergence of a velocity field (Neumann boundary). */
export const divergence = (
  vx: Float32Array,
  vy: Float32Array,
  w: number,
  h: number,
): Float32Array => {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = clampInt(x - 1, 0, w - 1);
      const xr = clampInt(x + 1, 0, w - 1);
      const yd = clampInt(y - 1, 0, h - 1);
      const yt = clampInt(y + 1, 0, h - 1);
      out[y * w + x] = 0.5 * (vx[y * w + xr] - vx[y * w + xl] + (vy[yt * w + x] - vy[yd * w + x]));
    }
  }
  return out;
};

/** Jacobi relaxation solving ∇²p = div, starting from p = 0 (Neumann BC). */
export const jacobiPressure = (
  div: Float32Array,
  w: number,
  h: number,
  iterations: number,
): Float32Array => {
  let p = new Float32Array(w * h);
  let next = new Float32Array(w * h);
  const iters = Math.max(0, Math.floor(iterations));
  for (let k = 0; k < iters; k++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xl = clampInt(x - 1, 0, w - 1);
        const xr = clampInt(x + 1, 0, w - 1);
        const yd = clampInt(y - 1, 0, h - 1);
        const yt = clampInt(y + 1, 0, h - 1);
        next[y * w + x] =
          (p[y * w + xl] + p[y * w + xr] + p[yd * w + x] + p[yt * w + x] - div[y * w + x]) * 0.25;
      }
    }
    [p, next] = [next, p];
  }
  return p;
};

/** Subtract the pressure gradient from the velocity: v ← v − ∇p. */
export const subtractGradient = (
  vx: Float32Array,
  vy: Float32Array,
  p: Float32Array,
  w: number,
  h: number,
): { vx: Float32Array; vy: Float32Array } => {
  const outX = new Float32Array(vx);
  const outY = new Float32Array(vy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = clampInt(x - 1, 0, w - 1);
      const xr = clampInt(x + 1, 0, w - 1);
      const yd = clampInt(y - 1, 0, h - 1);
      const yt = clampInt(y + 1, 0, h - 1);
      outX[y * w + x] = vx[y * w + x] - 0.5 * (p[y * w + xr] - p[y * w + xl]);
      outY[y * w + x] = vy[y * w + x] - 0.5 * (p[yt * w + x] - p[yd * w + x]);
    }
  }
  return { vx: outX, vy: outY };
};

/** Full projection: make the velocity field (approximately) divergence-free. */
export const projectVelocity = (
  vx: Float32Array,
  vy: Float32Array,
  w: number,
  h: number,
  iterations: number,
): { vx: Float32Array; vy: Float32Array } => {
  const div = divergence(vx, vy, w, h);
  const p = jacobiPressure(div, w, h, iterations);
  return subtractGradient(vx, vy, p, w, h);
};

/** Largest absolute divergence over the interior (excluding the 1px border). */
export const maxInteriorDivergence = (
  vx: Float32Array,
  vy: Float32Array,
  w: number,
  h: number,
): number => {
  const div = divergence(vx, vy, w, h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      max = Math.max(max, Math.abs(div[y * w + x]));
    }
  }
  return max;
};
