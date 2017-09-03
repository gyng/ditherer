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
  jarvis
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
  { name: "Grayscale", filter: grayscale },
  { name: "Random", filter: random },
  { name: "Halftone", filter: halftone },
  { name: "Binarize", filter: binarize },
  {
    name: "Quantize (No dithering)",
    filter: quantize
  },
  {
    name: "Quantize (No dithering, EGA test)",
    filter: {
      ...quantize,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.EGA.MODE4.PALETTE1.LOW }
        }
      }
    }
  },
  {
    name: "Quantize (No dithering, sepia test)",
    filter: {
      ...quantize,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.SEPIA }
        }
      }
    }
  },
  {
    name: "Quantize (No dithering, vaporwave test)",
    filter: {
      ...quantize,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.VAPORWAVE }
        }
      }
    }
  },
  { name: "Ordered (Windows)", filter: ordered },
  {
    name: "Ordered (Windows 16-color)",
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
    name: "Floyd-Steinberg",
    filter: floydSteinberg
  },
  {
    name: "Floyd-Steinberg (EGA test)",
    filter: {
      ...floydSteinberg,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.EGA.MODE4.PALETTE1.HIGH }
        }
      }
    }
  },
  {
    name: "Floyd-Steinberg (CGA test)",
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
    name: "Floyd-Steinberg (Sepia test)",
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
    name: "Floyd-Steinberg (Vaporwave test)",
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
  { name: "Jarvis", filter: jarvis },
  {
    name: "Atkinson (Mac)",
    filter: atkinson
  },
  {
    name: "Atkinson (Macintosh II color test)",
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
  { name: "Sierra (full)", filter: sierra },
  {
    name: "Sierra (two-row)",
    filter: sierra2
  },
  {
    name: "Sierra (lite)",
    filter: sierraLite
  }
];
