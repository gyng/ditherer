import * as palettes from "palettes";
import { THEMES } from "palettes/user";
import { hasTemporalBehavior, type FilterDefinition, type FilterListEntry } from "./types";

import noop from "./noop";
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
import ordered, {
  BAYER_4X4,
  BAYER_8X8,
  BLUE_NOISE_64X64,
  THRESHOLD_POLARITY,
  WHITE_NOISE_64X64,
} from "./ordered";
import quantize from "./quantize";
import random from "./random";
import riemersma from "./riemersma";
import scanline from "./scanline";
import rgbStripe from "./rgbstripe";
import crtDegauss from "./crtDegauss";
import solarize from "./solarize";
import posterize from "./posterize";
import chromaticAberration from "./chromaticAberration";
import bloom from "./bloom";
import orton from "./orton";
import halation from "./halation";
import colorShift from "./colorShift";
import bitCrush from "./bitCrush";
import bitplaneDropout from "./bitplaneDropout";
import displace from "./displace";
import voronoi from "./voronoi";
import ascii from "./ascii";
import kuwahara from "./kuwahara";
import histogramEqualization from "./histogramEqualization";
import duotone from "./duotone";
import wave from "./wave";
import colorBalance from "./colorBalance";
import animeColorGrade from "./animeColorGrade";
import animeInkLines from "./animeInkLines";
import atmosphericHaze from "./atmosphericHaze";
import animeSky from "./animeSky";
import foliageSimplifier from "./foliageSimplifier";
import animeToneBands from "./animeToneBands";
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
import contourLines from "./contourLines";
import delaunay from "./delaunay";
import lightLeak from "./lightLeak";
import mezzotint from "./mezzotint";
import contourMap from "./contourMap";
import filmBurn from "./filmBurn";
import glitchBlocks from "./glitchBlocks";
import colorHalftoneSeparate from "./colorHalftoneSeparate";
import colorThreshold from "./colorThreshold";
import grainMerge from "./grainMerge";
import smoothPosterize from "./smoothPosterize";
import flowField from "./flowField";
import lensFlare from "./lensFlare";
import dodgeBurn from "./dodgeBurn";
import despeckle from "./despeckle";
import smudge from "./smudge";
import ditherGradient from "./ditherGradient";
import rotate from "./rotate";
import flip from "./flip";
import clahe from "./clahe";
import scale2x from "./scale2x";
import medianFilter from "./medianFilter";
import spectrogram from "./spectrogram";
import fftBandpass from "./fftBandpass";
import fftPhaseScramble from "./fftPhaseScramble";
import fftRadialNotch from "./fftRadialNotch";
import fftSpectralGate from "./fftSpectralGate";
import fftMagnitudePlot from "./fftMagnitudePlot";
import fftPhasePlot from "./fftPhasePlot";
import fftButterflyPlot from "./fftButterflyPlot";
import fftDephase from "./fftDephase";
import fftAngularWedge from "./fftAngularWedge";
import fftComponentPlot from "./fftComponentPlot";
import fftPhaseOnly from "./fftPhaseOnly";
import fftHomomorphic from "./fftHomomorphic";
import fftRadialProfile from "./fftRadialProfile";
import fftCepstrum from "./fftCepstrum";
import fftLogPolar from "./fftLogPolar";
import fftPolarHeatmap from "./fftPolarHeatmap";
import fftDeconvolve from "./fftDeconvolve";
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
import digicamFlash from "./digicamFlash";
import lenticular from "./lenticular";
import thermalPrinter from "./thermalPrinter";
import dataBend from "./dataBend";
import crcStripeReject from "./crcStripeReject";
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
import flipDotDisplay from "./flipDotDisplay";
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
import cameraShake from "./cameraShake";
import rhythmicWobble from "./rhythmicWobble";
import sepia from "./sepia";
import oilPainting from "./oilPainting";
import stainedGlass from "./stainedGlass";
import jpegArtifact from "./jpegArtifact";
import zigzag from "./zigzag";
import scanlineWarp from "./scanlineWarp";
import posterizeDither from "./posterizeDither";
import edgeTrace from "./edgeTrace";
import colorGradientNoise from "./colorGradientNoise";
import vintageTV from "./vintageTV";
import abaBounce from "./abaBounce";
import abaGhost from "./abaGhost";
import abaRebound from "./abaRebound";
import flicker from "./flicker";
import motionDetect from "./motionDetect";
import longExposure from "./longExposure";
import temporalEdge from "./temporalEdge";
import phosphorDecay from "./phosphorDecay";
import videoFeedback from "./videoFeedback";
import infiniteCallWindows from "./infiniteCallWindows";
import freezeFrameGlitch from "./freezeFrameGlitch";
import backgroundSubtraction from "./backgroundSubtraction";
import slitScan from "./slitScan";
import wakeTurbulence from "./wakeTurbulence";
import chronophotography from "./chronophotography";
import afterImage from "./afterImage";
import timeMosaic from "./timeMosaic";
import temporalColorCycle from "./temporalColorCycle";
import temporalPosterHold from "./temporalPosterHold";
import temporalInkDrying from "./temporalInkDrying";
import temporalRelief from "./temporalRelief";
import keyframeSmear from "./keyframeSmear";
import motionPixelate from "./motionPixelate";
import polarTransform from "./polarTransform";
import anaglyph from "./anaglyph";
import hexPixelate from "./hexPixelate";
import colorPop from "./colorPop";
import pixelOutline from "./pixelOutline";
import lumaMatte from "./lumaMatte";
import stamp from "./stamp";
import stopMotion from "./stopMotion";
import toon from "./toon";
import inkBleed from "./inkBleed";
import sumiE from "./sumiE";
import lut from "./lut";
import paperTexture from "./paperTexture";
import curves from "./curves";
import mode7 from "./mode7";
import trianglePixelate from "./trianglePixelate";
import halftoneLine from "./halftoneLine";
import crossStitch from "./crossStitch";
import echoCombiner from "./echoCombiner";
import timeWarpDisplacement from "./timeWarpDisplacement";
import povBands from "./povBands";
import medianCut from "./medianCut";
import duplexPrint from "./duplexPrint";
import motionVectors from "./motionVectors";
import screenPrint from "./screenPrint";
import reliefMap from "./reliefMap";
import facet from "./facet";
import paletteMapper from "./paletteMapper";
import paletteIndexDrift from "./paletteIndexDrift";
import isometricExtrude from "./isometricExtrude";
import octreeQuantize from "./octreeQuantize";
import frequencyFilter from "./frequencyFilter";
import metadataMismatchDecode from "./metadataMismatchDecode";
import temporalMedian from "./temporalMedian";
import temporalAA from "./temporalAA";
import mobius from "./mobius";
import droste from "./droste";
import anamorphicCylinder from "./anamorphicCylinder";
import wallpaperTiling from "./wallpaperTiling";
import cyanotype from "./cyanotype";
import sdfStylize from "./sdfStylize";
import caustics from "./caustics";
import reactionDiffusion from "./reactionDiffusion";
import stableFluids from "./stableFluids";
import lic from "./lic";
import flowCrosshatch from "./flowCrosshatch";
import fractalFlame from "./fractalFlame";
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

