export const NTSC_RATE = (315_000_000 / 88) * 4;
export const FIR_TAPS = 65;

export type TapeSpeed = "NONE" | "SP" | "LP" | "EP";
export type TapeFilterType = "BUTTERWORTH" | "CONSTANT_K";

export type TapeProfile = {
  lumaCutoff: number;
  chromaCutoff: number;
  chromaDelay: number;
};

export const TAPE_PROFILES: Record<TapeSpeed, TapeProfile> = {
  NONE: { lumaCutoff: 0, chromaCutoff: 0, chromaDelay: 0 },
  SP: { lumaCutoff: 2_400_000, chromaCutoff: 320_000, chromaDelay: 4 },
  LP: { lumaCutoff: 1_900_000, chromaCutoff: 300_000, chromaDelay: 5 },
  EP: { lumaCutoff: 1_400_000, chromaCutoff: 280_000, chromaDelay: 6 },
};

type Transfer = { num: number[]; den: number[] };

const constantK = (cutoff: number): Transfer => {
  const dt = 1 / NTSC_RATE;
  const tau = 1 / (cutoff * 2 * Math.PI);
  const alpha = dt / (tau + dt);
  return { num: [alpha], den: [-(1 - alpha)] };
};

const constantKAtRate = (cutoff: number, rate: number): Transfer => {
  const dt = 1 / rate;
  const tau = 1 / (cutoff * 2 * Math.PI);
  const alpha = dt / (tau + dt);
  return { num: [alpha], den: [-(1 - alpha)] };
};

const butterworth = (cutoff: number): Transfer => {
  const frequency = Math.min(2 * cutoff, NTSC_RATE) / NTSC_RATE * Math.PI;
  const sin = Math.sin(frequency);
  const cos = Math.cos(frequency);
  const alpha = sin / (2 * Math.SQRT1_2);
  const gain = 1 / (1 + alpha);
  return {
    num: [
      (1 - cos) * 0.5 * gain,
      (1 - cos) * gain,
      (1 - cos) * 0.5 * gain,
    ],
    den: [-2 * cos * gain, (1 - alpha) * gain],
  };
};

const impulse = (transfer: Transfer, taps: number): Float32Array => {
  const state = new Float64Array(Math.max(transfer.num.length, transfer.den.length + 1));
  const result = new Float32Array(taps);
  for (let n = 0; n < taps; n++) {
    const sample = n === 0 ? 1 : 0;
    const value = state[0] + transfer.num[0] * sample;
    for (let i = 0; i < state.length - 1; i++) {
      state[i] = state[i + 1]
        + (transfer.num[i + 1] ?? 0) * sample
        - (transfer.den[i] ?? 0) * value;
    }
    result[n] = value;
  }
  return result;
};

const convolve = (a: Float32Array, b: Float32Array, taps: number): Float32Array => {
  const result = new Float32Array(taps);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length && i + j < taps; j++) {
      result[i + j] += a[i] * b[j];
    }
  }
  return result;
};

const normalizeDc = (kernel: Float32Array): Float32Array => {
  const sum = kernel.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || Math.abs(sum) < 1e-12) return kernel;
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
};

const withScale = (transfer: Transfer, scale: number): Transfer => {
  const length = transfer.den.length + 1;
  const num = new Array<number>(length).fill(0);
  num[0] = scale * transfer.num[0] + (1 - scale);
  for (let i = 1; i < length; i++) {
    num[i] = scale * (transfer.num[i] ?? 0) + (1 - scale) * transfer.den[i - 1];
  }
  return { num, den: [...transfer.den] };
};

export const makeLowpassKernel = (
  cutoff: number,
  filterType: TapeFilterType,
  taps = FIR_TAPS,
): Float32Array => {
  if (cutoff <= 0) {
    const identity = new Float32Array(taps);
    identity[0] = 1;
    return identity;
  }
  if (filterType === "BUTTERWORTH") {
    return normalizeDc(impulse(butterworth(cutoff), taps));
  }
  const single = impulse(constantK(cutoff), taps);
  return normalizeDc(convolve(convolve(single, single, taps), single, taps));
};

export const makeRestorationKernel = (cutoff: number, taps = 17): Float32Array =>
  normalizeDc(impulse(withScale(constantK(cutoff), -1.6), taps));

export const makeCompositePreemphasisKernel = (
  intensity: number,
  taps = 17,
): Float32Array => {
  if (intensity === 0) return makeLowpassKernel(0, "BUTTERWORTH", taps);
  const cutoff = 315_000_000 / 88 / 2;
  return normalizeDc(impulse(withScale(constantK(cutoff), -intensity), taps));
};

