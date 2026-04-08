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
import eink from "./eink";
import gameboyCamera from "./gameboyCamera";
import oscilloscope from "./oscilloscope";
import teletext from "./teletext";
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
export { default as gameboyCamera } from "./gameboyCamera";
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
  mavicaFd7,
  eink,
  gameboyCamera,
  oscilloscope
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
  { displayName: "Atkinson (Mac)", filter: atkinson, category: "Dithering", description: "Classic Mac dithering with 75% error diffusion for a crisp, high-contrast look" },
  {
    displayName: "Atkinson (Macintosh II color test)",
    category: "Dithering",
    description: "Atkinson dithering with the original Macintosh II 16-color palette",
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
  { displayName: "Binarize", filter: binarize, category: "Dithering", description: "Simple threshold to pure black and white with no error diffusion" },
  { displayName: "Burkes", filter: burkes, category: "Dithering", description: "Fast two-row error diffusion with smooth gradients" },
  { displayName: "False Floyd-Steinberg", filter: falseFloydSteinberg, category: "Dithering", description: "Simplified Floyd-Steinberg using only two neighbors for a grainier result" },
  { displayName: "Floyd-Steinberg", filter: floydSteinberg, category: "Dithering", description: "The classic error-diffusion algorithm — balanced quality and speed" },
  {
    displayName: "Floyd-Steinberg (CGA test)",
    category: "Dithering",
    description: "Floyd-Steinberg with the 16-color CGA palette",
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
    description: "Floyd-Steinberg with a pastel vaporwave palette",
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
  { displayName: "Jarvis", filter: jarvis, category: "Dithering", description: "Three-row error diffusion for smoother gradients at the cost of speed" },
  { displayName: "Ordered", filter: ordered, category: "Dithering", description: "Bayer matrix threshold dithering — fast, tiled, no error diffusion" },
  {
    displayName: "Ordered (Gameboy)",
    category: "Dithering",
    description: "Ordered dithering with the 4-shade Gameboy green palette",
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
    displayName: "Ordered (Downwell Gameboy)",
    category: "Dithering",
    description: "Ordered dithering with Downwell's muted green Gameboy-style palette",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        palette: {
          ...palettes.user,
          options: { colors: THEMES.DOWNWELL_GAMEBOY }
        }
      }
    }
  },
  {
    displayName: "Ordered (Windows 16-color)",
    category: "Dithering",
    description: "4x4 Bayer ordered dithering with the classic Windows 16-color palette",
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
  { displayName: "Quantize (No dithering)", filter: quantize, category: "Dithering", description: "Reduce colors by snapping each pixel to the nearest palette color" },
  { displayName: "Random", filter: random, category: "Dithering", description: "Add random noise before quantizing for a stippled, noisy texture" },
  { displayName: "Sierra (full)", filter: sierra, category: "Dithering", description: "Three-row error diffusion similar to Jarvis but with different weights" },
  { displayName: "Sierra (lite)", filter: sierraLite, category: "Dithering", description: "Minimal Sierra variant — fast with only two neighbors" },
  { displayName: "Sierra (two-row)", filter: sierra2, category: "Dithering", description: "Two-row Sierra for a balance between speed and quality" },
  { displayName: "Stucki", filter: stucki, category: "Dithering", description: "Three-row error diffusion with sharper results than Jarvis" },
  { displayName: "Triangle dither", filter: triangleDither, category: "Dithering", description: "Triangle-distributed noise dithering for film-like grain" },

  // ── Color ──
  {
    displayName: "Brightness/Contrast",
    category: "Color",
    description: "Adjust image brightness and contrast levels",
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
  { displayName: "Color balance", filter: colorBalance, category: "Color", description: "Shift the balance between complementary color channels" },
  { displayName: "Color shift", filter: colorShift, category: "Color", description: "Rotate hue and shift saturation/lightness" },
  { displayName: "Duotone", filter: duotone, category: "Color", description: "Map shadows and highlights to two custom colors" },
  { displayName: "Grayscale", filter: grayscale, category: "Color", description: "Convert to grayscale using perceptual luminance weights" },
  { displayName: "Histogram equalization", filter: histogramEqualization, category: "Color", description: "Redistribute tonal range for better contrast across the image" },
  {
    displayName: "Histogram equalization (per-channel)",
    category: "Color",
    description: "Equalize each RGB channel independently — can introduce color shifts",
    filter: { ...histogramEqualization, options: { ...histogramEqualization.options, perChannel: true } }
  },
  { displayName: "Invert", filter: invert, category: "Color", description: "Flip all colors to their complement (negative)" },
  { displayName: "Posterize", filter: posterize, category: "Color", description: "Reduce color levels per channel for a flat, poster-like look" },
  { displayName: "Solarize", filter: solarize, category: "Color", description: "Partially invert tones above a threshold for a surreal darkroom effect" },

  // ── Stylize ──
  { displayName: "ASCII", filter: ascii, category: "Stylize", description: "Render the image as ASCII characters based on brightness" },
  { displayName: "Halftone", filter: halftone, category: "Stylize", description: "Simulate print halftone with variable-size dots" },
  { displayName: "K-means", filter: kmeans, category: "Stylize", description: "Cluster pixels into k dominant colors using iterative refinement" },
  { displayName: "Kuwahara", filter: kuwahara, category: "Stylize", description: "Edge-preserving smoothing for a painterly, watercolor-like look" },
  { displayName: "E-ink (grayscale)", filter: eink, category: "Simulate", description: "Simulate a 16-level grayscale e-ink display with paper texture and ghosting" },
  {
    displayName: "E-ink (color)",
    category: "Simulate",
    description: "Simulate a color Kaleido/Gallery e-ink display with washed-out palette",
    filter: { ...eink, options: { ...eink.options, mode: "COLOR", palette: { ...eink.options.palette, options: { levels: 256 } } } }
  },
  { displayName: "Gameboy Camera", filter: gameboyCamera, category: "Simulate", description: "Simulate the Gameboy Camera — 4-shade green palette with edge enhancement and ordered dithering" },
  { displayName: "Mavica FD7", filter: mavicaFd7, category: "Simulate", description: "Emulate the Sony Mavica FD7 — low-res JPEG on a floppy disk" },
  { displayName: "Oscilloscope", filter: oscilloscope, category: "Simulate", description: "Render as phosphor traces on a dark CRT oscilloscope screen with bloom and persistence" },
  { displayName: "Pixelate", filter: pixelate, category: "Stylize", description: "Downscale into chunky pixel blocks" },
  { displayName: "Stripe (horizontal)", filter: horizontalStripe, category: "Stylize", description: "Overlay horizontal stripe pattern over the image" },
  { displayName: "Stripe (vertical)", filter: verticalStripe, category: "Stylize", description: "Overlay vertical stripe pattern over the image" },
  { displayName: "Voronoi", filter: voronoi, category: "Stylize", description: "Divide the image into irregular cell regions with averaged colors" },

  // ── Distort ──
  { displayName: "Chromatic aberration", filter: chromaticAberration, category: "Distort", description: "Offset color channels to simulate lens fringing" },
  {
    displayName: "Chromatic aberration (per-channel)",
    category: "Distort",
    description: "Move each RGB channel independently for extreme color splitting",
    filter: { ...chromaticAberration, options: { ...chromaticAberration.options, mode: "INDEPENDENT" } }
  },
  { displayName: "Displace", filter: displace, category: "Distort", description: "Warp pixels using the image's own luminance as a displacement map" },
  {
    displayName: "Displace (smooth)",
    category: "Distort",
    description: "Displacement mapping with a blurred source for gentler warping",
    filter: { ...displace, options: { ...displace.options, warpSource: "BLURRED" } }
  },
  { displayName: "Lens distortion", filter: lensDistortion, category: "Distort", description: "Apply barrel distortion like a wide-angle lens" },
  {
    displayName: "Lens distortion (pincushion)",
    category: "Distort",
    description: "Apply inward pincushion distortion like a telephoto lens",
    filter: { ...lensDistortion, options: { ...lensDistortion.options, k1: -0.3 } }
  },
  { displayName: "Wave", filter: wave, category: "Distort", description: "Displace pixels along sine waves for a ripple effect" },

  // ── Glitch ──
  { displayName: "Bit crush", filter: bitCrush, category: "Glitch", description: "Reduce bit depth per channel for harsh color banding" },
  { displayName: "Channel separation", filter: channelSeparation, category: "Glitch", description: "Split and offset RGB channels for a glitchy color-fringe look" },
  { displayName: "Glitch", filter: glitchblob, category: "Glitch", description: "Randomly corrupt pixel data to simulate digital artifacts" },
  { displayName: "Jitter", filter: jitter, category: "Glitch", description: "Randomly shift pixel rows for a shaky, unstable signal look" },
  {
    displayName: "Pixelsort",
    category: "Glitch",
    description: "Sort pixel spans by brightness for dramatic streak effects",
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
  { displayName: "Anisotropic diffusion", filter: anisotropicDiffusion, category: "Simulate", description: "Smooth flat regions while preserving edges — like Perona-Malik filtering" },
  {
    displayName: "CRT emulation",
    category: "Simulate",
    description: "Simulate a CRT monitor with phosphor mask, bloom, scanlines, curvature, and vignette",
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
  { displayName: "Reaction-diffusion (coral)", filter: reactionDiffusion, category: "Simulate", description: "Grow organic coral-like patterns using a reaction-diffusion simulation" },
  {
    displayName: "Reaction-diffusion (labyrinth)",
    category: "Simulate",
    description: "Generate maze-like labyrinth patterns via reaction-diffusion",
    filter: { ...reactionDiffusion, options: { ...reactionDiffusion.options, preset: "LABYRINTH" } }
  },
  {
    displayName: "Reaction-diffusion (worms)",
    category: "Simulate",
    description: "Create worm-like squiggly patterns through reaction-diffusion",
    filter: { ...reactionDiffusion, options: { ...reactionDiffusion.options, preset: "WORMS" } }
  },
  {
    displayName: "Scanline",
    category: "Simulate",
    description: "Add horizontal scanline gaps like a retro CRT display",
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
  { displayName: "VHS emulation", filter: vhs, category: "Simulate", description: "Simulate VHS tape — tracking errors, chroma delay, head-switching noise, and ghosting" },

  // ── Blur & Edges ──
  { displayName: "Bloom", filter: bloom, category: "Blur & Edges", description: "Add a soft glow around bright areas" },
  { displayName: "Convolve", filter: convolve, category: "Blur & Edges", description: "Apply a custom convolution kernel — blur, sharpen, emboss, and more" },
  {
    displayName: "Convolve (edge detection)",
    category: "Blur & Edges",
    description: "Detect edges using a Laplacian convolution kernel",
    filter: {
      ...convolve,
      options: { ...convolve.options, kernel: LAPLACIAN_3X3 }
    }
  },

  // ── Advanced ──
  {
    displayName: "Program",
    category: "Advanced",
    description: "Write custom pixel-manipulation code in a built-in editor",
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
