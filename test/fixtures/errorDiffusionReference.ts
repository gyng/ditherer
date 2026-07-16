// Independent reference implementations of the error-diffusion kernels.
//
// Written from the published definitions (Floyd & Steinberg 1976; Tanner
// Helland's survey, which the filter's own comments cite) rather than from the
// filter's code — the point is to have something that disagrees when the
// implementation drifts. The offsets below are hardcoded per kernel; the
// implementation derives them from a matrix + an offset vector, so the two
// arrive at the same place by different routes.
//
// Scope is deliberately the simplest configuration: left-to-right scanline (no
// serpentine), no linearize, no temporal carryover. Those variations are the
// implementation's own; what this pins is the core diffusion.
//
// Error accumulates in a Float32Array because the implementation does too
// (errorDiffusingFilterFactory keeps `errBuf` as Float32Array). That's matching
// numeric precision, not borrowing the algorithm — a Float64 reference would
// disagree in the last bits for reasons that aren't bugs.

export type Tap = { dx: number; dy: number; w: number };

// [_, *, 7/16] / [3/16, 5/16, 1/16]
export const FLOYD_STEINBERG: Tap[] = [
  { dx: 1, dy: 0, w: 7 / 16 },
  { dx: -1, dy: 1, w: 3 / 16 },
  { dx: 0, dy: 1, w: 5 / 16 },
  { dx: 1, dy: 1, w: 1 / 16 },
];

//     X 7 5
// 3 5 7 5 3
// 1 3 5 3 1   (1/48)
export const JARVIS: Tap[] = [
  { dx: 1, dy: 0, w: 7 / 48 }, { dx: 2, dy: 0, w: 5 / 48 },
  { dx: -2, dy: 1, w: 3 / 48 }, { dx: -1, dy: 1, w: 5 / 48 }, { dx: 0, dy: 1, w: 7 / 48 },
  { dx: 1, dy: 1, w: 5 / 48 }, { dx: 2, dy: 1, w: 3 / 48 },
  { dx: -2, dy: 2, w: 1 / 48 }, { dx: -1, dy: 2, w: 3 / 48 }, { dx: 0, dy: 2, w: 5 / 48 },
  { dx: 1, dy: 2, w: 3 / 48 }, { dx: 2, dy: 2, w: 1 / 48 },
];

//     X 8 4
// 2 4 8 4 2
// 1 2 4 2 1   (1/42)
export const STUCKI: Tap[] = [
  { dx: 1, dy: 0, w: 8 / 42 }, { dx: 2, dy: 0, w: 4 / 42 },
  { dx: -2, dy: 1, w: 2 / 42 }, { dx: -1, dy: 1, w: 4 / 42 }, { dx: 0, dy: 1, w: 8 / 42 },
  { dx: 1, dy: 1, w: 4 / 42 }, { dx: 2, dy: 1, w: 2 / 42 },
  { dx: -2, dy: 2, w: 1 / 42 }, { dx: -1, dy: 2, w: 2 / 42 }, { dx: 0, dy: 2, w: 4 / 42 },
  { dx: 1, dy: 2, w: 2 / 42 }, { dx: 2, dy: 2, w: 1 / 42 },
];

// X 8 4
// 2 4 8 4 2   (1/32)
export const BURKES: Tap[] = [
  { dx: 1, dy: 0, w: 8 / 32 }, { dx: 2, dy: 0, w: 4 / 32 },
  { dx: -2, dy: 1, w: 2 / 32 }, { dx: -1, dy: 1, w: 4 / 32 }, { dx: 0, dy: 1, w: 8 / 32 },
  { dx: 1, dy: 1, w: 4 / 32 }, { dx: 2, dy: 1, w: 2 / 32 },
];

//   X 5 3
// 2 4 5 4 2
//   2 3 2     (1/32)
export const SIERRA: Tap[] = [
  { dx: 1, dy: 0, w: 5 / 32 }, { dx: 2, dy: 0, w: 3 / 32 },
  { dx: -2, dy: 1, w: 2 / 32 }, { dx: -1, dy: 1, w: 4 / 32 }, { dx: 0, dy: 1, w: 5 / 32 },
  { dx: 1, dy: 1, w: 4 / 32 }, { dx: 2, dy: 1, w: 2 / 32 },
  { dx: -1, dy: 2, w: 2 / 32 }, { dx: 0, dy: 2, w: 3 / 32 }, { dx: 1, dy: 2, w: 2 / 32 },
];

//   X 4 3
// 1 2 3 2 1   (1/16)
export const SIERRA_2: Tap[] = [
  { dx: 1, dy: 0, w: 4 / 16 }, { dx: 2, dy: 0, w: 3 / 16 },
  { dx: -2, dy: 1, w: 1 / 16 }, { dx: -1, dy: 1, w: 2 / 16 }, { dx: 0, dy: 1, w: 3 / 16 },
  { dx: 1, dy: 1, w: 2 / 16 }, { dx: 2, dy: 1, w: 1 / 16 },
];

//   X 2
// 1 1         (1/4)
export const SIERRA_LITE: Tap[] = [
  { dx: 1, dy: 0, w: 2 / 4 },
  { dx: -1, dy: 1, w: 1 / 4 }, { dx: 0, dy: 1, w: 1 / 4 },
];

//   X 1 1
// 1 1 1
//   1         (1/8 — deliberately sums to 6/8, see below)
export const ATKINSON: Tap[] = [
  { dx: 1, dy: 0, w: 1 / 8 }, { dx: 2, dy: 0, w: 1 / 8 },
  { dx: -1, dy: 1, w: 1 / 8 }, { dx: 0, dy: 1, w: 1 / 8 }, { dx: 1, dy: 1, w: 1 / 8 },
  { dx: 0, dy: 2, w: 1 / 8 },
];

// Quantize to `levels` evenly spaced steps per channel — mirrors the `nearest`
// palette, which is what these filters use by default.
export const quantizeChannel = (value: number, levels: number): number => {
  if (levels >= 256) return value;
  const step = 255 / (levels - 1);
  return Math.round(Math.round(value / step) * step);
};

// Textbook scanline error diffusion: visit left-to-right top-to-bottom, quantize
// the accumulated value, push the residual onto not-yet-visited neighbours.
export const diffuse = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  taps: Tap[],
  levels = 2,
): Uint8ClampedArray => {
  const err = new Float32Array(rgba);
  const out = new Uint8ClampedArray(rgba.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const old = err[i + c];
        const next = quantizeChannel(old, levels);
        out[i + c] = next;
        const residual = old - next;
        for (const { dx, dy, w } of taps) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
          const ti = (ty * width + tx) * 4 + c;
          err[ti] = err[ti] + residual * w;
        }
      }
      out[i + 3] = rgba[i + 3];
    }
  }
  return out;
};