export const makeSharpenKernel = (
  cutoff: number,
  filterType: TapeFilterType,
  intensity: number,
  frequency = 1,
  taps = 17,
): Float32Array => {
  const multiplier = filterType === "CONSTANT_K" ? 4 : 1;
  const base = filterType === "BUTTERWORTH"
    ? butterworth(cutoff * multiplier * frequency)
    : constantK(cutoff * multiplier * frequency);
  return normalizeDc(impulse(withScale(base, -intensity * 2 * frequency), taps));
};

export const makeLumaSmearKernel = (amount: number, taps = 17): Float32Array => {
  if (amount <= 0) return makeLowpassKernel(0, "BUTTERWORTH", taps);
  const cutoff = Math.pow(2, -4 * amount) * 0.25;
  return normalizeDc(impulse(constantKAtRate(cutoff, 1), taps));
};

export const makeNotchKernel = (
  frequency = 0.45,
  power = 4,
  scale = 1,
  taps = 17,
): Float32Array => {
  if (scale <= 0) return makeLowpassKernel(0, "BUTTERWORTH", taps);
  const normalizedFrequency = Math.min(1, Math.max(0, frequency));
  const bandwidth = normalizedFrequency / Math.max(power, 1e-4) * Math.PI;
  const radians = normalizedFrequency * Math.PI;
  const beta = Math.tan(bandwidth * 0.5);
  const gain = 1 / (1 + beta);
  const notch: Transfer = {
    num: [gain, -2 * Math.cos(radians) * gain, gain],
    den: [-2 * Math.cos(radians) * gain, 2 * gain - 1],
  };
  return normalizeDc(impulse(withScale(notch, scale), taps));
};

export const makeRingingKernel = (
  frequency = 0.45,
  power = 4,
  intensity = 4,
  taps = 17,
): Float32Array => makeNotchKernel(frequency, power, intensity, taps);

export const frequencyMagnitude = (kernel: ArrayLike<number>, radians: number): number => {
  let real = 0;
  let imaginary = 0;
  for (let i = 0; i < kernel.length; i++) {
    real += kernel[i] * Math.cos(radians * i);
    imaginary -= kernel[i] * Math.sin(radians * i);
  }
  return Math.hypot(real, imaginary);
};

export const applyCausalKernel = (
  signal: ArrayLike<number>,
  kernel: ArrayLike<number>,
  advance = 0,
): Float32Array => {
  const output = new Float32Array(signal.length);
  for (let x = 0; x < signal.length; x++) {
    let value = 0;
    for (let k = 0; k < kernel.length; k++) {
      const sourceX = Math.min(signal.length - 1, Math.max(0, x + advance - k));
      value += signal[sourceX] * kernel[k];
    }
    output[x] = value;
  }
  return output;
};

export type ConformancePattern = "impulse" | "step" | "smpte" | "zonePlate" | "alternatingLines";

export const makeConformancePattern = (
  pattern: ConformancePattern,
  width: number,
  height: number,
): Float32Array => {
  const pixels = new Float32Array(width * height * 3);
  const bars = [
    [0.75, 0.75, 0.75], [0.75, 0.75, 0], [0, 0.75, 0.75], [0, 0.75, 0],
    [0.75, 0, 0.75], [0.75, 0, 0], [0, 0, 0.75], [0, 0, 0],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rgb: number[];
      if (pattern === "impulse") {
        const value = x === Math.floor(width / 3) ? 1 : 0;
        rgb = [value, value, value];
      } else if (pattern === "step") {
        const value = x >= Math.floor(width / 3) ? 1 : 0;
        rgb = [value, value, value];
      } else if (pattern === "smpte") {
        rgb = bars[Math.min(7, Math.floor(x * 8 / width))];
      } else if (pattern === "alternatingLines") {
        const value = y % 2;
        rgb = [value, value, value];
      } else {
        const nx = (x - width / 2) / Math.max(1, width / 2);
        const ny = (y - height / 2) / Math.max(1, height / 2);
        const phase = Math.PI * width * 0.25 * (nx * nx + ny * ny);
        const value = Math.cos(phase) * 0.5 + 0.5;
        rgb = [value, value, value];
      }
      pixels.set(rgb, (y * width + x) * 3);
    }
  }
  return pixels;
};

export const peakIndex = (signal: ArrayLike<number>): number => {
  let index = 0;
  for (let i = 1; i < signal.length; i++) if (signal[i] > signal[index]) index = i;
  return index;
};

export const stepOvershoot = (signal: ArrayLike<number>, steadyState = 1): number => {
  let maximum = -Infinity;
  for (let i = 0; i < signal.length; i++) maximum = Math.max(maximum, signal[i]);
  return maximum - steadyState;
};

