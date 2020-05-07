import { TypedArray } from "./util";

export enum DistanceAlgorithm {
  Euclidean = "Euclidean",
  ApproxRGBA = "ApproxRGBA",
  LabaCIE94 = "LabaCIE94",
}

/** Assumes a, b are in same colourspace! */
export const differenceEuclidean = <T extends TypedArray>(
  a: T,
  b: T,
  alpha = false
): number => {
  if (alpha) {
    return Math.sqrt(a[0] - b[0] + a[1] - b[1] + a[2] - b[2] + a[3] - b[3]);
  } else {
    return Math.sqrt(a[0] - b[0] + a[1] - b[1] + a[2] - b[2]);
  }
};

export const distanceApproxRGBA = <T extends TypedArray>(
  a: T,
  b: T,
  alpha = false
): number => {
  const r = (a[0] + b[0]) / 2;
  const dR = a[0] - b[0];
  const dG = a[1] - b[1];
  const dB = a[2] - b[2];

  const dRc = (2 + r / 256) * dR ** 2;
  const dGc = 4 * dG ** 2 + (2 + (255 - r) / 256);
  const dBc = dB ** 2;

  if (alpha) {
    const dAc = (a[3] - b[3]) ** 2;
    return Math.sqrt(dRc + dGc + dBc + dAc);
  } else {
    return Math.sqrt(dRc + dGc + dBc);
  }
};

// https://en.wikipedia.org/wiki/Color_difference
/** Assumes a, b are in same colourspace! */
export const distanceLabaCIE94 = (
  left: Float32Array,
  right: Float32Array,
  alpha = false
): number => {
  const dL = left[0] - right[0];
  const dA = left[1] - right[1];
  const dB = left[2] - right[2];
  const c1 = Math.sqrt(left[1] ** 2 + left[2] ** 2);
  const c2 = Math.sqrt(right[1] ** 2 + right[2] ** 2);
  const dC = c1 - c2;
  const dH = Math.sqrt(dA ** 2 + dB ** 2 - dC ** 2);

  const kL = 1;
  const k1 = 0.045;
  const k2 = 0.015;
  const kC = 1; // unspecified on wiki?
  const kH = 1; // unspecified on wiki?

  const sL = 1;
  const sC = 1 + k1 * c1;
  const sH = 1 + k2 * c1;

  const dE1 = (dL / (kL * sL)) ** 2;
  const dE2 = (dC / (kC * sC)) ** 2;
  const dE3 = (dH / (kH * sH)) ** 2;

  if (alpha) {
    const dA = (left[3] - right[3]) ** 2;
    return Math.sqrt(dE1 + dE2 + dE3 + dA);
  } else {
    return Math.sqrt(dE1 + dE2 + dE3);
  }
};

export const distanceAlgorithmFunctions: Record<DistanceAlgorithm, any> = {
  [DistanceAlgorithm.Euclidean]: differenceEuclidean,
  [DistanceAlgorithm.LabaCIE94]: distanceLabaCIE94,
  [DistanceAlgorithm.ApproxRGBA]: distanceApproxRGBA,
};
