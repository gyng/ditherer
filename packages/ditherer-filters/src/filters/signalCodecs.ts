/** Deterministic codec/channel primitives shared by the specification filters. */

export const seededUnit = (seed: number, a: number, b = 0): number => {
  let x = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 0x100000000;
};

export type FaxCoding = "MH" | "MR" | "MMR";
export type FaxConcealment = "WHITE" | "PREVIOUS" | "DELETE";

export interface FaxRunLine {
  runs: number[];
  startsBlack: boolean;
  estimatedBits: number;
}

// T.4 MH uses terminating codes for 0..63 pels and makeup codes for longer
// runs. These are the code lengths from tables 1/2; the visible channel model
// only needs the transmitted length because damage is injected in bit space.
const WHITE_TERM_LENGTH = [
  8,6,4,4,4,4,4,4,5,5,5,5,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,8,8,8,
  8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,8,
];
const BLACK_TERM_LENGTH = [
  10,3,2,2,3,4,4,5,6,6,7,7,7,8,8,9,10,10,10,11,11,11,11,11,11,11,12,12,12,12,12,12,
  12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,12,
];

// T.4 tables 1/2 makeup words for 64..1728 pels. The additional makeup
// words are shared by white and black runs for 1792..2560 pels.
const WHITE_MAKEUP_LENGTH = [
  5,5,6,7,8,8,8,8,8,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,6,9,
];
const BLACK_MAKEUP_LENGTH = [
  10,12,12,12,12,12,12,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,
];
const ADDITIONAL_MAKEUP_LENGTH = [11,11,11,12,12,12,12,12,12,12,12,12,12];

const mhRunBits = (length: number, black: boolean): number => {
  let remaining = Math.max(0, Math.floor(length));
  let bits = 0;
  while (remaining >= 64) {
    const units = Math.min(40, Math.floor(remaining / 64));
    if (units >= 28) {
      bits += ADDITIONAL_MAKEUP_LENGTH[units - 28];
    } else {
      bits += (black ? BLACK_MAKEUP_LENGTH : WHITE_MAKEUP_LENGTH)[units - 1];
    }
    remaining -= units * 64;
  }
  return bits + (black ? BLACK_TERM_LENGTH : WHITE_TERM_LENGTH)[remaining];
};

export const encodeFaxRuns = (pixels: Uint8Array): FaxRunLine => {
  if (pixels.length === 0) return { runs: [], startsBlack: false, estimatedBits: 12 };
  // Every MH scan line starts in white. A black first pel is represented by
  // the legal zero-length white terminating code before the black run.
  const startsBlack = false;
  const runs: number[] = [];
  let value = false;
  let count = 0;
  for (let i = 0; i < pixels.length; i++) {
    const next = pixels[i] !== 0;
    if (next === value) count++;
    else {
      runs.push(count);
      value = next;
      count = 1;
    }
  }
  runs.push(count);
  let black = startsBlack;
  let estimatedBits = 12; // EOL 000000000001
  for (const run of runs) {
    estimatedBits += mhRunBits(run, black);
    black = !black;
  }
  return { runs, startsBlack, estimatedBits };
};

export const decodeFaxRuns = (line: FaxRunLine, width: number): Uint8Array => {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const out = new Uint8Array(safeWidth);
  let x = 0;
  let black = line.startsBlack;
  for (const run of line.runs) {
    const safeRun = Number.isFinite(run) ? Math.max(0, Math.floor(run)) : 0;
    const end = Math.min(safeWidth, x + safeRun);
    if (black) out.fill(1, x, end);
    x = end;
    black = !black;
    if (x >= safeWidth) break;
  }
  return out;
};

export interface FaxChannelResult {
  rows: Uint8Array[];
  damagedRows: number[];
}

export const transmitFaxRows = (
  rows: Uint8Array[],
  coding: FaxCoding,
  bitErrorRate: number,
  seed: number,
  concealment: FaxConcealment,
  mrK = 2,
): FaxChannelResult => {
  if (rows.length === 0) return { rows: [], damagedRows: [] };
  const width = rows[0].length;
  const output: Uint8Array[] = [];
  const damagedRows: number[] = [];
  const ber = Number.isFinite(bitErrorRate)
    ? Math.max(0, Math.min(1, bitErrorRate))
    : 0;
  const safeMrK = Number.isFinite(mrK) ? Math.max(1, Math.floor(mrK)) : 2;
  let referenceDamaged = false;
  for (let y = 0; y < rows.length; y++) {
    const encoded = encodeFaxRuns(rows[y]);
    const isReference = coding === "MH" || (coding === "MR" && y % safeMrK === 0) || (coding === "MMR" && y === 0);
    const payloadBits = isReference ? encoded.estimatedBits : Math.max(12, Math.round(encoded.estimatedBits * 0.58));
    const lineErrorProbability = ber >= 1
      ? 1
      : -Math.expm1(payloadBits * Math.log1p(-ber));
    const channelError = seededUnit(seed, y, payloadBits) < lineErrorProbability;
    // MR/MMR rows depend on the previous decoded reference. A damaged reference
    // therefore causes the next dependent row to fail as specified by E.453.
    const damaged = channelError || (!isReference && referenceDamaged);
    if (!damaged) {
      output.push(decodeFaxRuns(encoded, width));
      referenceDamaged = false;
      continue;
    }
    damagedRows.push(y);
    referenceDamaged = true;
    if (concealment === "PREVIOUS" && output.length) output.push(output[output.length - 1].slice());
    else if (concealment !== "DELETE") output.push(new Uint8Array(width));
  }
  // Deleting a damaged line pulls every subsequent decoded line upward; pad
  // the bottom so the fixed-size image contract remains intact.
  while (output.length < rows.length) output.push(new Uint8Array(width));
  return { rows: output, damagedRows };
};

