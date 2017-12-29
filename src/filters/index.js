// @flow

import * as palettes from "palettes";
import { THEMES } from "palettes/user";

import binarize from "./binarize";
import program from "./program";
import brightnessContrast from "./brightnessContrast";
import convolve, { LAPLACIAN_3X3 } from "./convolve";
import grayscale from "./grayscale";
import pixelsort from "./pixelsort";
import glitchblob from "./glitchblob";
import halftone from "./halftone";
import invert from "./invert";
import ordered, { BAYER_4X4 } from "./ordered";
import quantize from "./quantize";
import random from "./random";
import scanline from "./scanline";
import rgbStripe from "./rgbstripe";
import {
  atkinson,
  burkes,
  floydSteinberg,
  falseFloydSteinberg,
  sierra,
  sierra2,
  sierraLite,
  stucki,
  jarvis,
  horizontalStripe,
  verticalStripe
} from "./errorDiffusing";

export { default as binarize } from "./binarize";
export { default as program } from "./program";
export { default as brightnessContrast } from "./brightnessContrast";
export { default as convolve } from "./convolve";
export { default as grayscale } from "./grayscale";
export { default as pixelsort } from "./pixelsort";
export { default as glitchblob } from "./glitchblob";
export { default as halftone } from "./halftone";
export { default as invert } from "./invert";
export { default as ordered } from "./ordered";
export { default as quantize } from "./quantize";
export { default as scanline } from "./scanline";
export { default as rgbStripe } from "./rgbstripe";
export {
  atkinson,
  burkes,
  floydSteinberg,
  falseFloydSteinberg,
  sierra,
  sierra2,
  sierraLite,
  stucki,
  jarvis,
  horizontalStripe,
  verticalStripe
} from "./errorDiffusing";

export const filterIndex = [
  binarize,
  program,
  brightnessContrast,
  convolve,
  grayscale,
  pixelsort,
  glitchblob,
  halftone,
  invert,
  ordered,
  quantize,
  scanline,
  rgbStripe,
  atkinson,
  burkes,
  floydSteinberg,
  falseFloydSteinberg,
  sierra,
  sierra2,
  sierraLite,
  stucki,
  jarvis,
  horizontalStripe,
  verticalStripe
].reduce((acc, cur) => {
  acc[cur.name] = cur;
  return acc;
}, {});

// Presets
export const filterList: Array<{ displayName: string, filter: any }> = [
  {
    displayName: "Program",
    filter: {
      ...program,
      options: {
        ...program.options,
        palette: {
          ...program.options.palette,
          options: {
            ...program.options.palette.options,
            levels: 256
          }
        }
      }
    }
  },
  { displayName: "Convolve", filter: convolve },
  {
    displayName: "Convolve (edge detection)",
    filter: {
      ...convolve,
      options: { ...convolve.options, kernel: LAPLACIAN_3X3 }
    }
  },
  { displayName: "Invert", filter: invert },
  {
    displayName: "Brightness/Contrast",
    filter: {
      ...brightnessContrast,
      options: {
        ...brightnessContrast.options,
        palette: {
          ...brightnessContrast.options.palette,
          options: {
            ...brightnessContrast.options.palette.options,
            levels: 256
          }
        }
      }
    }
  },
  {
    displayName: "Scanline",
    filter: {
      ...scanline,
      options: {
        ...scanline.options,
        palette: {
          ...scanline.options.palette,
          options: {
            ...scanline.options.palette.options,
            levels: 256
          }
        }
      }
    }
  },
  {
    displayName: "CRT emulation",
    filter: {
      ...rgbStripe,
      options: {
        ...rgbStripe.options,
        palette: {
          ...rgbStripe.options.palette,
          options: {
            ...rgbStripe.options.palette.options,
            levels: 32
          }
        }
      }
    }
  },
  { displayName: "Glitch", filter: glitchblob },
  {
    displayName: "Pixelsort",
    filter: {
      ...pixelsort,
      options: {
        ...pixelsort.options,
        palette: {
          ...pixelsort.options.palette,
          options: {
            ...pixelsort.options.palette.options,
            levels: 256
          }
        }
      }
    }
  },
  { displayName: "Grayscale", filter: grayscale },
  { displayName: "Random", filter: random },
  { displayName: "Halftone", filter: halftone },
  { displayName: "Binarize", filter: binarize },
  {
    displayName: "Quantize (No dithering)",
    filter: quantize
  },
  { displayName: "Ordered (Windows)", filter: ordered },
  {
    displayName: "Ordered (Windows 16-color)",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        thresholdMap: BAYER_4X4,
        palette: {
          ...palettes.user,
          options: { colors: THEMES.CGA }
        }
      }
    }
  },
  {
    displayName: "Floyd-Steinberg",
    filter: floydSteinberg
  },
  {
    displayName: "Floyd-Steinberg (CGA test)",
    filter: {
      ...floydSteinberg,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.CGA }
        }
      }
    }
  },
  {
    displayName: "Floyd-Steinberg (Vaporwave test)",
    filter: {
      ...floydSteinberg,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.VAPORWAVE }
        }
      }
    }
  },
  {
    displayName: "False Floyd-Steinberg",
    filter: falseFloydSteinberg
  },
  { displayName: "Jarvis", filter: jarvis },
  {
    displayName: "Stucki",
    filter: stucki
  },
  {
    displayName: "Burkes",
    filter: burkes
  },
  {
    displayName: "Atkinson (Mac)",
    filter: atkinson
  },
  {
    displayName: "Atkinson (Macintosh II color test)",
    filter: {
      ...atkinson,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.MAC2 }
        }
      }
    }
  },
  { displayName: "Sierra (full)", filter: sierra },
  {
    displayName: "Sierra (two-row)",
    filter: sierra2
  },
  {
    displayName: "Sierra (lite)",
    filter: sierraLite
  },
  {
    displayName: "Stripe (horizontal)",
    filter: horizontalStripe
  },
  {
    displayName: "Stripe (vertical)",
    filter: verticalStripe
  }
];