export { default as noop } from "./noop";
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
export { default as crtDegauss } from "./crtDegauss";
export { default as solarize } from "./solarize";
export { default as posterize } from "./posterize";
export { default as chromaticAberration } from "./chromaticAberration";
export { default as bloom } from "./bloom";
export { default as colorShift } from "./colorShift";
export { default as bitCrush } from "./bitCrush";
export { default as bitplaneDropout } from "./bitplaneDropout";
export { default as displace } from "./displace";
export { default as voronoi } from "./voronoi";
export { default as ascii } from "./ascii";
export { default as kuwahara } from "./kuwahara";
export { default as histogramEqualization } from "./histogramEqualization";
export { default as duotone } from "./duotone";
export { default as wave } from "./wave";
export { default as colorBalance } from "./colorBalance";
export { default as lensDistortion } from "./lensDistortion";
export { default as triangleDither } from "./triangleDither";
export { default as anisotropicDiffusion } from "./anisotropicDiffusion";
export { default as kmeans } from "./kmeans";
export { default as mavicaFd7 } from "./mavicaFd7";
export { default as digicamFlash } from "./digicamFlash";
export { default as gameboyCamera } from "./gameboyCamera";
export { default as teletext } from "./teletext";
export { default as datamosh } from "./datamosh";
export { default as zigzag } from "./zigzag";
export { default as cameraShake } from "./cameraShake";
export { default as rhythmicWobble } from "./rhythmicWobble";
export { default as scanlineWarp } from "./scanlineWarp";
export { default as posterizeDither } from "./posterizeDither";
export { default as edgeTrace } from "./edgeTrace";
export { default as colorGradientNoise } from "./colorGradientNoise";
export { default as vintageTV } from "./vintageTV";
export { default as abaBounce } from "./abaBounce";
export { default as abaGhost } from "./abaGhost";
export { default as abaRebound } from "./abaRebound";
export { default as flicker } from "./flicker";
export { default as polarTransform } from "./polarTransform";
export { default as anaglyph } from "./anaglyph";
export { default as hexPixelate } from "./hexPixelate";
export { default as colorPop } from "./colorPop";
export { default as pixelOutline } from "./pixelOutline";
export { default as lumaMatte } from "./lumaMatte";
export { default as stamp } from "./stamp";
export { default as stopMotion } from "./stopMotion";
export { default as toon } from "./toon";
export { default as inkBleed } from "./inkBleed";
export { default as curves } from "./curves";
export { default as mode7 } from "./mode7";
export { default as trianglePixelate } from "./trianglePixelate";
export { default as halftoneLine } from "./halftoneLine";
export { default as crossStitch } from "./crossStitch";
export { default as echoCombiner } from "./echoCombiner";
export { default as timeWarpDisplacement } from "./timeWarpDisplacement";
export { default as povBands } from "./povBands";
export { default as medianCut } from "./medianCut";
export { default as duplexPrint } from "./duplexPrint";
export { default as motionVectors } from "./motionVectors";
export { default as screenPrint } from "./screenPrint";
export { default as reliefMap } from "./reliefMap";
export { default as facet } from "./facet";
export { default as paletteMapper } from "./paletteMapper";
export { default as isometricExtrude } from "./isometricExtrude";
export { default as octreeQuantize } from "./octreeQuantize";
export { default as frequencyFilter } from "./frequencyFilter";
export { default as paletteIndexDrift } from "./paletteIndexDrift";
export { default as metadataMismatchDecode } from "./metadataMismatchDecode";
export { default as crcStripeReject } from "./crcStripeReject";
export { default as infiniteCallWindows } from "./infiniteCallWindows";
export { default as flipDotDisplay } from "./flipDotDisplay";
export { default as temporalMedian } from "./temporalMedian";
export { default as temporalAA } from "./temporalAA";
export { default as mobius } from "./mobius";
export { default as droste } from "./droste";
export { default as anamorphicCylinder } from "./anamorphicCylinder";
export { default as wallpaperTiling } from "./wallpaperTiling";
export { default as cyanotype } from "./cyanotype";
export { default as sdfStylize } from "./sdfStylize";
export { default as caustics } from "./caustics";
export { default as reactionDiffusion } from "./reactionDiffusion";
export { default as stableFluids } from "./stableFluids";
export { default as lic } from "./lic";
export { default as flowCrosshatch } from "./flowCrosshatch";
export { default as fractalFlame } from "./fractalFlame";
export { default as temporalPosterHold } from "./temporalPosterHold";
export { default as temporalInkDrying } from "./temporalInkDrying";
export { default as temporalRelief } from "./temporalRelief";
export { default as keyframeSmear } from "./keyframeSmear";
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

export const filterCategories = [
  "None", "Dithering", "Color", "Stylize", "Distort",
  "Glitch", "Simulate", "Blur & Edges", "Advanced"
];

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};

const withPaletteLevels = <T extends FilterDefinition>(
  filter: T,
  levels: number,
  extraOptions: Record<string, unknown> = {},
): T => {
  const options = asObject(filter.options);
  const palette = asObject(options.palette);
  const paletteOptions = asObject(palette.options);
  return {
    ...filter,
    options: {
      ...options,
      ...extraOptions,
      palette: {
        ...palette,
        options: {
          ...paletteOptions,
          levels,
        },
      },
    },
  } as T;
};

