// @flow

import { scaleMatrix } from "utils";

import { defaults, errorDiffusingFilter } from "./errorDiffusingFilterFactory";

// https://en.wikipedia.org/wiki/Floyd%E2%80%93Steinberg_dithering
// [_,    *,    7/16]
// [3/16, 5/16, 1/16]
const fsKernel = {
  offset: [-1, 0], // x, y
  kernel: [[null, null, 7 / 16], [3 / 16, 5 / 16, 1 / 16]]
};
export const floydSteinberg = errorDiffusingFilter(
  "Floyd-Steinberg",
  fsKernel,
  defaults
);

const falseFsKernel = {
  offset: [0, 0], // x, y
  kernel: scaleMatrix([[null, 3], [3, 2]], 1 / 8)
};
export const falseFloydSteinberg = errorDiffusingFilter(
  "False Floyd-Steinberg",
  falseFsKernel,
  defaults
);

// http://www.tannerhelland.com/4660/dithering-eleven-algorithms-source-code/
//         *   5   3
// 2   4   5   4   2
//     2   3   2
//       (1/32)
const sierra3kernel = {
  offset: [-2, 0], // x, y
  kernel: scaleMatrix(
    [[null, null, null, 5, 3], [2, 4, 5, 4, 2], [null, 2, 3, 2, null]],
    1 / 32
  )
};
export const sierra = errorDiffusingFilter("Sierra", sierra3kernel, defaults);

//         X   4   3
// 1   2   3   2   1
//       (1/16)
export const sierra2kernel = {
  offset: [-2, 0], // x, y
  kernel: scaleMatrix([[null, null, null, 4, 3], [1, 2, 3, 2, 1]], 1 / 16)
};
export const sierra2 = errorDiffusingFilter(
  "Sierra 2-row",
  sierra2kernel,
  defaults
);

//     X   2
// 1   1
//   (1/4)
export const sierraLiteKernel = {
  offset: [-1, 0], // x, y
  kernel: scaleMatrix([[null, null, 2], [1, 1, null]], 1 / 4)
};
export const sierraLite = errorDiffusingFilter(
  "Sierra lite",
  sierraLiteKernel,
  defaults
);

// http://www.tannerhelland.com/4660/dithering-eleven-algorithms-source-code/
//     X   1   1
// 1   1   1
//     1
//   (1/8)
const atkinsonKernel = {
  offset: [-1, 0], // x, y
  kernel: scaleMatrix(
    [[null, null, 1, 1], [1, 1, 1, null], [null, 1, null, null]],
    1 / 8
  )
};
export const atkinson = errorDiffusingFilter(
  "Atkinson",
  atkinsonKernel,
  defaults
);

// http://www.tannerhelland.com/4660/dithering-eleven-algorithms-source-code/
//         X   7   5
// 3   5   7   5   3
// 1   3   5   3   1
//       (1/48)
const jarvisKernel = {
  offset: [-2, 0], // x, y
  kernel: scaleMatrix(
    [[null, null, null, 7, 5], [3, 5, 7, 5, 3], [1, 3, 5, 3, 1]],
    1 / 48
  )
};
export const jarvis = errorDiffusingFilter("Jarvis", jarvisKernel, defaults);

//         *   8   4
// 2   4   8   4   2
// 1   2   4   2   1   (1/42)
const stuckiKernel = {
  offset: [-2, 0],
  kernel: scaleMatrix(
    [[null, null, null, 8, 4], [2, 4, 8, 4, 2], [1, 2, 4, 2, 1]],
    1 / 42
  )
};
export const stucki = errorDiffusingFilter("Stucki", stuckiKernel, defaults);

// *   8   4             The Burkes filter
// 2   4   8   4   2   (1/32)
const burkesKernel = {
  offset: [-2, 0],
  kernel: scaleMatrix([[null, null, null, 8, 4], [2, 4, 8, 4, 2]], 1 / 32)
};
export const burkes = errorDiffusingFilter("Burkes", burkesKernel, defaults);

// Weird kernels
//   X
//   1
//   X
//   1
//   (1/4)
const horizontalStripeKernel = {
  offset: [0, 0], // x, y
  kernel: scaleMatrix([[null], [1], [null], [1]], 1 / 4)
};
export const horizontalStripe = errorDiffusingFilter(
  "Stripe (Horizontal)",
  horizontalStripeKernel,
  defaults
);

const verticalStripeKernel = {
  offset: [0, 0], // x, y
  kernel: scaleMatrix([[null, 1, null, 1]], 1 / 4)
};
export const verticalStripe = errorDiffusingFilter(
  "Stripe (Vertical)",
  verticalStripeKernel,
  defaults
);
