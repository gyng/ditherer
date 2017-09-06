// @flow

import * as palettes from "palettes";
import { THEMES } from "palettes/user";

import binarize from "./binarize";
import grayscale from "./grayscale";
import ordered, { BAYER_4X4 } from "./ordered";
import random from "./random";
import halftone from "./halftone";
import quantize from "./quantize";
import {
  atkinson,
  floydSteinberg,
  sierra,
  sierra2,
  sierraLite,
  jarvis,
  horizontalStripe,
  verticalStripe
} from "./errorDiffusing";

export { default as binarize } from "./binarize";
export { default as grayscale } from "./grayscale";
export { default as ordered } from "./ordered";
export { default as halftone } from "./halftone";
export { default as quantize } from "./quantize";
export {
  atkinson,
  floydSteinberg,
  sierra,
  sierra2,
  sierraLite,
  jarvis
} from "./errorDiffusing";

export const filterList = [
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
        levels: 16,
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
    displayName: "Floyd-Steinberg (EGA test)",
    filter: {
      ...floydSteinberg,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.EGA_MODE4_PALETTE1_HIGH }
        }
      }
    }
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
    displayName: "Floyd-Steinberg (Sepia test)",
    filter: {
      ...floydSteinberg,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.SEPIA }
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
  { displayName: "Jarvis", filter: jarvis },
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