// Presets — grouped by category, alphabetized within each
export const filterList = [
  // ── None ──
  { displayName: "None", filter: noop, category: "None", description: "Pass-through — leaves the image unchanged. The default chain entry after Clear." },
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
  {
    displayName: "Atkinson (Mondrian)",
    category: "Dithering",
    description: "Atkinson dithering with Mondrian's 5-color De Stijl palette",
    filter: {
      ...atkinson,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.MONDRIAN }
        }
      }
    }
  },
  { displayName: "Binarize", filter: binarize, category: "Dithering", description: "Simple threshold to pure black and white with no error diffusion" },
  { displayName: "Burkes", filter: burkes, category: "Dithering", description: "Fast two-row error diffusion with smooth gradients" },
  { displayName: "Dither gradient", filter: ditherGradient, category: "Dithering", description: "Generate a smooth gradient and dither it — test pattern or standalone gradient art" },
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
    displayName: "Floyd-Steinberg (Synthwave)",
    category: "Dithering",
    description: "Floyd-Steinberg with a neon synthwave/outrun palette",
    filter: {
      ...floydSteinberg,
      options: {
        palette: {
          ...palettes.user,
          options: { colors: THEMES.SYNTHWAVE }
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
    displayName: "Ordered (Blue Noise 1-bit)",
    category: "Dithering",
    description: "Organic 1-bit ordered dithering with a void-and-cluster blue-noise threshold map",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        thresholdMap: BLUE_NOISE_64X64,
        thresholdPolarity: THRESHOLD_POLARITY.SHADOW,
        palette: { ...palettes.nearest, options: { levels: 2 } }
      }
    }
  },
  {
    displayName: "Ordered (Bayer Subject)",
    category: "Dithering",
    description: "High-structure 1-bit Bayer dither intended for edges, figures, and foreground emphasis",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        thresholdMap: BAYER_8X8,
        thresholdPolarity: THRESHOLD_POLARITY.CLASSIC,
        palette: { ...palettes.nearest, options: { levels: 2 } }
      }
    }
  },
  {
    displayName: "Ordered (Amber CRT)",
    category: "Dithering",
    description: "Ordered dithering with 4-shade amber phosphor CRT tones",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        palette: {
          ...palettes.user,
          options: { colors: THEMES.PHOSPHOR_AMBER }
        }
      }
    }
  },
  {
    displayName: "Ordered (Cream Detective)",
    category: "Dithering",
    description: "Cream-and-black 1-bit ordered dithering for monochrome mystery-game art",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        thresholdMap: BLUE_NOISE_64X64,
        thresholdPolarity: THRESHOLD_POLARITY.SHADOW,
        palette: {
          ...palettes.user,
          options: { colors: [[22, 18, 16, 255], [236, 218, 176, 255]] }
        }
      }
    }
  },
  {
    displayName: "Ordered (Fallwell Greenboy)",
    category: "Dithering",
    description: "Ordered dithering with a muted green Gameboy-style palette",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        palette: {
          ...palettes.user,
          options: { colors: THEMES.FALLWELL_GREENBOY }
        }
      }
    }
  },
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
    displayName: "Ordered (PICO-8)",
    category: "Dithering",
    description: "Ordered dithering with the PICO-8 fantasy console 16-color palette",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        palette: {
          ...palettes.user,
          options: { colors: THEMES.PICO8 }
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
  {
    displayName: "Ordered (White Noise 1-bit)",
    category: "Dithering",
    description: "Deterministic white-noise threshold dithering — noisy but shader-friendly and repeatable",
    filter: {
      ...ordered,
      options: {
        ...ordered.options,
        thresholdMap: WHITE_NOISE_64X64,
        thresholdPolarity: THRESHOLD_POLARITY.CLASSIC,
        palette: { ...palettes.nearest, options: { levels: 2 } }
      }
    }
  },
  { displayName: "Posterize dither", filter: posterizeDither, category: "Dithering", description: "Per-channel Bayer ordered dithering with configurable levels per channel" },
  { displayName: "Median Cut", filter: medianCut, category: "Dithering", description: "Build an adaptive palette with median-cut partitioning and remap the image to it" },
  { displayName: "Octree Quantize", filter: octreeQuantize, category: "Dithering", description: "Adaptive palette reduction using octree subdivision for a different quantization bias" },
  { displayName: "Quantize (No dithering)", filter: quantize, category: "Dithering", description: "Reduce colors by snapping each pixel to the nearest palette color" },
  { displayName: "Random", filter: random, category: "Dithering", description: "Add random noise before quantizing for a stippled, noisy texture" },
  { displayName: "Riemersma", filter: riemersma, category: "Dithering", description: "Hilbert-curve error diffusion with rolling exponential error memory" },
  { displayName: "Sierra (full)", filter: sierra, category: "Dithering", description: "Three-row error diffusion similar to Jarvis but with different weights" },
  { displayName: "Sierra (lite)", filter: sierraLite, category: "Dithering", description: "Minimal Sierra variant — fast with only two neighbors" },
  { displayName: "Sierra (two-row)", filter: sierra2, category: "Dithering", description: "Two-row Sierra for a balance between speed and quality" },
  { displayName: "Stucki", filter: stucki, category: "Dithering", description: "Three-row error diffusion with sharper results than Jarvis" },
  { displayName: "Threshold map", filter: thresholdMap, category: "Dithering", description: "Dither with custom threshold patterns — Bayer, halftone dot, diagonal, cross, diamond" },
  { displayName: "Triangle dither", filter: triangleDither, category: "Dithering", description: "Triangle-distributed noise dithering for film-like grain" },

  // ── Color ──
  { displayName: "Blend", filter: blend, category: "Color", description: "Blend with a color using standard modes — multiply, screen, overlay, and more" },
  { displayName: "Brightness/Contrast", filter: brightnessContrast, category: "Color", description: "Adjust image brightness and contrast levels" },
  { displayName: "Channel mixer", filter: channelMixer, category: "Color", description: "Arbitrary RGB matrix multiplication — swap, mix, or invert channels" },
  { displayName: "Chromatic posterize", filter: chromaticPosterize, category: "Color", description: "Posterize each RGB channel independently with different level counts" },
  { displayName: "CLAHE", filter: clahe, category: "Color", description: "Contrast Limited Adaptive Histogram Equalization — local contrast enhancement" },
  { displayName: "LUT", filter: lut, category: "Color", description: "Iconic colour-grade lookups — ACES, Reinhard, Hable, Teal & Orange, Bleach Bypass, Kodachrome, Technicolor, Cross Process, Matrix, Amber Noir, Faded Film, Cold Winter" },
  { displayName: "Anime Color Grade", filter: animeColorGrade, category: "Color", description: "Anime-background style grading — cooler cyan shadows, warmer highlights, and controlled vibrance" },
  { displayName: "Anime Ink Lines", filter: animeInkLines, category: "Color", description: "Turn image edges into anime-style ink lines, either overlaid on the source or on a flat background" },
  { displayName: "Anime Sky", filter: animeSky, category: "Color", description: "Simplify likely sky regions into a painted anime-style gradient or clouded sky" },
  { displayName: "Anime Tone Bands", filter: animeToneBands, category: "Color", description: "Broad anime-style light and shadow bands with softer tonal transitions" },
  { displayName: "Atmospheric Haze", filter: atmosphericHaze, category: "Color", description: "Painted atmospheric depth haze with horizon lift and sky-tinted bloom" },
  { displayName: "Color balance", filter: colorBalance, category: "Color", description: "Shift the balance between complementary color channels" },
  { displayName: "Color Pop", filter: colorPop, category: "Color", description: "Preserve one hue family while muting the rest toward monochrome" },
  { displayName: "Color halftone (RGB)", filter: colorHalftoneSeparate, category: "Color", description: "Split RGB channels into separate halftone dots with registration offset" },
  { displayName: "Color shift", filter: colorShift, category: "Color", description: "Rotate hue and shift saturation/lightness" },
  { displayName: "Color threshold", filter: colorThreshold, category: "Color", description: "Isolate pixels by hue range — keep selected colors, desaturate the rest" },
  { displayName: "Contour map", filter: contourMap, category: "Color", description: "Topographic-style elevation bands with distinct colors per luminance level" },
  { displayName: "Curves", filter: curves, category: "Color", description: "Remap tonal response with editable control points for RGB or single-channel shaping" },
  { displayName: "Dodge / Burn", filter: dodgeBurn, category: "Color", description: "Classic darkroom technique — dodge lightens shadows, burn darkens highlights" },
  { displayName: "Duplex / Offset Print", filter: duplexPrint, category: "Color", description: "Two-ink print simulation with paper stock showing through the tonal ramp" },
  { displayName: "Duotone", filter: duotone, category: "Color", description: "Map shadows and highlights to two custom colors" },
  { displayName: "Echo Combiner", filter: echoCombiner, category: "Color", description: "Amplify movement against the recent average while keeping or removing the static baseline" },
  { displayName: "Gradient map", filter: gradientMap, category: "Color", description: "Map luminance to a three-stop color gradient for creative toning" },
  { displayName: "Grain merge", filter: grainMerge, category: "Color", description: "High-pass texture enhancement — amplifies existing texture without adding noise" },
  { displayName: "Grayscale", filter: grayscale, category: "Color", description: "Convert to grayscale using perceptual luminance weights" },
  { displayName: "Foliage Simplifier", filter: foliageSimplifier, category: "Color", description: "Collapse leafy or grassy texture into larger painted masses while keeping silhouettes" },
  { displayName: "Histogram equalization", filter: histogramEqualization, category: "Color", description: "Redistribute tonal range for better contrast across the image" },
  {
    displayName: "Histogram equalization (per-channel)",
    category: "Color",
    description: "Equalize each RGB channel independently — can introduce color shifts",
    filter: { ...histogramEqualization, options: { ...histogramEqualization.options, perChannel: true } }
  },
  { displayName: "Invert", filter: invert, category: "Color", description: "Flip all colors to their complement (negative)" },
  { displayName: "Levels", filter: levels, category: "Color", description: "Adjust black point, white point, and gamma for precise tonal control" },
  { displayName: "Luma Matte", filter: lumaMatte, category: "Color", description: "Build a cutout matte from luminance and optionally output transparency" },
  { displayName: "Palette Mapper by Hue Bands", filter: paletteMapper, category: "Color", description: "Map hue families into fixed palette slots while preserving tonal structure" },
  { displayName: "Posterize", filter: posterize, category: "Color", description: "Reduce color levels per channel for a flat, poster-like look" },
  { displayName: "Sepia", filter: sepia, category: "Color", description: "Warm monochrome toning with adjustable intensity" },
  { displayName: "Solarize", filter: solarize, category: "Color", description: "Partially invert tones above a threshold for a surreal darkroom effect" },
  { displayName: "Vignette", filter: vignette, category: "Color", description: "Darken image edges with adjustable radius, softness, and shape" },

  // ── Stylize ──
  { displayName: "ASCII", filter: ascii, category: "Stylize", description: "Render the image as ASCII characters based on brightness" },
  { displayName: "CMYK halftone", filter: cmykHalftone, category: "Stylize", description: "Proper CMYK separation with independent screen angles per channel" },
  { displayName: "Contour lines", filter: contourLines, category: "Stylize", description: "Topographic contour lines from luminance — lines only, filled bands, or both" },
  { displayName: "Cross-stitch", filter: crossStitch, category: "Stylize", description: "Render the image as stitched X patterns on fabric for an embroidery look" },
  { displayName: "Crosshatch", filter: crosshatch, category: "Stylize", description: "Simulate pen-and-ink crosshatching with luminance-driven line density" },
  { displayName: "Delaunay triangulation", filter: delaunay, category: "Stylize", description: "Low-poly triangle mesh with edge-weighted point placement" },
  { displayName: "Dot matrix", filter: dotMatrix, category: "Stylize", description: "Fixed-pitch dot grid simulating a dot matrix printer with ink and paper colors" },
  { displayName: "Edge trace", filter: edgeTrace, category: "Stylize", description: "Canny-like edge tracing with non-maximum suppression and configurable line color" },
  { displayName: "Engraving", filter: engraving, category: "Stylize", description: "Parallel lines whose thickness varies with luminance — currency/illustration style" },
  { displayName: "Flip-Dot Display", filter: flipDotDisplay, category: "Stylize", description: "Electromechanical dot-sign board with bi-stable cells, hysteresis, and limited flip throughput" },
  {
    displayName: "Engraving (Blueprint)",
    category: "Stylize",
    description: "Engraving lines rendered in blueprint Prussian blue on white",
    filter: {
      ...engraving,
      options: {
        ...engraving.options,
        inkColor: THEMES.BLUEPRINT[0].slice(0, 3),
        paperColor: THEMES.BLUEPRINT[3].slice(0, 3)
      }
    }
  },
  { displayName: "Halftone", filter: halftone, category: "Stylize", description: "Simulate print halftone with variable-size dots" },
  { displayName: "K-means", filter: kmeans, category: "Stylize", description: "Cluster pixels into k dominant colors using iterative refinement" },
  { displayName: "Kuwahara", filter: kuwahara, category: "Advanced", description: "Edge-preserving smoothing for a painterly, watercolor-like look" },
  { displayName: "Line art", filter: lineArt, category: "Stylize", description: "Extract clean black lines from edges, removing all shading" },
  { displayName: "Matrix rain", filter: matrixRain, category: "Stylize", description: "Matrix-style falling character rain using input image luminance" },
  { displayName: "Mezzotint", filter: mezzotint, category: "Stylize", description: "Fine random dot texture — density encodes luminance, a specific printmaking technique" },
  { displayName: "Mosaic tile", filter: mosaicTile, category: "Stylize", description: "Pixelate with grout lines and per-tile color jitter" },
  { displayName: "Oil painting", filter: oilPainting, category: "Stylize", description: "Quantize colors locally for thick, blobby paint strokes" },
  { displayName: "Pencil sketch", filter: pencilSketch, category: "Stylize", description: "Directional pencil strokes following edge flow with paper texture" },
  { displayName: "Pixel art upscale", filter: scale2x, category: "Stylize", description: "Upscale with pixel art algorithms — Scale2x, Eagle, or nearest neighbor" },
  { displayName: "Pixel outline", filter: pixelOutline, category: "Stylize", description: "Draw sprite-like borders around sharp color regions for pixel-art styling" },
  { displayName: "Pixelate", filter: pixelate, category: "Stylize", description: "Downscale into chunky pixel blocks" },
  { displayName: "Hex pixelate", filter: hexPixelate, category: "Stylize", description: "Pixelate into staggered hex cells instead of square blocks" },
  { displayName: "Facet / Crystalize Grid", filter: facet, category: "Stylize", description: "Regularized faceted cells with crisp seams for a crystalized poster look" },
  { displayName: "Halftone Line", filter: halftoneLine, category: "Stylize", description: "Render short line marks per cell instead of dots for an etched halftone look" },
  { displayName: "Pop art", filter: popArt, category: "Stylize", description: "Ben-Day dots with high saturation and flat posterized colors" },
  { displayName: "Posterize edges", filter: posterizeEdges, category: "Stylize", description: "Comic book / cel-shaded look — posterized colors with dark edge outlines" },
  { displayName: "Risograph", filter: risograph, category: "Stylize", description: "Two-color spot separation with misregistration, grain, and ink bleed" },
  { displayName: "Smooth posterize", filter: smoothPosterize, category: "Stylize", description: "Posterize with smooth gradient transitions between bands — painted look" },
  { displayName: "Stained glass", filter: stainedGlass, category: "Stylize", description: "Voronoi cells with dark leading lines for a stained glass window look" },
  { displayName: "Stamp", filter: stamp, category: "Stylize", description: "Bold rubber-stamp print with rough edges and uneven ink coverage" },
  { displayName: "Stipple", filter: stipple, category: "Stylize", description: "Pointillist dot placement sized by luminance — no grid" },
  { displayName: "Stripe (horizontal)", filter: horizontalStripe, category: "Stylize", description: "Overlay horizontal stripe pattern over the image" },
  { displayName: "Stripe (vertical)", filter: verticalStripe, category: "Stylize", description: "Overlay vertical stripe pattern over the image" },
  { displayName: "Toon / Cel Shade", filter: toon, category: "Stylize", description: "Flat cartoon color bands with inked outlines for a cleaner cel-shaded look" },
  { displayName: "Triangle pixelate", filter: trianglePixelate, category: "Stylize", description: "Pixelate into alternating triangle cells for a faceted low-poly mosaic look" },
  { displayName: "Voronoi", filter: voronoi, category: "Stylize", description: "Divide the image into irregular cell regions with averaged colors" },
  { displayName: "Watercolor bleed", filter: watercolorBleed, category: "Stylize", description: "Edge-preserving color bleed with paper texture — soft watercolor look" },
  { displayName: "Woodcut", filter: woodcut, category: "Stylize", description: "High-contrast relief with carved line texture following edge contours" },
  {
    displayName: "Woodcut (Ukiyo-e)",
    category: "Stylize",
    description: "Woodcut with Japanese woodblock print colors — sumi ink on cream paper",
    filter: {
      ...woodcut,
      options: {
        ...woodcut.options,
        inkColor: THEMES.UKIYO_E[0].slice(0, 3),
        paperColor: THEMES.UKIYO_E[6].slice(0, 3)
      }
    }
  },
  { displayName: "Zigzag", filter: zigzag, category: "Stylize", description: "Zigzag herringbone pattern where line thickness encodes luminance" },
  { displayName: "Cyanotype", filter: cyanotype, category: "Stylize", description: "Prussian-blue sun-print tone mapping with paper grain and warm highlight tint" },
  { displayName: "SDF Stylize", filter: sdfStylize, category: "Stylize", description: "Distance-field stylisation via jump-flood: isolines, offset bands, or bevelled fills from a luminance iso-threshold" },
  { displayName: "Flow Crosshatch", filter: flowCrosshatch, category: "Stylize", description: "Crosshatch ink strokes that follow the image's edge flow rather than a fixed angle" },
  { displayName: "Line Integral Convolution", filter: lic, category: "Stylize", description: "Convolve noise along the gradient-tangent flow field — silky directional streaks" },
  { displayName: "Wallpaper Tiling", filter: wallpaperTiling, category: "Stylize", description: "Crystallographic symmetry groups (P1, P2, PMM, P4M, P6M) fold the image into repeated tiles" },

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
  { displayName: "Flip", filter: flip, category: "Distort", description: "Flip the image horizontally, vertically, or both" },
  { displayName: "Camera Shake", filter: cameraShake, category: "Distort", description: "Handheld whole-frame wobble — translation, rotation, and slight zoom breathing over time" },
  { displayName: "Rhythmic Wobble", filter: rhythmicWobble, category: "Distort", description: "Periodic whole-frame wobble with smooth sinusoidal drift and zoom breathing" },
  { displayName: "Lens distortion", filter: lensDistortion, category: "Distort", description: "Apply barrel distortion like a wide-angle lens" },
  {
    displayName: "Lens distortion (pincushion)",
    category: "Distort",
    description: "Apply inward pincushion distortion like a telephoto lens",
    filter: { ...lensDistortion, options: { ...lensDistortion.options, k1: -0.3 } }
  },
  { displayName: "Lens flare", filter: lensFlare, category: "Distort", description: "Camera lens flare with ghost reflections, anamorphic streak, and bloom" },
  { displayName: "Liquify", filter: liquify, category: "Distort", description: "Organic pixel warping driven by luminance gradients" },
  { displayName: "Isometric Extrude", filter: isometricExtrude, category: "Distort", description: "Turn the image into stacked isometric slabs with a directional extrusion shadow" },
  { displayName: "Mirror / Kaleidoscope", filter: mirror, category: "Distort", description: "Reflect the image along axes or create radial kaleidoscope patterns" },
  { displayName: "Mode 7", filter: mode7, category: "Distort", description: "Project the image onto a receding floor plane like a classic console racer" },
  { displayName: "Polar transform", filter: polarTransform, category: "Distort", description: "Wrap a rectangle into a circle or unwrap a circular image into a strip" },
  { displayName: "Pinch", filter: pinch, category: "Distort", description: "Squeeze pixels toward or away from center — radial scale distortion" },
  { displayName: "Ripple", filter: ripple, category: "Distort", description: "Concentric circular waves radiating from center" },
  { displayName: "Rotate", filter: rotate, category: "Distort", description: "Arbitrary angle rotation with bilinear sampling" },
  { displayName: "Smudge", filter: smudge, category: "Distort", description: "Paint-like smudging — drags color along a direction" },
  { displayName: "Spherize", filter: spherize, category: "Distort", description: "Wrap image onto a sphere surface with adjustable strength" },
  { displayName: "Stretch", filter: stretch, category: "Distort", description: "Non-uniform X/Y scaling from center" },
  { displayName: "Swirl", filter: swirl, category: "Distort", description: "Twist the image with rotation that increases toward the center" },
  { displayName: "Time-warp Displacement", filter: timeWarpDisplacement, category: "Distort", description: "Use luminance or position to sample different recent moments per pixel" },
  { displayName: "Turbulence", filter: turbulence, category: "Distort", description: "Perlin noise-driven displacement for organic warping" },
  { displayName: "Wave", filter: wave, category: "Distort", description: "Displace pixels along sine waves for a ripple effect" },
  { displayName: "Möbius transform", filter: mobius, category: "Distort", description: "Complex-plane Möbius transformation z → (az+b)/(cz+d) — conformal warp with spiralling fixed-point structure" },
  { displayName: "Droste spiral", filter: droste, category: "Distort", description: "Log-polar spiral recursion à la Escher's Prentententoonstelling — the image wraps into itself with an adjustable twist" },
  { displayName: "Anamorphic Cylinder", filter: anamorphicCylinder, category: "Distort", description: "Cylindrical anamorphosis — image stays normal inside a mirror radius and stretches logarithmically outside it" },
  { displayName: "Fractal Flame", filter: fractalFlame, category: "Distort", description: "Per-pixel fractal-flame-style IFS variations: swirl, spherical, horseshoe, heart, and more with layered multi-tap accumulation" },

  // ── Glitch ──
  { displayName: "Analog static", filter: analogStatic, category: "Glitch", description: "Analog TV static — noise bars, vertical hold drift, and ghosting" },
  { displayName: "Bit crush", filter: bitCrush, category: "Glitch", description: "Reduce bit depth per channel for harsh color banding" },
  { displayName: "Bitplane Dropout", filter: bitplaneDropout, category: "Glitch", description: "Corrupt specific RGB bitplanes in bursts so significance levels drop, freeze, or flip like real digital faults" },
  { displayName: "CRC Stripe Reject", filter: crcStripeReject, category: "Glitch", description: "Reject stripes or tiles like failed CRC packets, then conceal with hold, row-copy, or nearest-valid fill" },
  { displayName: "Channel separation", filter: channelSeparation, category: "Glitch", description: "Split and offset RGB channels for a glitchy color-fringe look" },
  { displayName: "Data bend", filter: dataBend, category: "Glitch", description: "Treat pixel data as audio — apply echo, reverb, bitcrush, or reverse" },
  { displayName: "Datamosh", filter: datamosh, category: "Glitch", description: "Simulate I-frame removal — blocks persist, smear, and corrupt like broken video compression" },
  { displayName: "Glitch", filter: glitchblob, category: "Glitch", description: "Randomly corrupt pixel data to simulate digital artifacts" },
  { displayName: "Glitch blocks", filter: glitchBlocks, category: "Glitch", description: "Rectangular block displacement — simulates GPU memory corruption" },
  { displayName: "Interlace tear", filter: interlaceTear, category: "Glitch", description: "Even/odd row offset simulating torn interlaced video" },
  { displayName: "Jitter", filter: jitter, category: "Glitch", description: "Randomly shift pixel rows for a shaky, unstable signal look" },
  { displayName: "JPEG artifact", filter: jpegArtifact, category: "Glitch", description: "Apply DCT block compression artifacts at controllable quality and block size" },
  { displayName: "Palette Index Drift", filter: paletteIndexDrift, category: "Glitch", description: "Map into an indexed palette, then drift the lookup table over time so colors break while geometry stays stable" },
  { displayName: "Pixel drift", filter: pixelDrift, category: "Glitch", description: "Pixels fall or rise based on luminance — melting/gravity effect" },
  { displayName: "Pixel scatter", filter: pixelScatter, category: "Glitch", description: "Explode pixels outward from edges — disintegration effect" },
  {
    displayName: "Pixelsort",
    category: "Glitch",
    description: "Sort pixel spans by brightness for dramatic streak effects",
    filter: withPaletteLevels(pixelsort, 256)
  },
  { displayName: "Scan line shift", filter: scanLineShift, category: "Glitch", description: "Offset horizontal scan line blocks for a broken display glitch effect" },
  { displayName: "Scanline Warp", filter: scanlineWarp, category: "Glitch", description: "Sinusoidal horizontal displacement with animatable phase — wavy CRT glitch" },

  // ── Simulate ──
  { displayName: "Anisotropic diffusion", filter: anisotropicDiffusion, category: "Advanced", description: "Smooth flat regions while preserving edges — like Perona-Malik filtering" },
  { displayName: "Anaglyph 3D", filter: anaglyph, category: "Simulate", description: "Split channels into stereoscopic color pairs for a fake 3D glasses effect" },
  {
    displayName: "CRT emulation",
    category: "Simulate",
    description: "Simulate a CRT monitor with phosphor mask, bloom, scanlines, curvature, and vignette",
    filter: withPaletteLevels(rgbStripe, 32)
  },
  { displayName: "CRT Degauss", filter: crtDegauss, category: "Simulate", description: "Fire a decaying degauss pulse with raster wobble, phosphor mislanding, and a bright magnetic flash" },
  { displayName: "Daguerreotype", filter: daguerreotype, category: "Simulate", description: "Early photography — silver-blue tone, soft focus, oval vignette, metallic sheen" },
  { displayName: "Digicam Flash", filter: digicamFlash, category: "Simulate", description: "On-camera point-and-shoot flash look with center hotspot, fast falloff, clipped highlights, and edge burn" },
  { displayName: "Deep fry", filter: deepFry, category: "Stylize", description: "Extreme contrast, oversaturation, and JPEG artifacts — the deep-fried meme aesthetic" },
  {
    displayName: "E-ink (color)",
    category: "Simulate",
    description: "Simulate a color Kaleido/Gallery e-ink display with washed-out palette",
    filter: withPaletteLevels(eink, 256, { mode: "COLOR" })
  },
  { displayName: "E-ink (grayscale)", filter: eink, category: "Simulate", description: "Simulate a 16-level grayscale e-ink display with paper texture and ghosting" },
  { displayName: "Edge glow", filter: edgeGlow, category: "Stylize", description: "Neon-colored edge outlines on a dark background — cyberpunk/Tron aesthetic" },
  { displayName: "Fax machine", filter: faxMachine, category: "Simulate", description: "Low-res binary with scan line artifacts, thermal paper yellowing, and compression noise" },
  { displayName: "Film burn", filter: filmBurn, category: "Simulate", description: "Aged film stock — warm edge cast, overexposed hotspots, grain intensification" },
  { displayName: "Film grain", filter: filmGrain, category: "Stylize", description: "Add film-like noise grain with adjustable size and intensity" },
  { displayName: "Ink Bleed", filter: inkBleed, category: "Simulate", description: "Spread dark regions into the paper like wet ink on cheap stock" },
  { displayName: "Paper Texture", filter: paperTexture, category: "Simulate", description: "Procedural paper, canvas, linen, cardboard, or parchment texture overlay — grounds digital images on material substrate" },
  { displayName: "Sumi-e", filter: sumiE, category: "Stylize", description: "Japanese ink-wash painting — quantized tonal washes with Sobel brush strokes on paper" },
  { displayName: "Gameboy Camera", filter: gameboyCamera, category: "Simulate", description: "Simulate the Gameboy Camera — 4-shade green palette with edge enhancement and ordered dithering" },
  { displayName: "Infrared photography", filter: infrared, category: "Simulate", description: "IR film look — foliage turns white/pink, skies go dark, color shift" },
  { displayName: "LCD display", filter: lcdDisplay, category: "Simulate", description: "Visible sub-pixel grid — RGB stripe, PenTile, or diamond layout" },
  { displayName: "Lenticular", filter: lenticular, category: "Simulate", description: "Holographic rainbow sheen strips that shift with a simulated angle" },
  { displayName: "Light leak", filter: lightLeak, category: "Simulate", description: "Film light leak — warm chromatic glow bleeding from edges/corners" },
  { displayName: "Mavica FD7", filter: mavicaFd7, category: "Simulate", description: "Emulate the Sony Mavica FD7 — low-res JPEG on a floppy disk" },
  { displayName: "Metadata Mismatch Decode", filter: metadataMismatchDecode, category: "Simulate", description: "Apply wrong gamma, matrix, range, and chroma assumptions to mimic authentic decode metadata failures" },
  { displayName: "Newspaper", filter: newspaper, category: "Simulate", description: "Coarse halftone on yellowed paper with fold creases and ink smear" },
  { displayName: "Night vision", filter: nightVision, category: "Simulate", description: "Gen 3 image intensifier tube — green phosphor, heavy grain, bloom, and circular vignette" },
  { displayName: "Nokia LCD", filter: nokiaLcd, category: "Simulate", description: "Simulate the Nokia 3310 monochrome LCD — 84x48 pixels with greenish tint" },
  { displayName: "Oscilloscope", filter: oscilloscope, category: "Simulate", description: "Render as phosphor traces on a dark CRT oscilloscope screen with bloom and persistence" },
  { displayName: "Photocopier", filter: photocopier, category: "Simulate", description: "High contrast, edge darkening, speckle, and generation loss" },
  { displayName: "Polaroid", filter: polaroid, category: "Simulate", description: "Instant film look — warm tones, faded blacks, soft highlights, and film grain" },
  { displayName: "Projection film", filter: projectionFilm, category: "Simulate", description: "16mm/35mm projector — gate weave, dust, scratches, grain, and lamp flicker" },
  { displayName: "Risograph (multi-layer)", filter: risographMulti, category: "Simulate", description: "3-4 color spot separation with per-layer misregistration and grain" },
  { displayName: "Screen Print / Misregistration", filter: screenPrint, category: "Simulate", description: "Layer flat spot-color plates with visible offset on warm paper for a silkscreen poster look" },
  {
    displayName: "Scanline",
    category: "Simulate",
    description: "CRT-style scanlines with either classic darkened rows or RGB phosphor sub-line separation",
    filter: withPaletteLevels(scanline, 256, { mode: "DARKEN" })
  },
  { displayName: "Spectrogram", filter: spectrogram, category: "Simulate", description: "Frequency-domain visualization — columns as time, rows as frequency, with scientific colormaps" },
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
  { displayName: "Thermal printer", filter: thermalPrinter, category: "Simulate", description: "Receipt printer — low-res dots, paper curl gradient, thermal ink fade" },
  { displayName: "Ultrasound", filter: ultrasound, category: "Simulate", description: "Medical ultrasound display — fan-shaped sector scan with speckle noise" },
  { displayName: "VHS emulation", filter: vhs, category: "Simulate", description: "Simulate VHS tape — tracking errors, chroma delay, head-switching noise, and ghosting" },
  { displayName: "Vintage TV", filter: vintageTV, category: "Simulate", description: "Old TV with banding, color fringe, vertical roll, and glow — animatable" },
  { displayName: "Motion Analysis", filter: motionDetect, category: "Simulate", description: "Analyze motion against the background model or previous frame and render it as a mask, highlight, or persistent heatmap" },
  { displayName: "Long Exposure", filter: longExposure, category: "Simulate", description: "Blend, average, or accumulate recent frames for ghost trails, slow-shutter smear, and long-exposure light painting" },
  { displayName: "Phosphor decay", filter: phosphorDecay, category: "Simulate", description: "CRT phosphor persistence — each RGB channel decays at a different rate" },

  // ── Blur & Edges ──
  { displayName: "Bilateral blur", filter: bilateralBlur, category: "Blur & Edges", description: "Edge-preserving smooth — blurs flat areas while keeping edges crisp" },
  { displayName: "Bloom", filter: bloom, category: "Blur & Edges", description: "Add a soft glow around bright areas" },
  { displayName: "Bokeh", filter: bokeh, category: "Blur & Edges", description: "Simulate out-of-focus highlights with hexagonal or circular bokeh shapes" },
  { displayName: "Orton", filter: orton, category: "Blur & Edges", description: "Dreamy photographic glow — screen-blends a blurred copy over the image for a painterly soft look" },
  { displayName: "Halation", filter: halation, category: "Blur & Edges", description: "Red/pink bleed around bright highlights — emulates CineStill 800T and missing anti-halation film layers" },
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
  { displayName: "Despeckle", filter: despeckle, category: "Blur & Edges", description: "Adaptive noise removal — smooths noisy areas while preserving structured detail" },
  { displayName: "Dilate / Erode", filter: morphology, category: "Advanced", description: "Morphological operations — expand or shrink bright regions" },
  { displayName: "Emboss", filter: emboss, category: "Blur & Edges", description: "Directional relief effect with adjustable light angle and blend" },
  { displayName: "Gaussian blur", filter: gaussianBlur, category: "Blur & Edges", description: "Smooth the image with a Gaussian kernel — adjustable sigma" },
  { displayName: "Median filter", filter: medianFilter, category: "Blur & Edges", description: "Non-linear noise removal — replaces each pixel with the median of its neighborhood" },
  { displayName: "Motion blur", filter: motionBlur, category: "Blur & Edges", description: "Directional blur simulating camera or object motion" },
  { displayName: "Relief Map / Faux Normal Lighting", filter: reliefMap, category: "Blur & Edges", description: "Treat luminance like a height field and relight it with directional faux-surface shading" },
  { displayName: "Radial blur", filter: radialBlur, category: "Blur & Edges", description: "Zoom blur radiating from center — speed/motion effect" },
  { displayName: "Sharpen", filter: sharpen, category: "Blur & Edges", description: "Unsharp mask — enhance edges with adjustable strength and radius" },
  { displayName: "Tilt shift", filter: tiltShift, category: "Blur & Edges", description: "Miniature/toy camera effect — sharp focus band with progressive blur" },
  { displayName: "Temporal Edge", filter: temporalEdge, category: "Blur & Edges", description: "Detect edges in time — moving edges glow, static edges invisible" },

  // ── Temporal ──
  { displayName: "After-image", filter: afterImage, category: "Simulate", description: "Complementary-colored ghost when bright objects move — retinal fatigue" },
  { displayName: "Scene Separation", filter: backgroundSubtraction, category: "Color", description: "Separate moving and static regions to isolate foreground, reconstruct the background, or freeze still parts of the scene" },
  { displayName: "Chronophotography", filter: chronophotography, category: "Stylize", description: "Multiple ghosted exposures of moving subjects — stroboscopic photography" },
  { displayName: "Freeze frame glitch", filter: freezeFrameGlitch, category: "Glitch", description: "Random blocks freeze in time — corrupted buffer aesthetic" },
  { displayName: "Motion pixelate", filter: motionPixelate, category: "Stylize", description: "Moving areas become pixelated — privacy or artistic motion effect" },
  { displayName: "POV Bands", filter: povBands, category: "Stylize", description: "Show different recent moments across horizontal bands like a persistence-of-vision display" },
  { displayName: "Slit scan", filter: slitScan, category: "Distort", description: "Each column shows a different point in time — surreal temporal stretching" },
  { displayName: "Stop Motion", filter: stopMotion, category: "Stylize", description: "Hold each frame for several beats to create a choppy stop-motion cadence" },
  { displayName: "ABA Bounce", filter: abaBounce, category: "Stylize", description: "Three-beat A-B-A cadence that snaps the third beat back to the first frame in the triplet" },
  { displayName: "ABA Ghost", filter: abaGhost, category: "Stylize", description: "Three-beat A-B-A cadence with a double-exposed third beat that ghosts the skipped frame against the first" },
  { displayName: "ABA Rebound", filter: abaRebound, category: "Distort", description: "On the third beat, push motion away from the first frame in the triplet for a recoiling ABA judder" },
  { displayName: "Flicker", filter: flicker, category: "Stylize", description: "Aggressive flicker/strobe filter with live ghosting and held-frame flash modes" },
  { displayName: "Keyframe Smear", filter: keyframeSmear, category: "Stylize", description: "Capture sparse keyframes and drag them through in-between frames for compressed temporal smearing" },
  { displayName: "Ink Drying", filter: temporalInkDrying, category: "Stylize", description: "Fresh dark marks stay wet, bleed slightly, and then dry back toward the page" },
  { displayName: "Time Median", filter: temporalMedian, category: "Simulate", description: "Per-pixel median across recent frames to suppress brief motion and flicker while preserving stable structure" },
  { displayName: "Temporal AA", filter: temporalAA, category: "Blur & Edges", description: "Blend previous output into the current frame with neighborhood color clamping — temporal anti-aliasing that smooths flicker and shimmer without ghosting" },
  { displayName: "Color Cycle", filter: temporalColorCycle, category: "Color", description: "Hue rotates over time — moving areas cycle faster into rainbow trails" },
  { displayName: "Poster Hold", filter: temporalPosterHold, category: "Color", description: "Posterized tone bands update with hysteresis so broad regions hold before snapping to new values" },
  { displayName: "Motion Relief", filter: temporalRelief, category: "Blur & Edges", description: "Turn recent change history into embossed grayscale relief shading" },
  { displayName: "Time mosaic", filter: timeMosaic, category: "Stylize", description: "Tiles update at different rates — staggered surveillance-wall aesthetic" },
  { displayName: "Infinite call windows", filter: infiniteCallWindows, category: "Advanced", description: "Recursive video-call panes with digital UI chrome and compression-style decay" },
  { displayName: "Video feedback", filter: videoFeedback, category: "Advanced", description: "Camera-at-monitor effect — infinite recursive tunnels and fractal patterns" },
  { displayName: "Wake turbulence", filter: wakeTurbulence, category: "Distort", description: "Moving objects leave rippling distortion — heat shimmer effect" },

  // ── Advanced ──
  { displayName: "Cellular automata", filter: cellularAutomata, category: "Advanced", description: "Conway's Game of Life and other rulesets applied to the image — animatable" },
  { displayName: "Reaction-Diffusion", filter: reactionDiffusion, category: "Advanced", description: "Gray-Scott reaction-diffusion seeded from image luminance — spots, stripes, coral, mitosis, labyrinth Turing patterns grow out of the picture" },
  { displayName: "Stable Fluids", filter: stableFluids, category: "Advanced", description: "Stam-style semi-Lagrangian fluid advection — smoke flows along the image's edges, picking up gradients as forcing each frame" },
  { displayName: "Caustics", filter: caustics, category: "Advanced", description: "Refract light through the image as through a glass surface — bright caustic webs where gradients converge, shadows where they diverge" },
  { displayName: "Color gradient noise", filter: colorGradientNoise, category: "Advanced", description: "Perlin noise mapped to a two-color gradient, blended with the input image" },
  { displayName: "Displacement map XY", filter: displacementMapXY, category: "Advanced", description: "Use separate R/G channels as X/Y displacement maps for organic warping" },
  { displayName: "Flow field", filter: flowField, category: "Advanced", description: "Displace pixels along curl noise streamlines for organic swirling patterns" },
  { displayName: "Frequency Filter", filter: frequencyFilter, category: "Advanced", description: "Approximate low, high, or band-pass image frequencies in the spatial domain" },
  { displayName: "FFT Bandpass", filter: fftBandpass, category: "Advanced", description: "Real 2D FFT low/high/band-pass — radial frequency mask, not a blur proxy" },
  { displayName: "FFT Phase Scramble", filter: fftPhaseScramble, category: "Advanced", description: "Randomise 2D FFT phase while keeping magnitude — same spectral energy, scrambled geometry" },
  { displayName: "FFT Radial Notch", filter: fftRadialNotch, category: "Advanced", description: "Zero out a circular ring in the 2D FFT — kills periodic patterns (scan lines, dot screens, weaves)" },
  { displayName: "FFT Spectral Gate", filter: fftSpectralGate, category: "Advanced", description: "Keep only frequency bins above a magnitude threshold — frequency-domain denoise that preserves dominant structure" },
  { displayName: "FFT Magnitude Plot", filter: fftMagnitudePlot, category: "Advanced", description: "Log-magnitude visualisation of the 2D FFT — DC centred, false-colour" },
  { displayName: "FFT Phase Plot", filter: fftPhasePlot, category: "Advanced", description: "Hue-mapped phase of the 2D FFT" },
  { displayName: "FFT Butterfly Plot", filter: fftButterflyPlot, category: "Advanced", description: "Render the FFT at any intermediate pipeline stage — watch the spatial image crystallise into its Fourier representation" },
  { displayName: "FFT Dephase", filter: fftDephase, category: "Advanced", description: "Zero the FFT phase, keep magnitude — inverse transform becomes the image's autocorrelation (symmetric feature halo)" },
  { displayName: "FFT Angular Wedge", filter: fftAngularWedge, category: "Advanced", description: "Keep or kill FFT bins within a wedge of angles — isolates or removes directional patterns (horizontal lines, diagonal weaves, etc.)" },
  { displayName: "FFT Component Plot", filter: fftComponentPlot, category: "Advanced", description: "Diverging-colormap plot of the FFT's real or imaginary component — reveals even/odd symmetry in the source" },
  { displayName: "FFT Phase Only", filter: fftPhaseOnly, category: "Advanced", description: "Keep FFT phase, replace all magnitudes with a constant — classic demo that phase carries structure" },
  { displayName: "FFT Homomorphic", filter: fftHomomorphic, category: "Advanced", description: "Flatten uneven illumination while boosting local contrast — log(image) → FFT → high-freq emphasis → IFFT → exp" },
  { displayName: "FFT Radial Profile", filter: fftRadialProfile, category: "Advanced", description: "1D graph of angular-averaged power spectrum vs spatial frequency — natural images show 1/f slope" },
  { displayName: "FFT Cepstrum", filter: fftCepstrum, category: "Advanced", description: "Cepstrum = IFFT(log |FFT|). Repeating patterns / echoes show up as bright points at their spatial period" },
  { displayName: "FFT Log-Polar", filter: fftLogPolar, category: "Advanced", description: "Log-polar remap of the FFT magnitude — rotation/scale invariance up to translation" },
  { displayName: "FFT Polar Heatmap", filter: fftPolarHeatmap, category: "Advanced", description: "FFT magnitude on a polar disc — directional streaks become spokes, periodic patterns become rings" },
  { displayName: "FFT Deconvolve", filter: fftDeconvolve, category: "Advanced", description: "Wiener deconvolution against a built-in Gaussian or motion-blur kernel — undoes blur" },
  { displayName: "Fractal", filter: fractal, category: "Advanced", description: "Render Mandelbrot or Julia set fractals, optionally colored from the input image" },
  { displayName: "Noise generator", filter: noiseGenerator, category: "Advanced", description: "Procedural noise patterns — Perlin, Simplex, or Worley — mixable with the input" },
  { displayName: "Motion Vectors", filter: motionVectors, category: "Advanced", description: "Estimate local motion between frames and render stable arrows, trails, or heat overlays for debugging and stylized analysis" },
  {
    displayName: "Program",
    category: "Advanced",
    description: "Write custom pixel-manipulation code in a built-in editor",
    filter: withPaletteLevels(program, 256)
  },
] satisfies FilterListEntry[];

// Worker lookup and saved-state deserialization both resolve filters by
// `filter.name`, so derive the registry from the same list the UI uses.
// This keeps the browser picker and worker execution path in sync.
export const filterIndex = filterList.reduce((acc, entry) => {
  acc[entry.filter.name] = entry.filter;
  return acc;
}, {} as Record<string, FilterDefinition>);

export { hasTemporalBehavior };

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}