export const alternatingLineEnergy = (signal: ArrayLike<number>, width: number): number => {
  const height = Math.floor(signal.length / width);
  if (height < 2) return 0;
  let energy = 0;
  let samples = 0;
  for (let y = 1; y < height; y++) {
    for (let x = 0; x < width; x++) {
      energy += Math.abs(signal[y * width + x] - signal[(y - 1) * width + x]);
      samples++;
    }
  }
  return energy / Math.max(1, samples);
};

const MASK_64 = 0xffff_ffff_ffff_ffffn;
const PHI = 0x9e37_79b9_7f4a_7c15n;

const finalizeU64 = (input: bigint): bigint => {
  let state = input & MASK_64;
  state = ((state ^ (state >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK_64;
  state = ((state ^ (state >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK_64;
  return (state ^ (state >> 31n)) & MASK_64;
};

const finalizeU32 = (input: bigint): number => {
  let state = input & MASK_64;
  state = ((state ^ (state >> 33n)) * 0x62a9_d9ed_7997_055fn) & MASK_64;
  state = ((state ^ (state >> 28n)) * 0xcb24_d0a5_c88c_35b3n) & MASK_64;
  return Number((state >> 32n) & 0xffff_ffffn) >>> 0;
};

export class SplitMix64 {
  private state: bigint;

  constructor(seed: number | bigint) {
    this.state = BigInt.asUintN(64, BigInt(seed));
  }

  clone(): SplitMix64 {
    return new SplitMix64(this.state);
  }

  nextU64(): bigint {
    this.state = (this.state + PHI) & MASK_64;
    return finalizeU64(this.state);
  }

  nextU32(): number {
    this.state = (this.state + PHI) & MASK_64;
    return finalizeU32(this.state);
  }

  nextFloat(): number {
    return (this.nextU32() >>> 8) * (1 / 16_777_216);
  }

  mix(input: number | bigint): SplitMix64 {
    const mixed = new SplitMix64((this.state + BigInt(input)) & MASK_64);
    return new SplitMix64(mixed.nextU64());
  }
}

const hash1d = (input: number): number => {
  let value = (input ^ 2_747_636_419) >>> 0;
  value = Math.imul(value, 2_654_435_769) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 2_654_435_769) >>> 0;
  return Math.imul(value ^ (value >>> 16), 2_654_435_769) >>> 0;
};

export const simplex1d = (x: number, seed: number): number => {
  const i0 = Math.floor(x);
  const x0 = x - i0;
  const x1 = x0 - 1;
  const gradient = (cell: number): number => {
    const h = hash1d((cell ^ seed) >>> 0) >>> 28;
    const magnitude = (h & 7) + 1;
    return (h & 8) === 0 ? magnitude : -magnitude;
  };
  const contribution = (distance: number, cell: number): number => {
    const t = 1 - distance * distance;
    return t * t * t * t * gradient(cell) * distance;
  };
  return contribution(x0, i0) + contribution(x1, i0 + 1);
};

const pcg3d = (x: number, y: number, z: number): [number, number, number] => {
  let vx = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
  let vy = (Math.imul(y, 1_664_525) + 1_013_904_223) >>> 0;
  let vz = (Math.imul(z, 1_664_525) + 1_013_904_223) >>> 0;
  vx = (vx + Math.imul(vy, vz)) >>> 0;
  vy = (vy + Math.imul(vz, vx)) >>> 0;
  vz = (vz + Math.imul(vx, vy)) >>> 0;
  vx = (vx ^ (vx >>> 16)) >>> 0;
  vy = (vy ^ (vy >>> 16)) >>> 0;
  vz = (vz ^ (vz >>> 16)) >>> 0;
  vx = (vx + Math.imul(vy, vz)) >>> 0;
  vy = (vy + Math.imul(vz, vx)) >>> 0;
  vz = (vz + Math.imul(vx, vy)) >>> 0;
  return [vx, vy, vz];
};

export const simplex2d = (x: number, y: number, seed: number): number => {
  const skew = (Math.sqrt(3) - 1) * 0.5;
  const unskew = (1 - 1 / Math.sqrt(3)) * 0.5;
  const s = (x + y) * skew;
  const ips = Math.floor(x + s);
  const jps = Math.floor(y + s);
  const t = (ips + jps) * unskew;
  const x0 = x - (ips - t);
  const y0 = y - (jps - t);
  const i1 = x0 >= y0 ? 1 : 0;
  const j1 = y0 > x0 ? 1 : 0;
  const corners = [
    [ips, jps, x0, y0],
    [ips + i1, jps + j1, x0 - i1 + unskew, y0 - j1 + unskew],
    [ips + 1, jps + 1, x0 - 1 + 2 * unskew, y0 - 1 + 2 * unskew],
  ];
  let value = 0;
  for (const [i, j, dx, dy] of corners) {
    const hash = pcg3d(i >>> 0, j >>> 0, seed >>> 0)[0];
    const h = hash & 7;
    const swap = h < 4;
    const xMagnitude = swap ? 1 : 2;
    const yMagnitude = swap ? 2 : 1;
    const gxPositive = swap ? (h & 1) === 0 : (h & 2) === 0;
    const gyPositive = swap ? (h & 2) === 0 : (h & 1) === 0;
    const gradient = (gxPositive ? xMagnitude : -xMagnitude) * dx
      + (gyPositive ? yMagnitude : -yMagnitude) * dy;
    const weight = Math.max(0, 0.5 - dx * dx - dy * dy);
    value += weight * weight * weight * weight * gradient;
  }
  return value;
};

const fbm1d = (x: number, seed: number, octaves: number, gain: number, frequency: number): number => {
  let coordinate = x * frequency;
  let value = simplex1d(coordinate, seed);
  let amplitude = gain;
  for (let octave = 1; octave < octaves; octave++) {
    coordinate *= 2;
    value += simplex1d(coordinate, seed) * amplitude;
    amplitude *= gain;
  }
  return value;
};

const fbm2d = (
  x: number,
  y: number,
  seed: number,
  octaves: number,
  gain: number,
  frequency: number,
): number => {
  let px = x * frequency;
  let py = y * frequency;
  let value = simplex2d(px, py, seed);
  let amplitude = gain;
  for (let octave = 1; octave < octaves; octave++) {
    px *= 2;
    py *= 2;
    value += simplex2d(px, py, seed) * amplitude;
    amplitude *= gain;
  }
  return value;
};

export type NoisePlane = { data: Float32Array; width: number; height: number };

// RGBA = composite FBM, luma FBM, chroma-I FBM, chroma-Q FBM.
// Streams use the same pass IDs and SplitMix64 mixing order as ntsc-rs.
export const makeNoisePlane = (
  width: number,
  height: number,
  seed: number,
  frame: number,
): NoisePlane => {
  const data = new Float32Array(width * height * 4);
  const streamIds = [0, 10, 1, 9] as const;
  for (let y = 0; y < height; y++) {
    const streams = streamIds.map((streamId) => {
      const row = new SplitMix64(seed).mix(streamId).mix(frame).mix(y);
      return { seed: row.nextU32() | 0, offset: row.nextFloat() * width };
    });
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      data[index] = fbm1d(x + streams[0].offset, streams[0].seed, 1, 1, 0.5) * 0.25;
      data[index + 1] = fbm1d(x + streams[1].offset, streams[1].seed, 1, 1, 0.5) * 0.25;
      data[index + 2] = fbm1d(x + streams[2].offset, streams[2].seed, 2, 1, 0.05) * 0.25;
      data[index + 3] = fbm1d(x + streams[3].offset, streams[3].seed, 2, 1, 0.05) * 0.25;
    }
  }
  return { data, width, height };
};

// R = chroma phase stream, G = exact geometric chroma-loss events,
// B = smooth edge-wave simplex, A = head-switching row jitter.
export const makeRowNoisePlane = (
  height: number,
  seed: number,
  frame: number,
  chromaLoss: number,
): NoisePlane => {
  const data = new Float32Array(height * 4);
  const phase = new SplitMix64(seed).mix(4).mix(frame);
  const head = new SplitMix64(seed).mix(2).mix(frame);
  const edge = new SplitMix64(seed).mix(5);
  const edgeSeed = edge.nextU32() | 0;
  const edgeOffset = edge.nextFloat() * height;
  for (let y = 0; y < height; y++) {
    data[y * 4] = phase.clone().mix(y).nextFloat() * 2 - 1;
    data[y * 4 + 2] = fbm2d(edgeOffset + y, frame * 4, edgeSeed, 2, Math.SQRT1_2, 0.05);
    data[y * 4 + 3] = head.clone().mix(y).nextFloat() - 0.5;
  }
  if (chromaLoss > 0 && chromaLoss <= 1) {
    const loss = new SplitMix64(seed).mix(7).mix(frame);
    const lambda = Math.log(1 - chromaLoss);
    let row = 0;
    while (row < height) {
      row += Math.floor(Math.log(Math.max(loss.nextFloat(), Number.EPSILON)) / lambda);
      if (row < height) data[row * 4 + 1] = 1;
      row++;
    }
  }
  return { data, width: 1, height };
};
