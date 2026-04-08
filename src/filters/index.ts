import * as palettes from "palettes";
import { THEMES } from "palettes/user";

import binarize from "./binarize";
import channelSeparation from "./channelSeparation";
import jitter from "./jitter";
import vhs from "./vhs";
import program from "./program";
import brightnessContrast from "./brightnessContrast";
import convolve, { LAPLACIAN_3X3 } from "./convolve";
import grayscale from "./grayscale";
import pixelate from "./pixelate";
import pixelsort from "./pixelsort";
import glitchblob from "./glitchblob";
import halftone from "./halftone";
import invert from "./invert";
import ordered, { BAYER_4X4 } from "./ordered";
import quantize from "./quantize";
import random from "./random";
import scanline from "./scanline";
import rgbStripe from "./rgbstripe";
import solarize from "./solarize";
import posterize from "./posterize";
import chromaticAberration from "./chromaticAberration";
import bloom from "./bloom";
import colorShift from "./colorShift";
import bitCrush from "./bitCrush";
import displace from "./displace";
import voronoi from "./voronoi";
import ascii from "./ascii";
import kuwahara from "./kuwahara";
import reactionDiffusion from "./reactionDiffusion";
import histogramEqualization from "./histogramEqualization";
import duotone from "./duotone";
import wave from "./wave";
import colorBalance from "./colorBalance";
import lensDistortion from "./lensDistortion";
import triangleDither from "./triangleDither";
import anisotropicDiffusion from "./anisotropicDiffusion";
import kmeans from "./kmeans";
import mavicaFd7 from "./mavicaFd7";
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

export { default as channelSeparation } from "./channelSeparation";
export { default as jitter } from "./jitter";
export { default as vhs } from "./vhs";
export { default as binarize } from "./binarize";
export { default as program } from "./program";
export { default as brightnessContrast } from "./brightnessContrast";
export { default as convolve } from "./convolve";
export { default as grayscale } from "./grayscale";
export { default as pixelate } from "./pixelate";
export { default as pixelsort } from "./pixelsort";
export { default as glitchblob } from "./glitchblob";
export { default as halftone } from "./halftone";
export { default as invert } from "./invert";
export { default as ordered } from "./ordered";
export { default as quantize } from "./quantize";
export { default as scanline } from "./scanline";
export { default as rgbStripe } from "./rgbstripe";
export { default as solarize } from "./solarize";
export { default as posterize } from "./posterize";
export { default as chromaticAberration } from "./chromaticAberration";
export { default as bloom } from "./bloom";
export { default as colorShift } from "./colorShift";
export { default as bitCrush } from "./bitCrush";
export { default as displace } from "./displace";
export { default as voronoi } from "./voronoi";
export { default as ascii } from "./ascii";
export { default as kuwahara } from "./kuwahara";
export { default as reactionDiffusion } from "./reactionDiffusion";
export { default as histogramEqualization } from "./histogramEqualization";
export { default as duotone } from "./duotone";
export { default as wave } from "./wave";
export { default as colorBalance } from "./colorBalance";
export { default as lensDistortion } from "./lensDistortion";
export { default as triangleDither } from "./triangleDither";
export { default as anisotropicDiffusion } from "./anisotropicDiffusion";
export { default as kmeans } from "./kmeans";
export { default as mavicaFd7 } from "./mavicaFd7";
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
  channelSeparation,
  program,
  brightnessContrast,
  convolve,
  grayscale,
  pixelsort,
  glitchblob,
  halftone,
  invert,
  jitter,
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
  verticalStripe,
  vhs,
  random,
  pixelate,
  solarize,
  posterize,
  chromaticAberration,
  bloom,
  colorShift,
  bitCrush,
  displace,
  voronoi,
  ascii,
  kuwahara,
  reactionDiffusion,
  histogramEqualization,
  duotone,
  wave,
  colorBalance,
  lensDistortion,
  triangleDither,
  anisotropicDiffusion,
  kmeans,
  mavicaFd7
].reduce((acc, cur) => {
  acc[cur.name] = cur;
  return acc;
}, {});

// Presets
export const filterList = [
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
  { displayName: "Pixelate", filter: pixelate },
  { displayName: "Channel separation", filter: channelSeparation },
  { displayName: "Jitter", filter: jitter },
  { displayName: "VHS emulation", filter: vhs },
  { displayName: "Grayscale", filter: grayscale },
  { displayName: "Random", filter: random },
  { displayName: "Halftone", filter: halftone },
  { displayName: "Binarize", filter: binarize },
  {
    displayName: "Quantize (No dithering)",
    filter: quantize
  },
  { displayName: "Ordered", filter: ordered },
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
    displayName: "Ordered (Gameboy)",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        palette: {
          ...palettes.user,
          options: { colors: THEMES.GAMEBOY }
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
  },
  { displayName: "Solarize", filter: solarize },
  { displayName: "Posterize", filter: posterize },
  { displayName: "Chromatic aberration", filter: chromaticAberration },
  {
    displayName: "Chromatic aberration (per-channel)",
    filter: { ...chromaticAberration, options: { ...chromaticAberration.options, mode: "INDEPENDENT" } }
  },
  { displayName: "Bloom", filter: bloom },
  { displayName: "Color shift", filter: colorShift },
  { displayName: "Bit crush", filter: bitCrush },
  { displayName: "Displace", filter: displace },
  {
    displayName: "Displace (smooth)",
    filter: { ...displace, options: { ...displace.options, warpSource: "BLURRED" } }
  },
  { displayName: "Voronoi", filter: voronoi },
  { displayName: "ASCII", filter: ascii },
  { displayName: "Kuwahara", filter: kuwahara },
  { displayName: "Reaction-diffusion (coral)", filter: reactionDiffusion },
  {
    displayName: "Reaction-diffusion (worms)",
    filter: { ...reactionDiffusion, options: { ...reactionDiffusion.options, preset: "WORMS" } }
  },
  {
    displayName: "Reaction-diffusion (labyrinth)",
    filter: { ...reactionDiffusion, options: { ...reactionDiffusion.options, preset: "LABYRINTH" } }
  },
  { displayName: "Histogram equalization", filter: histogramEqualization },
  {
    displayName: "Histogram equalization (per-channel)",
    filter: { ...histogramEqualization, options: { ...histogramEqualization.options, perChannel: true } }
  },
  { displayName: "Duotone", filter: duotone },
  { displayName: "Wave", filter: wave },
  { displayName: "Color balance", filter: colorBalance },
  { displayName: "Lens distortion", filter: lensDistortion },
  {
    displayName: "Lens distortion (pincushion)",
    filter: { ...lensDistortion, options: { ...lensDistortion.options, k1: -0.3 } }
  },
  { displayName: "Triangle dither", filter: triangleDither },
  { displayName: "Anisotropic diffusion", filter: anisotropicDiffusion },
  { displayName: "K-means", filter: kmeans },
  { displayName: "Mavica FD7", filter: mavicaFd7 }
];