/** SECDED Hamming 8/4 used for Teletext packet addresses and control data. */
export const encodeHamming84 = (nibble: number): number => {
  const d1 = nibble & 1;
  const d2 = (nibble >>> 1) & 1;
  const d3 = (nibble >>> 2) & 1;
  const d4 = (nibble >>> 3) & 1;
  // EN 300 706 §8.2 transmits P1,D1,P2,D2,P3,D3,P4,D4 and uses odd
  // parity throughout. This is not the conventional 1,2,4,8 SECDED layout.
  const p1 = 1 ^ d1 ^ d3 ^ d4;
  const p2 = 1 ^ d1 ^ d2 ^ d4;
  const p3 = 1 ^ d1 ^ d2 ^ d3;
  const p4 = 1 ^ p1 ^ d1 ^ p2 ^ d2 ^ p3 ^ d3 ^ d4;
  return p1 | (d1 << 1) | (p2 << 2) | (d2 << 3)
    | (p3 << 4) | (d3 << 5) | (p4 << 6) | (d4 << 7);
};

export interface Hamming84Result { value: number; corrected: boolean; uncorrectable: boolean }

const HAMMING84_CODEWORDS = Array.from({ length: 16 }, (_, value) => encodeHamming84(value));

const popcount8 = (value: number): number => {
  let bits = value & 0xff;
  let count = 0;
  while (bits) {
    count += bits & 1;
    bits >>>= 1;
  }
  return count;
};

export const decodeHamming84 = (input: number): Hamming84Result => {
  const word = input & 0xff;
  let bestValue = 0;
  let bestDistance = 9;
  for (let value = 0; value < HAMMING84_CODEWORDS.length; value++) {
    const distance = popcount8(word ^ HAMMING84_CODEWORDS[value]);
    if (distance < bestDistance) {
      bestValue = value;
      bestDistance = distance;
    }
  }
  if (bestDistance <= 1) {
    return { value: bestValue, corrected: bestDistance === 1, uncorrectable: false };
  }
  const rawValue = ((word >>> 1) & 1) | (((word >>> 3) & 1) << 1)
    | (((word >>> 5) & 1) << 2) | (((word >>> 7) & 1) << 3);
  return { value: rawValue, corrected: false, uncorrectable: true };
};

export const withOddParity = (sevenBits: number): number => {
  const value = sevenBits & 0x7f;
  let ones = 0;
  for (let i = 0; i < 7; i++) ones += (value >>> i) & 1;
  return value | ((ones % 2 === 0 ? 1 : 0) << 7);
};

export const hasOddParity = (byte: number): boolean => {
  let ones = 0;
  for (let i = 0; i < 8; i++) ones += (byte >>> i) & 1;
  return ones % 2 === 1;
};

/** Reversible JPEG 2000 5/3 lifting transform, split low bands then high. */
export const forward53 = (values: Int32Array): Int32Array => {
  const n = values.length;
  if (n < 2) return values.slice();
  const lowCount = Math.ceil(n / 2);
  const highCount = Math.floor(n / 2);
  const low = new Int32Array(lowCount);
  const high = new Int32Array(highCount);
  for (let i = 0; i < lowCount; i++) low[i] = values[i * 2];
  for (let i = 0; i < highCount; i++) {
    high[i] = values[i * 2 + 1] - ((low[i] + low[Math.min(i + 1, lowCount - 1)]) >> 1);
  }
  for (let i = 0; i < lowCount; i++) {
    const left = high[Math.max(0, i - 1)];
    const right = high[Math.min(i, highCount - 1)];
    low[i] += (left + right + 2) >> 2;
  }
  const out = new Int32Array(n);
  out.set(low, 0);
  out.set(high, lowCount);
  return out;
};

export const inverse53 = (coefficients: Int32Array): Int32Array => {
  const n = coefficients.length;
  if (n < 2) return coefficients.slice();
  const lowCount = Math.ceil(n / 2);
  const highCount = Math.floor(n / 2);
  const low = coefficients.slice(0, lowCount);
  const high = coefficients.slice(lowCount);
  for (let i = 0; i < lowCount; i++) {
    const left = high[Math.max(0, i - 1)];
    const right = high[Math.min(i, highCount - 1)];
    low[i] -= (left + right + 2) >> 2;
  }
  for (let i = 0; i < highCount; i++) {
    high[i] += (low[i] + low[Math.min(i + 1, lowCount - 1)]) >> 1;
  }
  const output = new Int32Array(n);
  for (let i = 0; i < lowCount; i++) output[i * 2] = low[i];
  for (let i = 0; i < highCount; i++) output[i * 2 + 1] = high[i];
  return output;
};

export const quantizeCoefficient = (value: number, step: number, bitplanes: number): number => {
  if (!Number.isFinite(value)) return 0;
  const safeStep = Number.isFinite(step) && step > Number.EPSILON ? step : Number.EPSILON;
  const q = Math.round(value / safeStep);
  const drop = Number.isFinite(bitplanes)
    ? Math.max(0, Math.min(20, Math.floor(bitplanes)))
    : 0;
  const magnitude = Math.abs(q);
  const plane = 2 ** drop;
  const truncated = drop === 0 ? magnitude : Math.floor(magnitude / plane) * plane;
  return Math.sign(q) * truncated * safeStep;
};
