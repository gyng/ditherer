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

export const filterCategories = [
  "Dithering", "Color", "Stylize", "Distort",
  "Glitch", "Simulate", "Blur & Edges", "Advanced"
];

// Presets — grouped by category, alphabetized within each
export const filterList = [
  // ── Dithering ──
  { displayName: "Atkinson (Mac)", filter: atkinson, category: "Dithering" },
  {
    displayName: "Atkinson (Macintosh II color test)",
    category: "Dithering",
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
  { displayName: "Binarize", filter: binarize, category: "Dithering" },
  { displayName: "Burkes", filter: burkes, category: "Dithering" },
  { displayName: "False Floyd-Steinberg", filter: falseFloydSteinberg, category: "Dithering" },
  { displayName: "Floyd-Steinberg", filter: floydSteinberg, category: "Dithering" },
  {
    displayName: "Floyd-Steinberg (CGA test)",
    category: "Dithering",
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
    category: "Dithering",
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
  { displayName: "Jarvis", filter: jarvis, category: "Dithering" },
  { displayName: "Ordered", filter: ordered, category: "Dithering" },
  {
    displayName: "Ordered (Gameboy)",
    category: "Dithering",
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
    displayName: "Ordered (Windows 16-color)",
    category: "Dithering",
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
  { displayName: "Quantize (No dithering)", filter: quantize, category: "Dithering" },
  { displayName: "Random", filter: random, category: "Dithering" },
  { displayName: "Sierra (full)", filter: sierra, category: "Dithering" },
  { displayName: "Sierra (lite)", filter: sierraLite, category: "Dithering" },
  { displayName: "Sierra (two-row)", filter: sierra2, category: "Dithering" },
  { displayName: "Stucki", filter: stucki, category: "Dithering" },
  { displayName: "Triangle dither", filter: triangleDither, category: "Dithering" },

  // ── Color ──
  {
    displayName: "Brightness/Contrast",
    category: "Color",
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
  { displayName: "Color balance", filter: colorBalance, category: "Color" },
  { displayName: "Color shift", filter: colorShift, category: "Color" },
  { displayName: "Duotone", filter: duotone, category: "Color" },
  { displayName: "Grayscale", filter: grayscale, category: "Color" },
  { displayName: "Histogram equalization", filter: histogramEqualization, category: "Color" },
  {
    displayName: "Histogram equalization (per-channel)",
    category: "Color",
    filter: { ...histogramEqualization, options: { ...histogramEqualization.options, perChannel: true } }
  },
  { displayName: "Invert", filter: invert, category: "Color" },
  { displayName: "Posterize", filter: posterize, category: "Color" },
  { displayName: "Solarize", filter: solarize, category: "Color" },

  // ── Stylize ──
  { displayName: "ASCII", filter: ascii, category: "Stylize" },
  { displayName: "Halftone", filter: halftone, category: "Stylize" },
  { displayName: "K-means", filter: kmeans, category: "Stylize" },
  { displayName: "Kuwahara", filter: kuwahara, category: "Stylize" },
  { displayName: "Mavica FD7", filter: mavicaFd7, category: "Stylize" },
  { displayName: "Pixelate", filter: pixelate, category: "Stylize" },
  { displayName: "Stripe (horizontal)", filter: horizontalStripe, category: "Stylize" },
  { displayName: "Stripe (vertical)", filter: verticalStripe, category: "Stylize" },
  { displayName: "Voronoi", filter: voronoi, category: "Stylize" },

  // ── Distort ──
  { displayName: "Chromatic aberration", filter: chromaticAberration, category: "Distort" },
  {
    displayName: "Chromatic aberration (per-channel)",
    category: "Distort",
    filter: { ...chromaticAberration, options: { ...chromaticAberration.options, mode: "INDEPENDENT" } }
  },
  { displayName: "Displace", filter: displace, category: "Distort" },
  {
    displayName: "Displace (smooth)",
    category: "Distort",
    filter: { ...displace, options: { ...displace.options, warpSource: "BLURRED" } }
  },
  { displayName: "Lens distortion", filter: lensDistortion, category: "Distort" },
  {
    displayName: "Lens distortion (pincushion)",
    category: "Distort",
    filter: { ...lensDistortion, options: { ...lensDistortion.options, k1: -0.3 } }
  },
  { displayName: "Wave", filter: wave, category: "Distort" },

  // ── Glitch ──
  { displayName: "Bit crush", filter: bitCrush, category: "Glitch" },
  { displayName: "Channel separation", filter: channelSeparation, category: "Glitch" },
  { displayName: "Glitch", filter: glitchblob, category: "Glitch" },
  { displayName: "Jitter", filter: jitter, category: "Glitch" },
  {
    displayName: "Pixelsort",
    category: "Glitch",
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

  // ── Simulate ──
  { displayName: "Anisotropic diffusion", filter: anisotropicDiffusion, category: "Simulate" },
  {
    displayName: "CRT emulation",
    category: "Simulate",
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
  { displayName: "Reaction-diffusion (coral)", filter: reactionDiffusion, category: "Simulate" },
  {
    displayName: "Reaction-diffusion (labyrinth)",
    category: "Simulate",
    filter: { ...reactionDiffusion, options: { ...reactionDiffusion.options, preset: "LABYRINTH" } }
  },
  {
    displayName: "Reaction-diffusion (worms)",
    category: "Simulate",
    filter: { ...reactionDiffusion, options: { ...reactionDiffusion.options, preset: "WORMS" } }
  },
  {
    displayName: "Scanline",
    category: "Simulate",
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
  { displayName: "VHS emulation", filter: vhs, category: "Simulate" },

  // ── Blur & Edges ──
  { displayName: "Bloom", filter: bloom, category: "Blur & Edges" },
  { displayName: "Convolve", filter: convolve, category: "Blur & Edges" },
  {
    displayName: "Convolve (edge detection)",
    category: "Blur & Edges",
    filter: {
      ...convolve,
      options: { ...convolve.options, kernel: LAPLACIAN_3X3 }
    }
  },

  // ── Advanced ──
  {
    displayName: "Program",
    category: "Advanced",
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
];
