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
import datamosh from "./datamosh";
import thermalCamera from "./thermalCamera";
import nightVision from "./nightVision";
import projectionFilm from "./projectionFilm";
import polaroid from "./polaroid";
import nokiaLcd from "./nokiaLcd";
import deepFry from "./deepFry";
import ultrasound from "./ultrasound";
import bilateralBlur from "./bilateralBlur";
import bokeh from "./bokeh";
import morphology from "./morphology";
import cellularAutomata from "./cellularAutomata";
import displacementMapXY from "./displacementMapXY";
import pinch from "./pinch";
import turbulence from "./turbulence";
import lineArt from "./lineArt";
import engraving from "./engraving";
import infrared from "./infrared";
import lcdDisplay from "./lcdDisplay";
import risographMulti from "./risographMulti";
import newspaper from "./newspaper";
import faxMachine from "./faxMachine";
import photocopier from "./photocopier";
import daguerreotype from "./daguerreotype";
import lenticular from "./lenticular";
import thermalPrinter from "./thermalPrinter";
import dataBend from "./dataBend";
import interlaceTear from "./interlaceTear";
import pixelScatter from "./pixelScatter";
import stipple from "./stipple";
import mosaicTile from "./mosaicTile";
import pencilSketch from "./pencilSketch";
import watercolorBleed from "./watercolorBleed";
import popArt from "./popArt";
import channelMixer from "./channelMixer";
import ripple from "./ripple";
import spherize from "./spherize";
import stretch from "./stretch";
import matrixRain from "./matrixRain";
import dotMatrix from "./dotMatrix";
import risograph from "./risograph";
import liquify from "./liquify";
import cmykHalftone from "./cmykHalftone";
import thresholdMap from "./thresholdMap";
import pixelDrift from "./pixelDrift";
import woodcut from "./woodcut";
import analogStatic from "./analogStatic";
import chromaticPosterize from "./chromaticPosterize";
import noiseGenerator from "./noiseGenerator";
import blend from "./blend";
import levels from "./levels";
import radialBlur from "./radialBlur";
import fractal from "./fractal";
import gaussianBlur from "./gaussianBlur";
import motionBlur from "./motionBlur";
import filmGrain from "./filmGrain";
import edgeGlow from "./edgeGlow";
import tiltShift from "./tiltShift";
import posterizeEdges from "./posterizeEdges";
import vignette from "./vignette";
import gradientMap from "./gradientMap";
import mirror from "./mirror";
import swirl from "./swirl";
import crosshatch from "./crosshatch";
import scanLineShift from "./scanLineShift";
import sharpen from "./sharpen";
import emboss from "./emboss";
import sepia from "./sepia";
import oilPainting from "./oilPainting";
import stainedGlass from "./stainedGlass";
import jpegArtifact from "./jpegArtifact";
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
export { default as teletext } from "./teletext";
export { default as datamosh } from "./datamosh";
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
  oscilloscope,
  teletext,
  datamosh,
  thermalCamera,
  nightVision,
  projectionFilm,
  polaroid,
  nokiaLcd,
  deepFry,
  ultrasound,
  gradientMap,
  mirror,
  swirl,
  crosshatch,
  scanLineShift,
  sharpen,
  emboss,
  sepia,
  oilPainting,
  stainedGlass,
  jpegArtifact,
  gaussianBlur,
  motionBlur,
  filmGrain,
  edgeGlow,
  tiltShift,
  posterizeEdges,
  vignette,
  noiseGenerator,
  blend,
  levels,
  radialBlur,
  fractal,
  dotMatrix,
  risograph,
  liquify,
  cmykHalftone,
  thresholdMap,
  pixelDrift,
  woodcut,
  analogStatic,
  chromaticPosterize,
  risographMulti,
  newspaper,
  faxMachine,
  photocopier,
  daguerreotype,
  lenticular,
  thermalPrinter,
  dataBend,
  interlaceTear,
  pixelScatter,
  stipple,
  mosaicTile,
  pencilSketch,
  watercolorBleed,
  popArt,
  channelMixer,
  ripple,
  spherize,
  stretch,
  matrixRain,
  bilateralBlur,
  bokeh,
  morphology,
  cellularAutomata,
  displacementMapXY,
  pinch,
  turbulence,
  lineArt,
  engraving,
  infrared,
  lcdDisplay
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
  { displayName: "Threshold map", filter: thresholdMap, category: "Dithering", description: "Dither with custom threshold patterns — Bayer, halftone dot, diagonal, cross, diamond" },
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
  { displayName: "Blend", filter: blend, category: "Color", description: "Blend with a color using standard modes — multiply, screen, overlay, and more" },
  { displayName: "Channel mixer", filter: channelMixer, category: "Color", description: "Arbitrary RGB matrix multiplication — swap, mix, or invert channels" },
  { displayName: "Chromatic posterize", filter: chromaticPosterize, category: "Color", description: "Posterize each RGB channel independently with different level counts" },
  { displayName: "Gradient map", filter: gradientMap, category: "Color", description: "Map luminance to a three-stop color gradient for creative toning" },
  { displayName: "Levels", filter: levels, category: "Color", description: "Adjust black point, white point, and gamma for precise tonal control" },
  { displayName: "Posterize", filter: posterize, category: "Color", description: "Reduce color levels per channel for a flat, poster-like look" },
  { displayName: "Sepia", filter: sepia, category: "Color", description: "Warm monochrome toning with adjustable intensity" },
  { displayName: "Solarize", filter: solarize, category: "Color", description: "Partially invert tones above a threshold for a surreal darkroom effect" },
  { displayName: "Vignette", filter: vignette, category: "Color", description: "Darken image edges with adjustable radius, softness, and shape" },

  // ── Stylize ──
  { displayName: "ASCII", filter: ascii, category: "Stylize", description: "Render the image as ASCII characters based on brightness" },
  { displayName: "CMYK halftone", filter: cmykHalftone, category: "Stylize", description: "Proper CMYK separation with independent screen angles per channel" },
  { displayName: "Crosshatch", filter: crosshatch, category: "Stylize", description: "Simulate pen-and-ink crosshatching with luminance-driven line density" },
  { displayName: "Mosaic tile", filter: mosaicTile, category: "Stylize", description: "Pixelate with grout lines and per-tile color jitter" },
  { displayName: "Dot matrix", filter: dotMatrix, category: "Stylize", description: "Fixed-pitch dot grid simulating a dot matrix printer with ink and paper colors" },
  { displayName: "Engraving", filter: engraving, category: "Stylize", description: "Parallel lines whose thickness varies with luminance — currency/illustration style" },
  { displayName: "Line art", filter: lineArt, category: "Stylize", description: "Extract clean black lines from edges, removing all shading" },
  { displayName: "Halftone", filter: halftone, category: "Stylize", description: "Simulate print halftone with variable-size dots" },
  { displayName: "K-means", filter: kmeans, category: "Stylize", description: "Cluster pixels into k dominant colors using iterative refinement" },
  { displayName: "Kuwahara", filter: kuwahara, category: "Stylize", description: "Edge-preserving smoothing for a painterly, watercolor-like look" },
  { displayName: "Pixelate", filter: pixelate, category: "Stylize", description: "Downscale into chunky pixel blocks" },
  { displayName: "Stripe (horizontal)", filter: horizontalStripe, category: "Stylize", description: "Overlay horizontal stripe pattern over the image" },
  { displayName: "Stripe (vertical)", filter: verticalStripe, category: "Stylize", description: "Overlay vertical stripe pattern over the image" },
  { displayName: "Pencil sketch", filter: pencilSketch, category: "Stylize", description: "Directional pencil strokes following edge flow with paper texture" },
  { displayName: "Pop art", filter: popArt, category: "Stylize", description: "Ben-Day dots with high saturation and flat posterized colors" },
  { displayName: "Posterize edges", filter: posterizeEdges, category: "Stylize", description: "Comic book / cel-shaded look — posterized colors with dark edge outlines" },
  { displayName: "Matrix rain", filter: matrixRain, category: "Stylize", description: "Matrix-style falling character rain using input image luminance" },
  { displayName: "Oil painting", filter: oilPainting, category: "Stylize", description: "Quantize colors locally for thick, blobby paint strokes" },
  { displayName: "Stained glass", filter: stainedGlass, category: "Stylize", description: "Voronoi cells with dark leading lines for a stained glass window look" },
  { displayName: "Stipple", filter: stipple, category: "Stylize", description: "Pointillist dot placement sized by luminance — no grid" },
  { displayName: "Risograph", filter: risograph, category: "Stylize", description: "Two-color spot separation with misregistration, grain, and ink bleed" },
  { displayName: "Watercolor bleed", filter: watercolorBleed, category: "Stylize", description: "Edge-preserving color bleed with paper texture — soft watercolor look" },
  { displayName: "Woodcut", filter: woodcut, category: "Stylize", description: "High-contrast relief with carved line texture following edge contours" },
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
  { displayName: "Liquify", filter: liquify, category: "Distort", description: "Organic pixel warping driven by luminance gradients" },
  { displayName: "Lens distortion", filter: lensDistortion, category: "Distort", description: "Apply barrel distortion like a wide-angle lens" },
  {
    displayName: "Lens distortion (pincushion)",
    category: "Distort",
    description: "Apply inward pincushion distortion like a telephoto lens",
    filter: { ...lensDistortion, options: { ...lensDistortion.options, k1: -0.3 } }
  },
  { displayName: "Pinch", filter: pinch, category: "Distort", description: "Squeeze pixels toward or away from center — radial scale distortion" },
  { displayName: "Ripple", filter: ripple, category: "Distort", description: "Concentric circular waves radiating from center" },
  { displayName: "Spherize", filter: spherize, category: "Distort", description: "Wrap image onto a sphere surface with adjustable strength" },
  { displayName: "Stretch", filter: stretch, category: "Distort", description: "Non-uniform X/Y scaling from center" },
  { displayName: "Mirror / Kaleidoscope", filter: mirror, category: "Distort", description: "Reflect the image along axes or create radial kaleidoscope patterns" },
  { displayName: "Turbulence", filter: turbulence, category: "Distort", description: "Perlin noise-driven displacement for organic warping" },
  { displayName: "Swirl", filter: swirl, category: "Distort", description: "Twist the image with rotation that increases toward the center" },
  { displayName: "Wave", filter: wave, category: "Distort", description: "Displace pixels along sine waves for a ripple effect" },

  // ── Glitch ──
  { displayName: "Bit crush", filter: bitCrush, category: "Glitch", description: "Reduce bit depth per channel for harsh color banding" },
  { displayName: "Channel separation", filter: channelSeparation, category: "Glitch", description: "Split and offset RGB channels for a glitchy color-fringe look" },
  { displayName: "Datamosh", filter: datamosh, category: "Glitch", description: "Simulate I-frame removal — blocks persist, smear, and corrupt like broken video compression" },
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
  { displayName: "Data bend", filter: dataBend, category: "Glitch", description: "Treat pixel data as audio — apply echo, reverb, bitcrush, or reverse" },
  { displayName: "Interlace tear", filter: interlaceTear, category: "Glitch", description: "Even/odd row offset simulating torn interlaced video" },
  { displayName: "Pixel scatter", filter: pixelScatter, category: "Glitch", description: "Explode pixels outward from edges — disintegration effect" },
  { displayName: "Analog static", filter: analogStatic, category: "Glitch", description: "Analog TV static — noise bars, vertical hold drift, and ghosting" },
  { displayName: "JPEG artifact", filter: jpegArtifact, category: "Glitch", description: "Apply DCT block compression artifacts at controllable quality and block size" },
  { displayName: "Pixel drift", filter: pixelDrift, category: "Glitch", description: "Pixels fall or rise based on luminance — melting/gravity effect" },
  { displayName: "Scan line shift", filter: scanLineShift, category: "Glitch", description: "Offset horizontal scan line blocks for a broken display glitch effect" },

  // ── Simulate ──
  { displayName: "Daguerreotype", filter: daguerreotype, category: "Simulate", description: "Early photography — silver-blue tone, soft focus, oval vignette, metallic sheen" },
  { displayName: "Infrared photography", filter: infrared, category: "Simulate", description: "IR film look — foliage turns white/pink, skies go dark, color shift" },
  { displayName: "LCD display", filter: lcdDisplay, category: "Simulate", description: "Visible sub-pixel grid — RGB stripe, PenTile, or diamond layout" },
  { displayName: "Fax machine", filter: faxMachine, category: "Simulate", description: "Low-res binary with scan line artifacts, thermal paper yellowing, and compression noise" },
  { displayName: "Lenticular", filter: lenticular, category: "Simulate", description: "Holographic rainbow sheen strips that shift with a simulated angle" },
  { displayName: "Newspaper", filter: newspaper, category: "Simulate", description: "Coarse halftone on yellowed paper with fold creases and ink smear" },
  { displayName: "Photocopier", filter: photocopier, category: "Simulate", description: "High contrast, edge darkening, speckle, and generation loss" },
  { displayName: "Risograph (multi-layer)", filter: risographMulti, category: "Simulate", description: "3-4 color spot separation with per-layer misregistration and grain" },
  { displayName: "Thermal printer", filter: thermalPrinter, category: "Simulate", description: "Receipt printer — low-res dots, paper curl gradient, thermal ink fade" },
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
  { displayName: "Deep fry", filter: deepFry, category: "Stylize", description: "Extreme contrast, oversaturation, and JPEG artifacts — the deep-fried meme aesthetic" },
  { displayName: "Edge glow", filter: edgeGlow, category: "Stylize", description: "Neon-colored edge outlines on a dark background — cyberpunk/Tron aesthetic" },
  { displayName: "Film grain", filter: filmGrain, category: "Stylize", description: "Add film-like noise grain with adjustable size and intensity" },
  { displayName: "E-ink (grayscale)", filter: eink, category: "Simulate", description: "Simulate a 16-level grayscale e-ink display with paper texture and ghosting" },
  {
    displayName: "E-ink (color)",
    category: "Simulate",
    description: "Simulate a color Kaleido/Gallery e-ink display with washed-out palette",
    filter: { ...eink, options: { ...eink.options, mode: "COLOR", palette: { ...eink.options.palette, options: { levels: 256 } } } }
  },
  { displayName: "Gameboy Camera", filter: gameboyCamera, category: "Simulate", description: "Simulate the Gameboy Camera — 4-shade green palette with edge enhancement and ordered dithering" },
  { displayName: "Mavica FD7", filter: mavicaFd7, category: "Simulate", description: "Emulate the Sony Mavica FD7 — low-res JPEG on a floppy disk" },
  { displayName: "Night vision", filter: nightVision, category: "Simulate", description: "Gen 3 image intensifier tube — green phosphor, heavy grain, bloom, and circular vignette" },
  { displayName: "Nokia LCD", filter: nokiaLcd, category: "Simulate", description: "Simulate the Nokia 3310 monochrome LCD — 84x48 pixels with greenish tint" },
  { displayName: "Oscilloscope", filter: oscilloscope, category: "Simulate", description: "Render as phosphor traces on a dark CRT oscilloscope screen with bloom and persistence" },
  { displayName: "Polaroid", filter: polaroid, category: "Simulate", description: "Instant film look — warm tones, faded blacks, soft highlights, and film grain" },
  { displayName: "Projection film", filter: projectionFilm, category: "Simulate", description: "16mm/35mm projector — gate weave, dust, scratches, grain, and lamp flicker" },
  {
    displayName: "Teletext",
    category: "Simulate",
    description: "Simulate a Teletext/Ceefax block mosaic display with 2x3 character cells and 8 colors",
    filter: {
      ...teletext,
      options: {
        ...teletext.options,
        palette: {
          ...palettes.user,
          options: { colors: THEMES.TELETEXT_BBC_MICRO }
        }
      }
    }
  },
  { displayName: "Thermal camera", filter: thermalCamera, category: "Simulate", description: "FLIR-style false-color thermal imaging with ironbow, rainbow, and hot/cold palettes" },
  { displayName: "Ultrasound", filter: ultrasound, category: "Simulate", description: "Medical ultrasound display — fan-shaped sector scan with speckle noise" },
  { displayName: "VHS emulation", filter: vhs, category: "Simulate", description: "Simulate VHS tape — tracking errors, chroma delay, head-switching noise, and ghosting" },

  // ── Blur & Edges ──
  { displayName: "Bloom", filter: bloom, category: "Blur & Edges", description: "Add a soft glow around bright areas" },
  { displayName: "Convolve", filter: convolve, category: "Blur & Edges", description: "Apply a custom convolution kernel — blur, sharpen, emboss, and more" },
  { displayName: "Bilateral blur", filter: bilateralBlur, category: "Blur & Edges", description: "Edge-preserving smooth — blurs flat areas while keeping edges crisp" },
  { displayName: "Bokeh", filter: bokeh, category: "Blur & Edges", description: "Simulate out-of-focus highlights with hexagonal or circular bokeh shapes" },
  { displayName: "Dilate / Erode", filter: morphology, category: "Blur & Edges", description: "Morphological operations — expand or shrink bright regions" },
  { displayName: "Emboss", filter: emboss, category: "Blur & Edges", description: "Directional relief effect with adjustable light angle and blend" },
  { displayName: "Gaussian blur", filter: gaussianBlur, category: "Blur & Edges", description: "Smooth the image with a Gaussian kernel — adjustable sigma" },
  { displayName: "Motion blur", filter: motionBlur, category: "Blur & Edges", description: "Directional blur simulating camera or object motion" },
  { displayName: "Radial blur", filter: radialBlur, category: "Blur & Edges", description: "Zoom blur radiating from center — speed/motion effect" },
  { displayName: "Sharpen", filter: sharpen, category: "Blur & Edges", description: "Unsharp mask — enhance edges with adjustable strength and radius" },
  { displayName: "Tilt shift", filter: tiltShift, category: "Blur & Edges", description: "Miniature/toy camera effect — sharp focus band with progressive blur" },
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
  { displayName: "Cellular automata", filter: cellularAutomata, category: "Advanced", description: "Conway's Game of Life and other rulesets applied to the image — animatable" },
  { displayName: "Displacement map XY", filter: displacementMapXY, category: "Advanced", description: "Use separate R/G channels as X/Y displacement maps for organic warping" },
  { displayName: "Fractal", filter: fractal, category: "Advanced", description: "Render Mandelbrot or Julia set fractals, optionally colored from the input image" },
  { displayName: "Noise generator", filter: noiseGenerator, category: "Advanced", description: "Procedural noise patterns — Perlin, Simplex, or Worley — mixable with the input" },
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

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
