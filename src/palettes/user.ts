import { COLOR_ARRAY, COLOR_DISTANCE_ALGORITHM } from "constants/controlTypes";

import { rgba, colorDistance, wasmNearestLabPrecomputed } from "utils";
import { LAB_NEAREST } from "constants/color";

// https://en.wikipedia.org/wiki/List_of_8-bit_computer_hardware_palettes
// https://en.wikipedia.org/wiki/Color_Graphics_Adapter

const cga = {
  BLACK: rgba(0, 0, 0, 255), // 0 black
  BLUE: rgba(0, 0, 170, 255), // 1 blue
  GREEN: rgba(0, 170, 0, 255), // 2 green
  CYAN: rgba(0, 170, 170, 255), // 3 cyan
  RED: rgba(170, 0, 0, 255), // 4 red
  MAGENTA: rgba(170, 0, 170, 255), // 5 magenta
  YELLOW: rgba(170, 170, 0, 255), // 6 yellow
  WHITE: rgba(170, 170, 170, 255), // 7 white
  BBLACK: rgba(85, 85, 85, 255), // 8 bright black
  BBLUE: rgba(85, 85, 255, 255), // 9 bright blue
  BGREEN: rgba(85, 255, 85, 255), // 10 bright green
  BCYAN: rgba(85, 255, 255, 255), // 11 bright cyan
  BRED: rgba(255, 85, 85, 255), // 12 bright red
  BMAGENTA: rgba(255, 85, 255, 255), // 13 bright magenta
  BYELLOW: rgba(255, 255, 85, 255), // 14 bright yellow
  BWHITE: rgba(255, 255, 255, 255) // 15 bright white
};

export const THEMES = {
  CMYK: [
    rgba(0, 255, 255, 255), // cyan
    rgba(255, 0, 255, 255), // magenta
    rgba(255, 255, 0, 255), // yellow
    rgba(0, 0, 0, 255), // black
    rgba(255, 255, 255, 255)
  ],
  EGA_MODE4_PALETTE1_LOW: [cga.BLACK, cga.WHITE, cga.MAGENTA, cga.CYAN],
  EGA_MODE4_PALETTE1_HIGH: [cga.BLACK, cga.WHITE, cga.BMAGENTA, cga.BCYAN],
  EGA_MODE4_PALETTE2_LOW: [cga.BLACK, cga.GREEN, cga.RED, cga.YELLOW],
  EGA_MODE4_PALETTE2_HIGH: [cga.BLACK, cga.BGREEN, cga.BRED, cga.BYELLOW],
  EGA_MODE5_PALETTE3_LOW: [cga.BLACK, cga.CYAN, cga.RED, cga.BBLACK],
  EGA_MODE5_PALETTE3_HIGH: [cga.BLACK, cga.BCYAN, cga.BRED, cga.BWHITE],
  CGA: [
    cga.BLACK,
    cga.BLUE,
    cga.GREEN,
    cga.CYAN,
    cga.RED,
    cga.MAGENTA,
    cga.YELLOW,
    cga.WHITE,
    cga.BBLACK,
    cga.BBLUE,
    cga.BGREEN,
    cga.BCYAN,
    cga.BRED,
    cga.BMAGENTA,
    cga.BYELLOW,
    cga.BWHITE
  ],
  // https://upload.wikimedia.org/wikipedia/commons/1/14/CGA-NTSC-colors.png
  CGA_NTSC: [
    rgba(0, 0, 0, 255), // black
    rgba(0, 14, 163, 255), // blue
    rgba(0, 119, 23, 255), // green
    rgba(0, 156, 118, 255), // cyan
    rgba(111, 7, 31, 255), // red
    rgba(130, 34, 168, 255), // magenta
    rgba(117, 143, 26, 255), // yellow
    rgba(162, 162, 162, 255), // white
    rgba(73, 73, 73, 255), // bblack
    rgba(109, 92, 253, 255), // bblue
    rgba(94, 210, 75, 255), // bgreen
    rgba(105, 250, 209, 255), // bcyan
    rgba(204, 80, 116, 255), // bred
    rgba(224, 117, 254, 255), // bmagenta
    rgba(210, 237, 79, 255), // byellow
    rgba(255, 255, 255, 255) // bwhite
  ],
  // https://en.wikipedia.org/wiki/List_of_software_palettes#Microsoft_Windows_default_20-color_palette
  CGA_MICROSOFT_256: [
    cga.BLACK,
    cga.BLUE,
    cga.GREEN,
    cga.CYAN,
    cga.RED,
    cga.MAGENTA,
    cga.YELLOW,
    cga.WHITE,
    cga.BBLACK,
    cga.BBLUE,
    cga.BGREEN,
    cga.BCYAN,
    cga.BRED,
    cga.BMAGENTA,
    cga.BYELLOW,
    cga.BWHITE,
    rgba(188, 219, 192, 255),
    rgba(157, 201, 238, 255),
    rgba(255, 251, 240, 255),
    rgba(158, 159, 162, 255)
  ],
  // https://en.wikipedia.org/wiki/File:Commodore64_palette.png
  C64: [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
    rgba(166, 77, 69, 255),
    rgba(88, 192, 199, 255),
    rgba(164, 88, 161, 255),
    rgba(82, 171, 100, 255),
    rgba(77, 71, 152, 255),
    rgba(203, 212, 141, 255),
    rgba(168, 104, 64, 255),
    rgba(113, 84, 28, 255),
    rgba(210, 125, 119, 255),
    rgba(99, 99, 99, 255),
    rgba(138, 138, 138, 255),
    rgba(144, 226, 157, 255),
    rgba(134, 126, 202, 255),
    rgba(174, 173, 174, 255)
  ],
  C64_NTSC: [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
    rgba(255, 52, 24, 255),
    rgba(0, 222, 253, 255),
    rgba(170, 78, 199, 255),
    rgba(95, 185, 89, 255),
    rgba(0, 77, 204, 255),
    rgba(255, 236, 84, 255),
    rgba(255, 90, 30, 255),
    rgba(201, 65, 22, 255),
    rgba(255, 113, 77, 255),
    rgba(96, 96, 96, 255),
    rgba(135, 152, 109, 255),
    rgba(170, 255, 157, 255),
    rgba(35, 136, 250, 255),
    rgba(195, 184, 213, 255)
  ],
  // https://en.wikipedia.org/wiki/File:BbcMicro_palette_color_test_chart.png
  TELETEXT_BBC_MICRO: [
    rgba(0, 0, 0, 255),
    rgba(255, 15, 22, 255),
    rgba(0, 254, 62, 255),
    rgba(0, 30, 250, 255),
    rgba(0, 255, 254, 255),
    rgba(255, 27, 249, 255),
    rgba(255, 254, 64, 255),
    rgba(255, 255, 255, 255)
  ],
  MAC2: [
    rgba(255, 255, 255, 255), // white
    rgba(255, 255, 0, 255), // yellow
    rgba(255, 102, 0, 255), // orange
    rgba(221, 0, 0, 255), // red
    rgba(255, 0, 153, 255), // magenta
    rgba(51, 0, 153, 255), // purple
    rgba(0, 0, 204, 255), // blue
    rgba(0, 153, 255, 255), // cyan
    rgba(0, 170, 0, 255), // green
    rgba(0, 102, 0, 255), // dark green
    rgba(102, 51, 0, 255), // brown
    rgba(153, 102, 51, 255), // tan
    rgba(187, 187, 187, 255), // light grey
    rgba(136, 136, 136, 255), // medium grey
    rgba(68, 68, 68, 255), // dark grey
    rgba(0, 0, 0, 255) // black
  ],
  // https://en.wikipedia.org/wiki/File:AppleII_palette.png
  APPLE2: [
    rgba(0, 0, 0, 255),
    rgba(137, 61, 81, 255),
    rgba(78, 74, 134, 255),
    rgba(239, 96, 235, 255),
    rgba(0, 104, 84, 255),
    rgba(145, 145, 145, 255),
    rgba(0, 167, 237, 255),
    rgba(199, 194, 246, 255),
    rgba(82, 92, 31, 255),
    rgba(244, 125, 51, 255),
    rgba(145, 145, 145, 255),
    rgba(251, 184, 200, 255),
    rgba(0, 199, 63, 255),
    rgba(203, 209, 157, 255),
    rgba(144, 219, 202, 255),
    rgba(255, 255, 255, 255)
  ],
  // https://en.wikipedia.org/wiki/File:MSX_palette.png
  MSX: [
    rgba(0, 0, 0, 0),
    rgba(0, 0, 0, 255),
    rgba(35, 182, 83, 255),
    rgba(103, 206, 129, 255),
    rgba(79, 88, 218, 255),
    rgba(121, 119, 236, 255),
    rgba(191, 94, 83, 255),
    rgba(68, 218, 237, 255),
    rgba(227, 100, 91, 255),
    rgba(255, 135, 125, 255),
    rgba(206, 193, 102, 255),
    rgba(224, 207, 138, 255),
    rgba(41, 160, 74, 255),
    rgba(186, 102, 177, 255),
    rgba(203, 203, 203, 255),
    rgba(255, 255, 255, 255)
  ],
  MSX2_MODE6: [
    rgba(0, 0, 0, 255),
    rgba(255, 38, 23, 255),
    rgba(110, 108, 75, 255),
    rgba(255, 216, 149, 255)
  ],
  // https://en.wikipedia.org/wiki/ZX_Spectrum_graphic_modes#Colour
  ZX_SPECTRUM: [
    rgba(0, 0, 0, 255),       // black
    rgba(0, 0, 215, 255),     // blue
    rgba(215, 0, 0, 255),     // red
    rgba(215, 0, 215, 255),   // magenta
    rgba(0, 215, 0, 255),     // green
    rgba(0, 215, 215, 255),   // cyan
    rgba(215, 215, 0, 255),   // yellow
    rgba(215, 215, 215, 255), // white
    rgba(0, 0, 255, 255),     // bright blue
    rgba(255, 0, 0, 255),     // bright red
    rgba(255, 0, 255, 255),   // bright magenta
    rgba(0, 255, 0, 255),     // bright green
    rgba(0, 255, 255, 255),   // bright cyan
    rgba(255, 255, 0, 255),   // bright yellow
    rgba(255, 255, 255, 255)  // bright white
  ],
  // https://en.wikipedia.org/wiki/Amstrad_CPC#Graphics (3-level RGB: 0, 128, 255)
  AMSTRAD_CPC: [
    rgba(0, 0, 0, 255),       // black
    rgba(0, 0, 128, 255),     // blue
    rgba(0, 0, 255, 255),     // bright blue
    rgba(128, 0, 0, 255),     // red
    rgba(128, 0, 128, 255),   // magenta
    rgba(128, 0, 255, 255),   // mauve
    rgba(255, 0, 0, 255),     // bright red
    rgba(255, 0, 128, 255),   // bright magenta
    rgba(255, 0, 255, 255),   // bright mauve
    rgba(0, 128, 0, 255),     // green
    rgba(0, 128, 128, 255),   // cyan
    rgba(0, 255, 0, 255),     // bright green
    rgba(0, 255, 255, 255),   // bright cyan
    rgba(255, 128, 0, 255),   // orange
    rgba(255, 255, 0, 255),   // bright yellow
    rgba(255, 255, 255, 255)  // white
  ],
  // https://en.wikipedia.org/wiki/VIC-20#Graphics
  VIC20: [
    rgba(0, 0, 0, 255),       // black
    rgba(255, 255, 255, 255), // white
    rgba(182, 31, 33, 255),   // red
    rgba(77, 240, 255, 255),  // cyan
    rgba(180, 63, 255, 255),  // purple
    rgba(68, 226, 55, 255),   // green
    rgba(28, 32, 214, 255),   // blue
    rgba(243, 243, 135, 255), // yellow
    rgba(202, 113, 44, 255),  // orange
    rgba(239, 168, 119, 255), // light orange
    rgba(231, 116, 118, 255), // pink
    rgba(154, 255, 255, 255), // light cyan
    rgba(226, 139, 255, 255), // light purple
    rgba(142, 255, 130, 255), // light green
    rgba(109, 112, 255, 255), // light blue
    rgba(255, 255, 206, 255)  // light yellow
  ],
  // https://www.nesdev.org/wiki/PPU_palettes (curated 16 from 2C02 PPU)
  NES: [
    rgba(0, 0, 0, 255),       // black
    rgba(252, 252, 252, 255), // white
    rgba(164, 0, 0, 255),     // dark red
    rgba(0, 120, 248, 255),   // medium blue
    rgba(0, 168, 0, 255),     // medium green
    rgba(248, 56, 0, 255),    // red-orange
    rgba(0, 64, 168, 255),    // dark blue
    rgba(248, 184, 0, 255),   // gold
    rgba(104, 68, 0, 255),    // brown
    rgba(248, 120, 88, 255),  // salmon
    rgba(0, 184, 0, 255),     // green
    rgba(60, 188, 252, 255),  // sky blue
    rgba(148, 0, 132, 255),   // purple
    rgba(188, 188, 188, 255), // light gray
    rgba(104, 104, 104, 255), // dark gray
    rgba(248, 164, 192, 255)  // pink
  ],
  // https://en.wikipedia.org/wiki/Sega_Master_System#Technical_specifications (6-bit RGB)
  SEGA_MASTER_SYSTEM: [
    rgba(0, 0, 0, 255),
    rgba(85, 0, 0, 255),
    rgba(170, 0, 0, 255),
    rgba(255, 0, 0, 255),
    rgba(0, 85, 0, 255),
    rgba(0, 170, 0, 255),
    rgba(0, 0, 85, 255),
    rgba(0, 0, 170, 255),
    rgba(0, 0, 255, 255),
    rgba(85, 85, 85, 255),
    rgba(170, 170, 170, 255),
    rgba(255, 255, 255, 255),
    rgba(255, 255, 0, 255),
    rgba(255, 85, 255, 255),
    rgba(0, 255, 255, 255),
    rgba(255, 170, 85, 255)
  ],
  // https://pico-8.fandom.com/wiki/Palette
  PICO8: [
    rgba(0, 0, 0, 255),       // 0 black
    rgba(29, 43, 83, 255),    // 1 dark-blue
    rgba(126, 37, 83, 255),   // 2 dark-purple
    rgba(0, 135, 81, 255),    // 3 dark-green
    rgba(171, 82, 54, 255),   // 4 brown
    rgba(95, 87, 79, 255),    // 5 dark-grey
    rgba(194, 195, 199, 255), // 6 light-grey
    rgba(255, 241, 232, 255), // 7 white
    rgba(255, 0, 77, 255),    // 8 red
    rgba(255, 163, 0, 255),   // 9 orange
    rgba(255, 236, 39, 255),  // 10 yellow
    rgba(0, 228, 54, 255),    // 11 green
    rgba(41, 173, 255, 255),  // 12 blue
    rgba(131, 118, 156, 255), // 13 lavender
    rgba(255, 119, 168, 255), // 14 pink
    rgba(255, 204, 170, 255)  // 15 peach
  ],
  // https://github.com/nesbox/TIC-80/wiki/palette (Sweetie 16)
  TIC80: [
    rgba(20, 12, 28, 255),    // 0 void
    rgba(68, 36, 52, 255),    // 1 deep wine
    rgba(48, 52, 109, 255),   // 2 navy
    rgba(78, 74, 78, 255),    // 3 dark gray
    rgba(133, 76, 48, 255),   // 4 rust
    rgba(52, 101, 36, 255),   // 5 forest
    rgba(208, 70, 72, 255),   // 6 crimson
    rgba(117, 113, 97, 255),  // 7 medium gray
    rgba(89, 125, 206, 255),  // 8 cornflower
    rgba(210, 125, 44, 255),  // 9 tangerine
    rgba(133, 149, 161, 255), // 10 blue gray
    rgba(109, 170, 44, 255),  // 11 lime
    rgba(210, 170, 153, 255), // 12 peach
    rgba(109, 194, 202, 255), // 13 teal
    rgba(218, 212, 94, 255),  // 14 lemon
    rgba(222, 238, 214, 255)  // 15 mint cream
  ],
  TERRABOUND_1: [
    rgba(6, 6, 6, 255),
    rgba(239, 239, 239, 255),
    rgba(207, 207, 207, 255),
    rgba(142, 158, 129, 255),
    rgba(0, 174, 129, 255),
    rgba(0, 142, 112, 255),
    rgba(93, 127, 105, 255),
    rgba(193, 174, 130, 255),
    rgba(195, 158, 108, 255),
    rgba(154, 119, 91, 255),
    rgba(252, 16, 95, 255),
    rgba(150, 9, 51, 255),
    rgba(228, 206, 62, 255),
    rgba(232, 150, 48, 255),
    rgba(71, 83, 195, 255),
    rgba(53, 37, 37, 255)
  ],
  SEPIA: [
    rgba(8, 8, 0, 255),
    rgba(39, 34, 24, 255),
    rgba(70, 63, 48, 255),
    rgba(101, 93, 72, 255),
    rgba(132, 122, 96, 255),
    rgba(163, 152, 120, 255),
    rgba(194, 182, 145, 255),
    rgba(225, 211, 169, 255)
  ],
  GAMEBOY: [
    rgba(155, 188, 15, 255),
    rgba(139, 172, 15, 255),
    rgba(48, 98, 48, 255),
    rgba(15, 56, 15, 255)
  ],
  // https://en.wikipedia.org/wiki/Game_Boy_Pocket
  GAMEBOY_POCKET: [
    rgba(196, 207, 161, 255),
    rgba(139, 149, 109, 255),
    rgba(77, 83, 60, 255),
    rgba(31, 31, 31, 255)
  ],
  // https://en.wikipedia.org/wiki/Game_Boy_Color (boot ROM default palette)
  GAMEBOY_COLOR: [
    rgba(255, 255, 255, 255),
    rgba(255, 132, 0, 255),
    rgba(0, 100, 190, 255),
    rgba(123, 182, 97, 255),
    rgba(155, 0, 0, 255),
    rgba(0, 0, 0, 255)
  ],
  // https://en.wikipedia.org/wiki/Game_Boy_Advance (curated representative)
  GBA: [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
    rgba(248, 56, 0, 255),
    rgba(0, 112, 248, 255),
    rgba(0, 176, 0, 255),
    rgba(248, 200, 0, 255),
    rgba(120, 56, 184, 255),
    rgba(248, 120, 88, 255),
    rgba(0, 200, 200, 255),
    rgba(184, 184, 184, 255),
    rgba(104, 104, 104, 255),
    rgba(160, 82, 45, 255),
    rgba(248, 168, 184, 255),
    rgba(0, 80, 0, 255),
    rgba(80, 48, 0, 255),
    rgba(200, 216, 240, 255)
  ],
  // https://en.wikipedia.org/wiki/Super_Nintendo_Entertainment_System (curated representative)
  SNES: [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
    rgba(188, 0, 0, 255),
    rgba(0, 112, 224, 255),
    rgba(0, 168, 0, 255),
    rgba(240, 208, 0, 255),
    rgba(120, 56, 184, 255),
    rgba(248, 128, 0, 255),
    rgba(0, 200, 200, 255),
    rgba(160, 82, 45, 255),
    rgba(248, 168, 184, 255),
    rgba(184, 184, 184, 255),
    rgba(104, 104, 104, 255),
    rgba(0, 80, 0, 255),
    rgba(168, 136, 64, 255),
    rgba(232, 224, 208, 255)
  ],
  // https://steamcommunity.com/sharedfiles/filedetails/?id=572608400
  FALLWELL_GREENBOY: [
    rgba(50, 59, 41, 255),
    rgba(109, 127, 87, 255),
    rgba(98, 114, 79, 255),
    rgba(156, 173, 136, 255)
  ],
  FALLWELL: [
    rgba(249, 249, 249, 255),
    rgba(247, 0, 22, 255),
    rgba(21, 127, 246, 255),
    rgba(0, 0, 0, 255)
  ],
  FALLWELL_NIKAIDO: [
    rgba(254, 254, 254, 255),
    rgba(252, 146, 33, 255),
    rgba(21, 127, 252, 255),
    rgba(26, 26, 13, 255)
  ],
  FALLWELL_FURIOUS: [
    rgba(34, 31, 58, 255),
    rgba(43, 224, 184, 255),
    rgba(240, 39, 232, 255),
    rgba(236, 153, 61, 255)
  ],
  FALLWELL_RGB: [
    rgba(91, 228, 126, 255),
    rgba(220, 0, 52, 255),
    rgba(2, 3, 109, 255),
    rgba(25, 45, 155, 255)
  ],
  FALLWELL_ZENNYAN: [
    rgba(254, 254, 254, 255),
    rgba(21, 127, 252, 255),
    rgba(232, 11, 195, 255),
    rgba(87, 182, 62, 255)
  ],
  // Game-inspired aesthetic palettes (named by visual character, not title)
  ICY_MOUNTAIN: [
    rgba(30, 20, 60, 255),    // deep navy
    rgba(76, 120, 180, 255),  // icy blue
    rgba(148, 200, 230, 255), // pale blue
    rgba(240, 245, 255, 255), // snow white
    rgba(220, 180, 160, 255), // warm skin
    rgba(200, 100, 120, 255), // rose
    rgba(90, 60, 80, 255),    // dark berry
    rgba(180, 170, 80, 255)   // golden
  ],
  ONE_BIT: [
    rgba(0, 0, 0, 255),
    rgba(255, 254, 244, 255)  // warm white
  ],
  NEON_DUSK: [
    rgba(10, 8, 30, 255),     // near-black
    rgba(25, 20, 60, 255),    // deep navy
    rgba(60, 30, 90, 255),    // muted purple
    rgba(130, 50, 100, 255),  // plum
    rgba(200, 60, 120, 255),  // magenta-pink
    rgba(255, 100, 80, 255),  // warm salmon
    rgba(255, 160, 100, 255), // peach
    rgba(255, 220, 150, 255), // light gold
    rgba(0, 200, 200, 255),   // vivid cyan
    rgba(80, 230, 200, 255),  // mint
    rgba(60, 100, 160, 255),  // steel blue
    rgba(120, 180, 220, 255)  // sky
  ],
  RETRO_KNIGHT: [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
    rgba(30, 60, 150, 255),   // deep blue
    rgba(70, 130, 255, 255),  // bright blue
    rgba(160, 210, 255, 255), // pale blue
    rgba(200, 170, 50, 255),  // warm gold
    rgba(255, 220, 80, 255),  // bright gold
    rgba(200, 60, 40, 255),   // warm red
    rgba(0, 160, 80, 255),    // emerald
    rgba(120, 200, 80, 255),  // lime
    rgba(160, 80, 40, 255),   // brown
    rgba(240, 180, 130, 255), // peach
    rgba(100, 60, 120, 255),  // purple
    rgba(180, 100, 200, 255), // lavender
    rgba(80, 80, 80, 255),    // dark gray
    rgba(180, 180, 180, 255)  // light gray
  ],
  NEON_VIOLENCE: [
    rgba(0, 0, 0, 255),       // black
    rgba(255, 255, 255, 255), // white
    rgba(255, 20, 147, 255),  // hot neon pink
    rgba(0, 255, 255, 255),   // electric cyan
    rgba(120, 0, 200, 255),   // deep purple
    rgba(180, 10, 10, 255),   // blood red
    rgba(255, 240, 0, 255),   // yellow
    rgba(0, 180, 160, 255)    // teal
  ],
  BAR_11_HALL_B: [
    rgba(0, 0, 0, 255),
    rgba(2, 0, 24, 255),
    rgba(39, 8, 52, 255),
    rgba(63, 1, 71, 255),
    rgba(109, 7, 74, 255),
    rgba(160, 16, 73, 255),
    rgba(167, 96, 130, 255),
    rgba(187, 18, 75, 255),
    rgba(202, 93, 108, 255),
    rgba(206, 19, 76, 255),
    rgba(243, 169, 141, 255),
    rgba(250, 58, 80, 255),
    rgba(253, 21, 102, 255),
    rgba(254, 180, 182, 255),
    rgba(254, 238, 182, 255),
    rgba(255, 255, 255, 255)
  ],
  PC98_DEIMOS: [
    rgba(0, 0, 0, 255),
    rgba(0, 102, 119, 255),
    rgba(68, 34, 153, 255),
    rgba(85, 102, 102, 255),
    rgba(102, 68, 187, 255),
    rgba(119, 136, 136, 255),
    rgba(153, 119, 238, 255),
    rgba(153, 153, 102, 255),
    rgba(153, 85, 102, 255),
    rgba(170, 187, 187, 255),
    rgba(187, 153, 153, 255),
    rgba(204, 204, 153, 255),
    rgba(221, 187, 187, 255),
    rgba(221, 34, 85, 255),
    rgba(255, 238, 221, 255),
    rgba(255, 255, 255, 255)
  ],
  PC98_YUNA: [
    rgba(0, 0, 0, 255),
    rgba(16, 156, 140, 255),
    rgba(66, 33, 66, 255),
    rgba(82, 99, 99, 255),
    rgba(99, 99, 239, 255),
    rgba(140, 49, 49, 255),
    rgba(156, 173, 189, 255),
    rgba(189, 206, 255, 255),
    rgba(189, 49, 66, 255),
    rgba(222, 140, 115, 255),
    rgba(239, 49, 82, 255),
    rgba(255, 140, 156, 255),
    rgba(255, 173, 49, 255),
    rgba(255, 189, 173, 255),
    rgba(255, 222, 206, 255),
    rgba(255, 255, 255, 255)
  ],
  PC98_SPACE_DEPUTIES: [
    rgba(1, 1, 1, 255),
    rgba(1, 84, 220, 255),
    rgba(35, 171, 35, 255),
    rgba(69, 69, 69, 255),
    rgba(84, 186, 205, 255),
    rgba(103, 35, 16, 255),
    rgba(137, 137, 137, 255),
    rgba(171, 69, 205, 255),
    rgba(171, 84, 69, 255),
    rgba(186, 35, 35, 255),
    rgba(205, 186, 50, 255),
    rgba(205, 205, 205, 255),
    rgba(205, 84, 1, 255),
    rgba(220, 152, 118, 255)
  ],
  PC98_MAIDEN_CHERUB: [
    rgba(0, 0, 0, 255),
    rgba(0, 136, 51, 255),
    rgba(0, 68, 85, 255),
    rgba(85, 119, 136, 255),
    rgba(102, 102, 136, 255),
    rgba(102, 51, 51, 255),
    rgba(153, 102, 102, 255),
    rgba(153, 187, 204, 255),
    rgba(170, 153, 204, 255),
    rgba(187, 136, 136, 255),
    rgba(187, 68, 68, 255),
    rgba(221, 170, 170, 255),
    rgba(255, 221, 221, 255),
    rgba(255, 238, 221, 255),
    rgba(255, 255, 255, 255)
  ],
  PC98_NAIVE_VOYAGE: [
    rgba(0, 0, 0, 255),
    rgba(0, 68, 153, 255),
    rgba(34, 102, 0, 255),
    rgba(68, 34, 34, 255),
    rgba(68, 85, 85, 255),
    rgba(85, 153, 51, 255),
    rgba(119, 68, 51, 255),
    rgba(136, 153, 153, 255),
    rgba(153, 0, 0, 255),
    rgba(170, 102, 68, 255),
    rgba(170, 187, 238, 255),
    rgba(238, 153, 102, 255),
    rgba(238, 153, 51, 255),
    rgba(255, 187, 153, 255),
    rgba(255, 255, 255, 255)
  ],
  PC98_HAUNTSMAN: [
    rgba(0, 0, 0, 255),
    rgba(0, 51, 102, 255),
    rgba(34, 119, 136, 255),
    rgba(34, 170, 187, 255),
    rgba(68, 119, 68, 255),
    rgba(136, 0, 0, 255),
    rgba(136, 68, 34, 255),
    rgba(153, 187, 136, 255),
    rgba(187, 187, 187, 255),
    rgba(204, 102, 85, 255),
    rgba(238, 0, 0, 255),
    rgba(238, 153, 136, 255),
    rgba(255, 187, 170, 255),
    rgba(255, 204, 0, 255),
    rgba(255, 255, 255, 255)
  ],
  // https://color.adobe.com/sandy-stone-beach-ocean-diver-color-theme-15325/
  SANDY_STONE_BEACH: [
    rgba(232, 225, 177, 255),
    rgba(166, 161, 127, 255),
    rgba(240, 235, 202, 255),
    rgba(0, 100, 126, 255),
    rgba(0, 51, 51, 255)
  ],
  VAPORWAVE: [
    // modified http://www.colourlovers.com/palette/3636765/seapunk_vaporwave
    rgba(255, 106, 213, 255),
    rgba(199, 116, 232, 255),
    rgba(173, 140, 255, 255),
    rgba(135, 149, 232, 255),
    rgba(148, 208, 255, 255),
    rgba(0, 0, 0, 255)
  ],
  WIREDSOUND: [
    // https://fauux.neocities.org
    rgba(210, 115, 138, 255),
    rgba(0, 0, 0, 255),
    rgba(193, 180, 146, 255)
  ],

  // ── Film & Photography ──

  // https://en.wikipedia.org/wiki/Kodachrome
  KODACHROME: [
    rgba(200, 30, 20, 255),   // rich red
    rgba(220, 170, 40, 255),  // warm gold
    rgba(20, 60, 120, 255),   // deep blue
    rgba(40, 120, 50, 255),   // saturated green
    rgba(100, 60, 30, 255),   // warm brown
    rgba(245, 230, 200, 255), // cream
    rgba(40, 30, 20, 255),    // warm shadow
    rgba(255, 240, 220, 255)  // warm highlight
  ],
  // https://en.wikipedia.org/wiki/Technicolor#Three-strip_Technicolor
  TECHNICOLOR: [
    rgba(220, 20, 20, 255),   // vivid red
    rgba(0, 100, 90, 255),    // deep teal-green
    rgba(230, 190, 40, 255),  // golden yellow
    rgba(20, 40, 140, 255),   // rich blue
    rgba(220, 170, 140, 255), // warm skin
    rgba(15, 10, 10, 255)     // near-black
  ],
  // https://en.wikipedia.org/wiki/Cyanotype
  CYANOTYPE: [
    rgba(0, 35, 102, 255),    // deep Prussian blue
    rgba(20, 80, 150, 255),   // medium blue
    rgba(80, 140, 200, 255),  // mid-tone
    rgba(160, 200, 230, 255), // pale blue
    rgba(245, 240, 225, 255)  // paper white
  ],
  POLAROID: [
    rgba(200, 180, 160, 255), // faded warm
    rgba(160, 180, 190, 255), // cyan cast shadow
    rgba(230, 220, 200, 255), // warm cream
    rgba(180, 140, 120, 255), // desaturated brown
    rgba(190, 160, 170, 255), // faded mauve
    rgba(245, 240, 230, 255)  // border white
  ],
  // https://en.wikipedia.org/wiki/Daguerreotype
  DAGUERREOTYPE: [
    rgba(20, 22, 28, 255),    // deep shadow
    rgba(80, 85, 95, 255),    // dark oxidized
    rgba(140, 145, 155, 255), // warm silver
    rgba(200, 205, 215, 255), // mirror silver
    rgba(235, 230, 225, 255)  // warm highlight
  ],

  // ── Art & Design Movements ──

  // https://en.wikipedia.org/wiki/Piet_Mondrian
  MONDRIAN: [
    rgba(221, 1, 0, 255),     // red
    rgba(1, 1, 161, 255),     // blue
    rgba(250, 201, 1, 255),   // yellow
    rgba(0, 0, 0, 255),       // black
    rgba(254, 254, 254, 255)  // white
  ],
  // https://en.wikipedia.org/wiki/Pop_art
  POP_ART: [
    rgba(255, 20, 147, 255),  // hot pink
    rgba(0, 80, 255, 255),    // electric blue
    rgba(255, 230, 0, 255),   // banana yellow
    rgba(255, 120, 0, 255),   // orange
    rgba(100, 220, 0, 255),   // lime green
    rgba(230, 0, 0, 255),     // red
    rgba(0, 0, 0, 255),       // black
    rgba(255, 255, 255, 255)  // white
  ],
  // https://en.wikipedia.org/wiki/Bauhaus (Kandinsky color theory)
  BAUHAUS: [
    rgba(190, 30, 45, 255),   // red
    rgba(33, 64, 154, 255),   // blue
    rgba(248, 214, 78, 255),  // yellow
    rgba(0, 0, 0, 255),       // black
    rgba(255, 255, 255, 255), // white
    rgba(155, 155, 155, 255)  // gray
  ],
  // https://en.wikipedia.org/wiki/Ukiyo-e
  UKIYO_E: [
    rgba(20, 16, 12, 255),    // sumi black
    rgba(40, 50, 100, 255),   // indigo
    rgba(200, 50, 30, 255),   // vermillion (shu)
    rgba(180, 140, 60, 255),  // ochre
    rgba(60, 100, 60, 255),   // subdued green
    rgba(100, 150, 200, 255), // sky blue
    rgba(240, 230, 210, 255), // paper cream
    rgba(180, 80, 100, 255)   // rose
  ],
  // https://en.wikipedia.org/wiki/Soviet_art
  SOVIET_POSTER: [
    rgba(200, 20, 20, 255),   // bold red
    rgba(0, 0, 0, 255),       // black
    rgba(240, 230, 210, 255), // cream / off-white
    rgba(200, 170, 50, 255),  // gold
    rgba(60, 60, 60, 255),    // dark gray
    rgba(80, 90, 50, 255)     // olive
  ],
  SYNTHWAVE: [
    rgba(13, 2, 33, 255),     // deep purple-black
    rgba(255, 41, 117, 255),  // hot magenta
    rgba(0, 240, 255, 255),   // electric cyan
    rgba(255, 230, 0, 255),   // grid yellow
    rgba(21, 0, 80, 255),     // deep blue
    rgba(204, 0, 255, 255)    // neon pink
  ],

  // ── Monochrome CRT & Terminal ──

  // https://en.wikipedia.org/wiki/Monochrome_monitor (P3 amber phosphor)
  PHOSPHOR_AMBER: [
    rgba(0, 0, 0, 255),
    rgba(107, 52, 0, 255),
    rgba(204, 102, 0, 255),
    rgba(255, 176, 0, 255)
  ],
  // https://en.wikipedia.org/wiki/Monochrome_monitor (P1/P39 green phosphor)
  PHOSPHOR_GREEN: [
    rgba(0, 0, 0, 255),
    rgba(0, 59, 0, 255),
    rgba(0, 168, 0, 255),
    rgba(0, 255, 51, 255)
  ],
  // https://en.wikipedia.org/wiki/Monochrome_monitor (P4 blue-white phosphor)
  PHOSPHOR_WHITE: [
    rgba(0, 0, 0, 255),
    rgba(68, 68, 102, 255),
    rgba(153, 153, 187, 255),
    rgba(224, 224, 255, 255)
  ],
  // https://en.wikipedia.org/wiki/IBM_3270
  IBM_3278: [
    rgba(0, 0, 0, 255),
    rgba(10, 51, 0, 255),
    rgba(51, 255, 0, 255),
    rgba(102, 255, 102, 255)
  ],

  // ── Nature & Environment ──

  FOREST: [
    rgba(26, 47, 26, 255),    // deep shadow
    rgba(45, 90, 39, 255),    // dark green
    rgba(74, 124, 63, 255),   // moss
    rgba(139, 105, 20, 255),  // bark brown
    rgba(196, 163, 90, 255),  // golden light
    rgba(232, 220, 200, 255)  // sunlit highlight
  ],
  SUNSET: [
    rgba(26, 10, 46, 255),    // deep purple
    rgba(107, 29, 94, 255),   // magenta
    rgba(212, 20, 90, 255),   // warm red
    rgba(255, 106, 0, 255),   // orange
    rgba(255, 179, 71, 255),  // light orange
    rgba(255, 236, 210, 255)  // pale peach
  ],
  OCEAN: [
    rgba(12, 20, 69, 255),    // deep navy
    rgba(27, 85, 131, 255),   // mid blue
    rgba(46, 157, 174, 255),  // teal
    rgba(127, 205, 205, 255), // seafoam
    rgba(240, 230, 211, 255)  // sand
  ],
  DESERT: [
    rgba(44, 24, 16, 255),    // shadow
    rgba(139, 69, 19, 255),   // terracotta
    rgba(196, 149, 106, 255), // light clay
    rgba(222, 184, 135, 255), // burlywood
    rgba(245, 222, 179, 255), // wheat
    rgba(232, 216, 200, 255)  // pale sand
  ],

  // ── Print & Process ──

  // https://en.wikipedia.org/wiki/Risograph (standard ink catalog)
  RISOGRAPH: [
    rgba(255, 72, 176, 255),  // fluorescent pink
    rgba(0, 120, 191, 255),   // blue
    rgba(255, 102, 94, 255),  // red
    rgba(0, 169, 92, 255),    // green
    rgba(255, 232, 0, 255),   // yellow
    rgba(0, 0, 0, 255),       // black
    rgba(255, 108, 47, 255),  // orange
    rgba(0, 136, 138, 255)    // teal
  ],
  NEWSPRINT: [
    rgba(0, 0, 0, 255),       // ink black
    rgba(90, 90, 90, 255),    // ink gray
    rgba(200, 184, 138, 255), // aged paper
    rgba(242, 232, 213, 255)  // fresh paper
  ],
  // https://en.wikipedia.org/wiki/Blueprint
  BLUEPRINT: [
    rgba(0, 43, 92, 255),     // deep blueprint
    rgba(26, 82, 118, 255),   // mid blue
    rgba(124, 185, 232, 255), // pale blue
    rgba(240, 244, 248, 255)  // paper white
  ],

  // ── Modern Aesthetic ──

  CYBERPUNK: [
    rgba(10, 10, 10, 255),    // near-black
    rgba(26, 26, 46, 255),    // dark blue
    rgba(0, 255, 255, 255),   // cyan
    rgba(255, 0, 255, 255),   // magenta
    rgba(57, 255, 20, 255),   // matrix green
    rgba(255, 230, 0, 255)    // yellow
  ],
  PASTEL: [
    rgba(255, 179, 186, 255), // baby pink
    rgba(255, 223, 186, 255), // peach
    rgba(255, 255, 186, 255), // lemon
    rgba(186, 255, 201, 255), // mint
    rgba(186, 225, 255, 255), // sky blue
    rgba(232, 186, 255, 255)  // lavender
  ],

  // ── More Retro Platforms ──

  // https://en.wikipedia.org/wiki/Atari_ST#Graphics
  ATARI_ST: [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
    rgba(255, 0, 0, 255),
    rgba(0, 255, 0, 255),
    rgba(0, 0, 255, 255),
    rgba(255, 255, 0, 255),
    rgba(0, 255, 255, 255),
    rgba(255, 0, 255, 255),
    rgba(128, 0, 0, 255),
    rgba(0, 128, 0, 255),
    rgba(0, 0, 128, 255),
    rgba(128, 128, 0, 255),
    rgba(0, 128, 128, 255),
    rgba(128, 0, 128, 255),
    rgba(128, 128, 128, 255),
    rgba(192, 192, 192, 255)
  ],
  // https://en.wikipedia.org/wiki/Virtual_Boy
  VIRTUAL_BOY: [
    rgba(0, 0, 0, 255),
    rgba(85, 0, 0, 255),
    rgba(170, 0, 0, 255),
    rgba(255, 0, 0, 255)
  ],
  // https://en.wikipedia.org/wiki/Game_Gear
  GAME_GEAR: [
    rgba(0, 0, 0, 255),
    rgba(85, 85, 85, 255),
    rgba(170, 170, 170, 255),
    rgba(255, 255, 255, 255),
    rgba(255, 0, 0, 255),
    rgba(0, 0, 255, 255),
    rgba(0, 170, 0, 255),
    rgba(255, 255, 0, 255),
    rgba(255, 85, 0, 255),
    rgba(0, 170, 255, 255),
    rgba(255, 0, 170, 255),
    rgba(170, 85, 0, 255),
    rgba(0, 170, 170, 255),
    rgba(170, 0, 255, 255),
    rgba(255, 170, 170, 255),
    rgba(170, 255, 170, 255)
  ],
  // https://en.wikipedia.org/wiki/WonderSwan
  WONDERSWAN: [
    rgba(255, 255, 255, 255),
    rgba(192, 192, 192, 255),
    rgba(160, 160, 160, 255),
    rgba(128, 128, 128, 255),
    rgba(96, 96, 96, 255),
    rgba(64, 64, 64, 255),
    rgba(32, 32, 32, 255),
    rgba(0, 0, 0, 255)
  ],
  // https://en.wikipedia.org/wiki/Neo_Geo_Pocket_Color
  NEO_GEO_POCKET: [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
    rgba(200, 48, 48, 255),
    rgba(48, 80, 200, 255),
    rgba(48, 176, 48, 255),
    rgba(224, 176, 48, 255),
    rgba(176, 48, 176, 255),
    rgba(48, 176, 176, 255),
    rgba(176, 96, 48, 255),
    rgba(240, 144, 160, 255),
    rgba(144, 144, 144, 255),
    rgba(96, 128, 48, 255),
    rgba(96, 48, 128, 255),
    rgba(176, 176, 176, 255),
    rgba(48, 48, 48, 255),
    rgba(224, 224, 176, 255)
  ],
  // https://en.wikipedia.org/wiki/TRS-80#Display
  TRS80: [
    rgba(0, 0, 0, 255),
    rgba(0, 255, 0, 255)
  ],

  // ── Scientific & Imaging ──

  THERMAL: [
    rgba(0, 0, 0, 255),       // cold (black)
    rgba(24, 0, 80, 255),     // deep blue
    rgba(120, 0, 160, 255),   // purple
    rgba(200, 0, 80, 255),    // magenta
    rgba(255, 60, 0, 255),    // red
    rgba(255, 160, 0, 255),   // orange
    rgba(255, 240, 0, 255),   // yellow
    rgba(255, 255, 255, 255)  // hot (white)
  ],
  NIGHT_VISION: [
    rgba(0, 0, 0, 255),
    rgba(0, 20, 0, 255),
    rgba(0, 60, 0, 255),
    rgba(0, 120, 0, 255),
    rgba(10, 200, 10, 255),
    rgba(60, 255, 60, 255)
  ],
  XRAY: [
    rgba(0, 0, 0, 255),
    rgba(20, 30, 50, 255),
    rgba(60, 80, 120, 255),
    rgba(120, 150, 200, 255),
    rgba(200, 220, 240, 255),
    rgba(255, 255, 255, 255)
  ],
  RADAR: [
    rgba(0, 0, 0, 255),       // background
    rgba(0, 40, 0, 255),      // dark green
    rgba(0, 120, 0, 255),     // sweep green
    rgba(0, 200, 40, 255),    // contact green
    rgba(100, 255, 100, 255), // bright return
    rgba(255, 255, 0, 255),   // alert yellow
    rgba(255, 60, 0, 255)     // alert red
  ],

  // ── Seasons ──

  AUTUMN: [
    rgba(45, 20, 10, 255),    // dark bark
    rgba(140, 50, 10, 255),   // burnt sienna
    rgba(200, 80, 20, 255),   // rust orange
    rgba(230, 150, 30, 255),  // golden
    rgba(180, 30, 20, 255),   // maple red
    rgba(100, 80, 30, 255)    // olive brown
  ],
  WINTER: [
    rgba(20, 30, 50, 255),    // midnight
    rgba(60, 80, 120, 255),   // steel blue
    rgba(140, 170, 200, 255), // frost
    rgba(200, 215, 230, 255), // ice
    rgba(240, 245, 255, 255), // snow
    rgba(100, 120, 140, 255)  // slate
  ],
  SPRING: [
    rgba(255, 180, 200, 255), // cherry blossom
    rgba(180, 230, 140, 255), // new leaf
    rgba(255, 240, 150, 255), // dandelion
    rgba(150, 200, 255, 255), // robin egg
    rgba(220, 160, 255, 255), // lilac
    rgba(255, 255, 240, 255)  // cream
  ],

  // ── Decade Aesthetics ──

  SEVENTIES: [
    rgba(140, 60, 10, 255),   // burnt orange
    rgba(180, 140, 40, 255),  // harvest gold
    rgba(100, 80, 40, 255),   // avocado
    rgba(80, 40, 20, 255),    // brown
    rgba(200, 160, 100, 255), // tan
    rgba(240, 220, 180, 255)  // cream
  ],
  EIGHTIES: [
    rgba(255, 0, 128, 255),   // hot pink
    rgba(0, 200, 255, 255),   // electric blue
    rgba(180, 0, 255, 255),   // purple
    rgba(255, 255, 0, 255),   // yellow
    rgba(0, 255, 128, 255),   // mint
    rgba(255, 100, 0, 255)    // orange
  ],
  NINETIES: [
    rgba(0, 150, 150, 255),   // teal
    rgba(150, 0, 100, 255),   // plum
    rgba(200, 200, 0, 255),   // chartreuse
    rgba(255, 100, 0, 255),   // tangerine
    rgba(0, 0, 0, 255),       // black
    rgba(192, 192, 192, 255)  // silver
  ],
  Y2K: [
    rgba(200, 200, 220, 255), // chrome silver
    rgba(180, 140, 255, 255), // digital lavender
    rgba(255, 150, 200, 255), // bubblegum
    rgba(0, 200, 255, 255),   // cyber blue
    rgba(255, 255, 255, 255), // white
    rgba(100, 100, 120, 255)  // gunmetal
  ],

  // ── Art & Culture (continued) ──

  // https://en.wikipedia.org/wiki/Art_Deco
  ART_DECO: [
    rgba(0, 0, 0, 255),       // black
    rgba(195, 155, 70, 255),  // gold
    rgba(40, 70, 60, 255),    // dark jade
    rgba(180, 40, 30, 255),   // lacquer red
    rgba(230, 220, 200, 255), // ivory
    rgba(100, 120, 110, 255)  // verdigris
  ],
  // https://en.wikipedia.org/wiki/Memphis_Group
  MEMPHIS_MILANO: [
    rgba(255, 100, 120, 255), // coral pink
    rgba(0, 180, 200, 255),   // turquoise
    rgba(255, 200, 0, 255),   // bright yellow
    rgba(120, 60, 200, 255),  // violet
    rgba(0, 0, 0, 255),       // black
    rgba(240, 240, 240, 255), // off-white
    rgba(255, 150, 50, 255),  // tangerine
    rgba(50, 200, 100, 255)   // jade green
  ],
  // https://en.wikipedia.org/wiki/Art_Nouveau
  ART_NOUVEAU: [
    rgba(40, 50, 30, 255),    // dark olive
    rgba(80, 110, 60, 255),   // sage
    rgba(160, 140, 80, 255),  // antique gold
    rgba(120, 50, 70, 255),   // muted rose
    rgba(60, 80, 100, 255),   // slate blue
    rgba(220, 210, 180, 255), // parchment
    rgba(140, 100, 60, 255),  // bronze
    rgba(180, 160, 120, 255)  // wheat
  ],
  BYZANTINE: [
    rgba(120, 20, 50, 255),   // Tyrian purple
    rgba(180, 140, 20, 255),  // gold leaf
    rgba(20, 40, 100, 255),   // lapis lazuli
    rgba(160, 30, 20, 255),   // vermillion
    rgba(40, 80, 50, 255),    // malachite
    rgba(240, 230, 210, 255)  // ivory
  ],

  // ── Film (continued) ──

  NOIR: [
    rgba(0, 0, 0, 255),       // black
    rgba(30, 30, 35, 255),    // near-black
    rgba(70, 70, 80, 255),    // dark gray
    rgba(120, 120, 130, 255), // medium gray
    rgba(180, 180, 185, 255), // light gray
    rgba(240, 235, 230, 255)  // warm white
  ],
  AUTOCHROME: [
    rgba(50, 40, 30, 255),    // dark sepia
    rgba(80, 100, 60, 255),   // muted green
    rgba(160, 100, 60, 255),  // amber
    rgba(100, 70, 100, 255),  // faded purple
    rgba(140, 130, 100, 255), // dust
    rgba(200, 180, 140, 255), // old paper
    rgba(80, 80, 110, 255),   // slate
    rgba(180, 140, 100, 255)  // warm tan
  ],
  // https://en.wikipedia.org/wiki/Lomography
  LOMOGRAPHY: [
    rgba(0, 0, 0, 255),       // crushed black
    rgba(200, 40, 60, 255),   // saturated red
    rgba(40, 160, 60, 255),   // vivid green
    rgba(20, 60, 160, 255),   // deep blue
    rgba(240, 200, 0, 255),   // saturated yellow
    rgba(220, 80, 160, 255),  // magenta
    rgba(255, 240, 200, 255)  // blown highlight
  ],
  CROSS_PROCESS: [
    rgba(0, 30, 30, 255),     // cyan shadow
    rgba(60, 180, 120, 255),  // green shift
    rgba(200, 220, 80, 255),  // yellow-green
    rgba(255, 200, 100, 255), // warm highlight
    rgba(80, 40, 120, 255),   // purple shadow
    rgba(255, 120, 80, 255)   // orange bleed
  ],

  // ── Material & Texture ──

  MARBLE: [
    rgba(240, 238, 235, 255), // white marble
    rgba(200, 195, 190, 255), // warm gray
    rgba(160, 155, 148, 255), // mid vein
    rgba(120, 115, 108, 255), // dark vein
    rgba(80, 75, 70, 255),    // deep crack
    rgba(45, 42, 38, 255)     // darkest vein
  ],
  RUST: [
    rgba(40, 20, 10, 255),    // deep oxide
    rgba(120, 50, 20, 255),   // dark rust
    rgba(180, 80, 30, 255),   // rust orange
    rgba(200, 120, 60, 255),  // light rust
    rgba(160, 140, 100, 255), // patina
    rgba(220, 200, 170, 255)  // bare metal
  ],
  NEON_SIGN: [
    rgba(5, 5, 15, 255),      // night sky
    rgba(255, 20, 60, 255),   // red neon
    rgba(20, 200, 255, 255),  // blue neon
    rgba(255, 100, 200, 255), // pink neon
    rgba(50, 255, 100, 255),  // green neon
    rgba(255, 200, 40, 255)   // gold neon
  ],
  STAINED_GLASS: [
    rgba(10, 10, 10, 255),    // lead
    rgba(180, 20, 20, 255),   // ruby
    rgba(20, 40, 160, 255),   // cobalt
    rgba(180, 160, 20, 255),  // amber
    rgba(20, 130, 50, 255),   // emerald
    rgba(160, 40, 160, 255),  // amethyst
    rgba(240, 220, 180, 255)  // clear/daylight
  ],

  // ── Music Genre ──

  GRUNGE: [
    rgba(30, 25, 20, 255),    // dark sludge
    rgba(80, 60, 40, 255),    // dirty brown
    rgba(120, 100, 70, 255),  // khaki
    rgba(60, 70, 50, 255),    // army green
    rgba(140, 130, 110, 255), // washed out
    rgba(180, 170, 150, 255)  // faded
  ],
  JAZZ: [
    rgba(10, 5, 20, 255),     // smoky black
    rgba(60, 20, 80, 255),    // deep purple
    rgba(180, 120, 40, 255),  // brass gold
    rgba(140, 30, 30, 255),   // velvet red
    rgba(30, 50, 100, 255),   // midnight blue
    rgba(200, 180, 140, 255)  // warm spotlight
  ],
  REGGAE: [
    rgba(0, 0, 0, 255),       // black
    rgba(200, 40, 30, 255),   // red
    rgba(240, 190, 0, 255),   // gold
    rgba(0, 130, 40, 255),    // green
    rgba(255, 255, 255, 255)  // white
  ],

  // ── Regional & Cultural ──

  // https://en.wikipedia.org/wiki/Persian_miniature
  PERSIAN_MINIATURE: [
    rgba(20, 30, 100, 255),   // lapis lazuli
    rgba(0, 150, 160, 255),   // turquoise
    rgba(210, 170, 50, 255),  // gold leaf
    rgba(200, 40, 30, 255),   // vermillion
    rgba(220, 180, 50, 255),  // saffron
    rgba(240, 230, 210, 255), // ivory
    rgba(30, 20, 80, 255)     // deep indigo
  ],
  // https://en.wikipedia.org/wiki/Indigenous_Australian_art
  ABORIGINAL: [
    rgba(160, 50, 20, 255),   // red ochre
    rgba(200, 160, 40, 255),  // yellow ochre
    rgba(230, 220, 200, 255), // white clay
    rgba(30, 25, 20, 255),    // charcoal
    rgba(120, 60, 25, 255)    // burnt sienna
  ],
  // https://en.wikipedia.org/wiki/Zellige
  MOROCCAN: [
    rgba(20, 50, 140, 255),   // cobalt blue
    rgba(220, 170, 40, 255),  // saffron gold
    rgba(180, 80, 40, 255),   // terracotta
    rgba(0, 120, 60, 255),    // emerald
    rgba(240, 230, 200, 255), // cream
    rgba(50, 30, 15, 255)     // deep brown
  ],
  NORDIC: [
    rgba(180, 195, 210, 255), // icy blue-gray
    rgba(20, 35, 60, 255),    // deep navy
    rgba(240, 235, 225, 255), // birch white
    rgba(180, 40, 50, 255),   // lingonberry red
    rgba(40, 80, 50, 255),    // pine green
    rgba(90, 100, 110, 255)   // slate
  ],
  // https://en.wikipedia.org/wiki/Chinese_ceramics
  CHINESE_PORCELAIN: [
    rgba(20, 50, 130, 255),   // cobalt blue
    rgba(120, 160, 210, 255), // pale blue
    rgba(245, 242, 238, 255), // glaze white
    rgba(10, 20, 60, 255),    // dark indigo
    rgba(250, 245, 235, 255)  // warm off-white
  ],
  // https://en.wikipedia.org/wiki/Maya_blue
  MAYAN: [
    rgba(70, 130, 180, 255),  // Maya blue
    rgba(0, 120, 60, 255),    // jade green
    rgba(200, 40, 20, 255),   // cinnabar red
    rgba(20, 15, 10, 255),    // obsidian black
    rgba(230, 220, 200, 255), // limestone white
    rgba(80, 45, 25, 255)     // cacao brown
  ],
  // https://en.wikipedia.org/wiki/Kintsugi
  KINTSUGI: [
    rgba(210, 170, 50, 255),  // gold
    rgba(230, 220, 200, 255), // crackle cream
    rgba(40, 35, 30, 255),    // deep charcoal
    rgba(140, 180, 140, 255), // celadon green
    rgba(160, 30, 20, 255)    // warm lacquer red
  ],
  WABI_SABI: [
    rgba(120, 95, 70, 255),   // weathered wood
    rgba(80, 100, 60, 255),   // moss patina
    rgba(160, 140, 110, 255), // aged clay
    rgba(180, 180, 175, 255), // fog gray
    rgba(130, 150, 100, 255)  // lichen green
  ],

  // ── Weather & Atmosphere ──

  STORM: [
    rgba(30, 30, 35, 255),    // charcoal
    rgba(60, 65, 75, 255),    // dark slate
    rgba(100, 110, 130, 255), // blue-gray
    rgba(180, 190, 200, 255), // ozone pale
    rgba(240, 245, 255, 255), // lightning white
    rgba(60, 120, 130, 255)   // rain teal
  ],
  FOG: [
    rgba(235, 235, 230, 255), // near-white
    rgba(200, 200, 198, 255), // light gray
    rgba(170, 165, 160, 255), // warm gray
    rgba(150, 155, 165, 255), // cool gray
    rgba(140, 150, 170, 255)  // muted blue
  ],
  AURORA: [
    rgba(10, 15, 40, 255),    // deep navy
    rgba(0, 200, 80, 255),    // electric green
    rgba(0, 220, 220, 255),   // cyan
    rgba(160, 50, 200, 255),  // magenta-violet
    rgba(120, 255, 120, 255), // pale green
    rgba(200, 120, 180, 255), // soft pink
    rgba(20, 25, 35, 255)     // dark horizon
  ],
  VOLCANIC: [
    rgba(15, 10, 10, 255),    // obsidian
    rgba(160, 30, 0, 255),    // deep red-orange
    rgba(255, 120, 0, 255),   // bright lava
    rgba(100, 90, 80, 255),   // cooling gray
    rgba(200, 190, 180, 255)  // ash white
  ],
  RAINBOW: [
    rgba(255, 0, 0, 255),     // red
    rgba(255, 127, 0, 255),   // orange
    rgba(255, 255, 0, 255),   // yellow
    rgba(0, 200, 0, 255),     // green
    rgba(0, 0, 255, 255),     // blue
    rgba(75, 0, 130, 255),    // indigo
    rgba(148, 0, 211, 255)    // violet
  ],

  // ── Food & Organic ──

  COFFEE: [
    rgba(28, 14, 5, 255),     // dark roast
    rgba(60, 31, 12, 255),    // medium roast
    rgba(139, 94, 60, 255),   // caramel
    rgba(212, 184, 150, 255), // cream
    rgba(245, 237, 224, 255)  // milk foam
  ],
  WINE: [
    rgba(74, 0, 32, 255),     // bordeaux
    rgba(114, 47, 55, 255),   // merlot
    rgba(201, 123, 132, 255), // rosé
    rgba(232, 180, 184, 255), // blush
    rgba(247, 231, 206, 255)  // champagne
  ],
  CANDY: [
    rgba(220, 20, 40, 255),   // cherry red
    rgba(255, 130, 180, 255), // bubblegum pink
    rgba(255, 240, 60, 255),  // lemon yellow
    rgba(80, 220, 60, 255),   // lime green
    rgba(140, 50, 180, 255),  // grape purple
    rgba(255, 140, 0, 255),   // orange
    rgba(100, 180, 255, 255), // sky blue
    rgba(255, 255, 255, 255)  // white
  ],
  SPICE: [
    rgba(220, 180, 30, 255),  // turmeric gold
    rgba(180, 50, 20, 255),   // paprika red
    rgba(140, 80, 40, 255),   // cinnamon
    rgba(60, 120, 50, 255),   // cardamom green
    rgba(230, 190, 60, 255),  // saffron
    rgba(60, 30, 15, 255)     // clove brown
  ],

  // ── Architecture & Interior ──

  BRUTALIST: [
    rgba(50, 48, 45, 255),    // deep shadow
    rgba(130, 128, 125, 255), // raw concrete
    rgba(190, 188, 185, 255), // light concrete
    rgba(210, 212, 215, 255)  // overcast sky
  ],
  ZEN_GARDEN: [
    rgba(220, 215, 200, 255), // raked gravel
    rgba(80, 110, 60, 255),   // moss green
    rgba(120, 115, 105, 255), // wet stone
    rgba(190, 170, 90, 255),  // bamboo gold
    rgba(40, 35, 30, 255),    // shadow
    rgba(100, 140, 160, 255)  // pond blue
  ],
  MID_CENTURY: [
    rgba(120, 70, 30, 255),   // teak
    rgba(210, 170, 40, 255),  // mustard
    rgba(80, 100, 50, 255),   // olive
    rgba(200, 90, 30, 255),   // burnt orange
    rgba(240, 235, 220, 255), // cream
    rgba(50, 50, 45, 255)     // charcoal
  ],
  TERRACOTTA: [
    rgba(100, 40, 20, 255),   // deep terra
    rgba(180, 100, 55, 255),  // warm clay
    rgba(220, 180, 140, 255), // sun-bleached
    rgba(245, 240, 230, 255), // whitewash
    rgba(60, 35, 20, 255)     // shadow umber
  ],

  // ── Digital & Interface Nostalgia ──

  HYPERCARD: [
    rgba(0, 0, 0, 255),
    rgba(85, 85, 85, 255),
    rgba(170, 170, 170, 255),
    rgba(255, 255, 255, 255)
  ],
  // Norton Commander / DOS file manager
  DOS_NAVIGATOR: [
    rgba(0, 0, 170, 255),     // DOS blue
    rgba(0, 170, 170, 255),   // cyan text
    rgba(255, 255, 85, 255),  // yellow highlight
    rgba(255, 255, 255, 255)  // white
  ],
  // https://en.wikipedia.org/wiki/Ceefax (broadcast-shifted)
  TELETEXT_CEEFAX: [
    rgba(0, 0, 0, 255),
    rgba(255, 0, 0, 255),
    rgba(0, 255, 0, 255),
    rgba(255, 255, 0, 255),
    rgba(0, 0, 255, 255),
    rgba(255, 0, 255, 255),
    rgba(0, 255, 255, 255),
    rgba(255, 255, 255, 255)
  ],
  // https://en.wikipedia.org/wiki/Windows_95
  WIN95: [
    rgba(0, 0, 0, 255),       // black
    rgba(128, 0, 0, 255),     // dark red
    rgba(0, 128, 0, 255),     // dark green
    rgba(128, 128, 0, 255),   // dark yellow
    rgba(0, 0, 128, 255),     // navy (title bar)
    rgba(128, 0, 128, 255),   // dark magenta
    rgba(0, 128, 128, 255),   // desktop teal
    rgba(192, 192, 192, 255), // button face
    rgba(128, 128, 128, 255), // button shadow
    rgba(255, 0, 0, 255),     // red
    rgba(0, 255, 0, 255),     // green
    rgba(255, 255, 0, 255),   // yellow
    rgba(0, 0, 255, 255),     // blue
    rgba(255, 0, 255, 255),   // magenta
    rgba(0, 255, 255, 255),   // cyan
    rgba(255, 255, 255, 255)  // white (highlight)
  ],
  // https://en.wikipedia.org/wiki/Workbench_(AmigaOS)
  WORKBENCH: [
    rgba(0, 85, 170, 255),    // Amiga blue
    rgba(255, 255, 255, 255), // white
    rgba(0, 0, 0, 255),       // black
    rgba(255, 136, 0, 255)    // orange
  ],

  // ── Textile & Fashion ──

  // https://en.wikipedia.org/wiki/Royal_Stewart_tartan
  TARTAN: [
    rgba(180, 20, 20, 255),   // deep red
    rgba(20, 30, 80, 255),    // navy
    rgba(0, 80, 40, 255),     // green
    rgba(230, 200, 40, 255),  // yellow stripe
    rgba(0, 0, 0, 255),       // black
    rgba(240, 240, 240, 255)  // white stripe
  ],
  DENIM: [
    rgba(15, 20, 50, 255),    // raw indigo
    rgba(30, 50, 100, 255),   // dark wash
    rgba(70, 100, 150, 255),  // medium wash
    rgba(140, 160, 190, 255), // faded
    rgba(220, 225, 235, 255)  // bleached
  ],
  TIE_DYE: [
    rgba(220, 30, 30, 255),   // red
    rgba(255, 140, 0, 255),   // orange
    rgba(255, 230, 0, 255),   // yellow
    rgba(0, 180, 60, 255),    // green
    rgba(30, 80, 220, 255),   // blue
    rgba(130, 40, 180, 255),  // purple
    rgba(255, 255, 255, 255)  // white base
  ],

  // ── Photography (continued) ──

  // https://en.wikipedia.org/wiki/Tintype
  TINTYPE: [
    rgba(25, 20, 18, 255),    // dark varnish
    rgba(80, 75, 70, 255),    // metallic shadow
    rgba(140, 130, 120, 255), // silver-brown
    rgba(200, 195, 185, 255), // highlight
    rgba(60, 55, 45, 255)     // edge oxidation
  ],
  // https://en.wikipedia.org/wiki/Platinum_print
  PLATINUM_PRINT: [
    rgba(20, 18, 15, 255),    // warm black
    rgba(80, 75, 65, 255),    // warm dark gray
    rgba(160, 152, 140, 255), // warm light gray
    rgba(240, 232, 218, 255)  // paper cream
  ],

  // ── Space & Astronomy ──

  NEBULA: [
    rgba(5, 5, 15, 255),      // deep space
    rgba(180, 60, 100, 255),  // hydrogen pink
    rgba(200, 150, 50, 255),  // sulfur amber
    rgba(50, 160, 160, 255),  // oxygen teal
    rgba(255, 255, 240, 255), // star white
    rgba(100, 60, 40, 255),   // dust brown
    rgba(120, 50, 160, 255)   // ionized purple
  ],
  MARS: [
    rgba(160, 70, 30, 255),   // rust red soil
    rgba(200, 160, 100, 255), // butterscotch sky
    rgba(60, 45, 35, 255),    // dark basalt
    rgba(210, 190, 160, 255), // pale dust
    rgba(130, 50, 20, 255)    // iron oxide
  ],
  LUNAR: [
    rgba(20, 20, 22, 255),    // deep shadow
    rgba(80, 80, 85, 255),    // dark regolith
    rgba(160, 160, 165, 255), // light regolith
    rgba(220, 220, 225, 255)  // sunlit highland
  ],

  // ── Gemstones & Minerals ──

  GEMSTONE: [
    rgba(180, 10, 30, 255),   // ruby
    rgba(15, 50, 180, 255),   // sapphire
    rgba(0, 130, 60, 255),    // emerald
    rgba(120, 40, 180, 255),  // amethyst
    rgba(220, 180, 40, 255),  // topaz
    rgba(240, 240, 250, 255), // diamond
    rgba(10, 10, 10, 255),    // onyx
    rgba(200, 180, 220, 255)  // opal
  ],
  PATINA: [
    rgba(60, 40, 20, 255),    // dark bronze
    rgba(50, 100, 70, 255),   // oxidized green
    rgba(100, 160, 120, 255), // verdigris
    rgba(170, 200, 170, 255), // pale green
    rgba(180, 120, 60, 255)   // copper highlight
  ],

  // ── Game Aesthetic (continued) ──

  DUNGEON_CRAWL: [
    rgba(10, 8, 12, 255),     // void black
    rgba(200, 140, 40, 255),  // torch amber
    rgba(160, 20, 20, 255),   // blood red
    rgba(120, 115, 110, 255), // stone gray
    rgba(60, 90, 40, 255),    // moss green
    rgba(220, 210, 190, 255), // bone white
    rgba(140, 70, 30, 255),   // rust brown
    rgba(60, 30, 70, 255)     // shadow purple
  ],
  ACID_DREAM: [
    rgba(255, 0, 200, 255),   // electric magenta
    rgba(0, 255, 60, 255),    // acid green
    rgba(255, 120, 0, 255),   // hot orange
    rgba(80, 0, 180, 255),    // deep violet
    rgba(0, 255, 255, 255),   // cyan flash
    rgba(255, 220, 0, 255),   // golden
    rgba(140, 0, 255, 255),   // ultraviolet
    rgba(255, 255, 255, 255)  // white
  ],
  PIXEL_NOIR: [
    rgba(10, 10, 15, 255),    // near-black
    rgba(20, 25, 50, 255),    // dark blue
    rgba(100, 110, 120, 255), // rain gray
    rgba(255, 40, 60, 255),   // neon red accent
    rgba(200, 170, 140, 255), // skin tone
    rgba(240, 240, 245, 255)  // white highlight
  ],

  // ── Signage & Transit ──

  HIGHWAY_SIGN: [
    rgba(0, 100, 60, 255),    // sign green
    rgba(255, 255, 255, 255), // reflective white
    rgba(255, 200, 0, 255),   // warning yellow
    rgba(200, 20, 20, 255),   // stop red
    rgba(0, 50, 130, 255)     // interstate blue
  ],
  // OSHA/ISO safety color coding
  SAFETY: [
    rgba(200, 20, 20, 255),   // danger red
    rgba(255, 200, 0, 255),   // caution yellow
    rgba(0, 140, 60, 255),    // safety green
    rgba(0, 80, 180, 255),    // info blue
    rgba(255, 120, 0, 255),   // warning orange
    rgba(255, 255, 255, 255)  // white
  ],

  // Derived from the user-provided animated-film palette reference:
  // https://raw.githubusercontent.com/ewenme/ghibli/master/inst/extdata/palettes.yml
  MARINA_MANOR_MIST: [
    rgba(149, 145, 142, 255),
    rgba(175, 150, 153, 255),
    rgba(128, 199, 201, 255),
    rgba(142, 187, 210, 255),
    rgba(227, 209, 195, 255),
    rgba(179, 221, 235, 255),
    rgba(243, 232, 204, 255)
  ],
  MARINA_MANOR_MOODY: [
    rgba(40, 35, 29, 255),
    rgba(94, 45, 48, 255),
    rgba(0, 142, 144, 255),
    rgba(28, 119, 163, 255),
    rgba(197, 163, 135, 255),
    rgba(103, 184, 214, 255),
    rgba(233, 208, 151, 255)
  ],
  MARINA_MANOR_AFTER_DARK: [
    rgba(21, 17, 14, 255),
    rgba(47, 22, 25, 255),
    rgba(0, 71, 73, 255),
    rgba(14, 59, 82, 255),
    rgba(99, 81, 67, 255),
    rgba(51, 93, 107, 255),
    rgba(115, 104, 76, 255)
  ],
  SALTSPRITE_CANDYFOAM: [
    rgba(166, 160, 160, 255),
    rgba(173, 183, 192, 255),
    rgba(148, 197, 204, 255),
    rgba(244, 173, 179, 255),
    rgba(238, 188, 177, 255),
    rgba(236, 216, 157, 255),
    rgba(244, 227, 211, 255)
  ],
  SALTSPRITE_TIDEPOP: [
    rgba(76, 65, 63, 255),
    rgba(90, 111, 128, 255),
    rgba(39, 139, 154, 255),
    rgba(231, 91, 100, 255),
    rgba(222, 120, 98, 255),
    rgba(216, 175, 57, 255),
    rgba(232, 196, 162, 255)
  ],
  SALTSPRITE_ABYSSBUBBLE: [
    rgba(38, 32, 32, 255),
    rgba(45, 55, 64, 255),
    rgba(20, 69, 76, 255),
    rgba(116, 45, 51, 255),
    rgba(110, 60, 49, 255),
    rgba(108, 88, 29, 255),
    rgba(116, 99, 83, 255)
  ],
  SKYCASTLE_POSTCARD: [
    rgba(137, 141, 144, 255),
    rgba(141, 147, 161, 255),
    rgba(159, 153, 181, 255),
    rgba(175, 172, 201, 255),
    rgba(215, 202, 222, 255),
    rgba(218, 237, 243, 255),
    rgba(247, 234, 189, 255)
  ],
  SKYCASTLE_STORMSIGNAL: [
    rgba(20, 25, 31, 255),
    rgba(29, 38, 69, 255),
    rgba(64, 51, 105, 255),
    rgba(92, 89, 146, 255),
    rgba(174, 147, 190, 255),
    rgba(180, 218, 229, 255),
    rgba(240, 215, 123, 255)
  ],
  SKYCASTLE_ENGINE_ROOM: [
    rgba(9, 13, 16, 255),
    rgba(13, 19, 33, 255),
    rgba(31, 25, 53, 255),
    rgba(47, 44, 73, 255),
    rgba(87, 74, 94, 255),
    rgba(90, 109, 115, 255),
    rgba(119, 106, 61, 255)
  ],
  WOLFSHADOW_BLUSH: [
    rgba(131, 138, 144, 255),
    rgba(186, 150, 138, 255),
    rgba(159, 167, 190, 255),
    rgba(179, 184, 177, 255),
    rgba(231, 167, 155, 255),
    rgba(242, 198, 149, 255),
    rgba(245, 237, 201, 255)
  ],
  WOLFSHADOW_IRONBARK: [
    rgba(6, 20, 31, 255),
    rgba(116, 44, 20, 255),
    rgba(61, 79, 125, 255),
    rgba(101, 112, 96, 255),
    rgba(205, 79, 56, 255),
    rgba(228, 140, 42, 255),
    rgba(234, 216, 144, 255)
  ],
  WOLFSHADOW_EMBERROOT: [
    rgba(3, 10, 16, 255),
    rgba(58, 22, 10, 255),
    rgba(31, 39, 62, 255),
    rgba(51, 56, 49, 255),
    rgba(103, 39, 27, 255),
    rgba(114, 70, 21, 255),
    rgba(117, 109, 73, 255)
  ],
  BATHHOUSE_BUBBLEBATH: [
    rgba(143, 146, 151, 255),
    rgba(154, 156, 151, 255),
    rgba(193, 154, 155, 255),
    rgba(199, 192, 200, 255),
    rgba(180, 220, 245, 255),
    rgba(225, 215, 203, 255),
    rgba(219, 235, 248, 255)
  ],
  BATHHOUSE_TRAINRIDE: [
    rgba(31, 38, 46, 255),
    rgba(53, 56, 49, 255),
    rgba(131, 52, 55, 255),
    rgba(143, 128, 147, 255),
    rgba(103, 185, 233, 255),
    rgba(195, 175, 151, 255),
    rgba(183, 217, 242, 255)
  ],
  BATHHOUSE_SOOTSHIFT: [
    rgba(15, 18, 23, 255),
    rgba(26, 28, 23, 255),
    rgba(65, 26, 27, 255),
    rgba(71, 64, 72, 255),
    rgba(52, 92, 117, 255),
    rgba(97, 87, 75, 255),
    rgba(91, 107, 120, 255)
  ],
  HARVEST_MEMOIR_DAYBOOK: [
    rgba(118, 129, 133, 255),
    rgba(126, 140, 151, 255),
    rgba(136, 152, 141, 255),
    rgba(157, 175, 195, 255),
    rgba(177, 213, 187, 255),
    rgba(236, 226, 139, 255),
    rgba(195, 218, 234, 255)
  ],
  HARVEST_MEMOIR_AFTERNOON: [
    rgba(6, 26, 33, 255),
    rgba(19, 46, 65, 255),
    rgba(38, 67, 47, 255),
    rgba(77, 109, 147, 255),
    rgba(111, 179, 130, 255),
    rgba(220, 202, 44, 255),
    rgba(146, 187, 217, 255)
  ],
  HARVEST_MEMOIR_DUSK: [
    rgba(3, 14, 18, 255),
    rgba(11, 25, 36, 255),
    rgba(21, 37, 26, 255),
    rgba(42, 60, 80, 255),
    rgba(62, 98, 72, 255),
    rgba(121, 111, 24, 255),
    rgba(80, 103, 119, 255)
  ],
  BROOMCOURIER_PASTRYBOX: [
    rgba(142, 140, 143, 255),
    rgba(154, 154, 162, 255),
    rgba(217, 133, 148, 255),
    rgba(134, 194, 218, 255),
    rgba(208, 193, 170, 255),
    rgba(192, 221, 225, 255),
    rgba(233, 219, 208, 255)
  ],
  BROOMCOURIER_SIGNPAINT: [
    rgba(28, 26, 31, 255),
    rgba(51, 53, 68, 255),
    rgba(181, 10, 42, 255),
    rgba(14, 132, 180, 255),
    rgba(158, 131, 86, 255),
    rgba(126, 186, 194, 255),
    rgba(209, 183, 158, 255)
  ],
  BROOMCOURIER_MIDNIGHTDROP: [
    rgba(14, 12, 15, 255),
    rgba(26, 26, 34, 255),
    rgba(89, 5, 20, 255),
    rgba(6, 66, 90, 255),
    rgba(80, 65, 42, 255),
    rgba(64, 93, 97, 255),
    rgba(105, 91, 80, 255)
  ],
  BIGFUZZY_PILLOWFORT: [
    rgba(133, 137, 138, 255),
    rgba(149, 148, 146, 255),
    rgba(172, 157, 150, 255),
    rgba(168, 166, 169, 255),
    rgba(161, 177, 200, 255),
    rgba(214, 192, 169, 255),
    rgba(220, 211, 196, 255)
  ],
  BIGFUZZY_RAINYPATH: [
    rgba(10, 18, 21, 255),
    rgba(45, 42, 37, 255),
    rgba(88, 59, 43, 255),
    rgba(83, 76, 83, 255),
    rgba(68, 101, 144, 255),
    rgba(173, 129, 82, 255),
    rgba(187, 167, 140, 255)
  ],
  BIGFUZZY_CAMPHOLLOW: [
    rgba(5, 9, 10, 255),
    rgba(21, 20, 18, 255),
    rgba(44, 29, 22, 255),
    rgba(40, 38, 41, 255),
    rgba(33, 49, 72, 255),
    rgba(86, 64, 41, 255),
    rgba(92, 83, 68, 255)
  ],

  EMPTY: []
};

export const THEME_CATEGORIES: Record<string, Array<{ key: string; desc: string }>> = {
  "CGA / EGA": [
    { key: "CGA", desc: "IBM Color Graphics Adapter — the original 16-color PC palette" },
    { key: "CGA_MICROSOFT_256", desc: "Microsoft Windows default 20-color system palette" },
    { key: "CGA_NTSC", desc: "CGA colors as they appeared through NTSC composite video" },
    { key: "CMYK", desc: "Cyan, magenta, yellow, black — print process primaries" },
    { key: "EGA_MODE4_PALETTE1_HIGH", desc: "CGA mode 4 palette 1 high intensity" },
    { key: "EGA_MODE4_PALETTE1_LOW", desc: "CGA mode 4 palette 1 — magenta, cyan, white on black" },
    { key: "EGA_MODE4_PALETTE2_HIGH", desc: "CGA mode 4 palette 2 high intensity" },
    { key: "EGA_MODE4_PALETTE2_LOW", desc: "CGA mode 4 palette 2 — green, red, yellow on black" },
    { key: "EGA_MODE5_PALETTE3_HIGH", desc: "CGA mode 5 palette 3 high intensity" },
    { key: "EGA_MODE5_PALETTE3_LOW", desc: "CGA mode 5 palette 3 — cyan, red, gray on black" }
  ],
  "Home Computers": [
    { key: "AMSTRAD_CPC", desc: "Amstrad CPC — 3-level RGB giving 27 possible colors" },
    { key: "APPLE2", desc: "Apple II — 16-color hi-res palette with artifact colors" },
    { key: "ATARI_ST", desc: "Atari ST — 16-color palette from 512 possible" },
    { key: "C64", desc: "Commodore 64 — the best-selling 8-bit home computer" },
    { key: "C64_NTSC", desc: "C64 palette with NTSC color shift" },
    { key: "MAC2", desc: "Macintosh II — first color Mac, 16-color system palette" },
    { key: "MSX", desc: "MSX home computer — TI TMS9918 video chip palette" },
    { key: "MSX2_MODE6", desc: "MSX2 mode 6 — restricted 4-color subpalette" },
    { key: "TELETEXT_BBC_MICRO", desc: "BBC Micro teletext — 8 bold broadcast colors" },
    { key: "TRS80", desc: "TRS-80 — green phosphor monochrome, 2 colors" },
    { key: "VIC20", desc: "Commodore VIC-20 — warm-toned predecessor to the C64" },
    { key: "ZX_SPECTRUM", desc: "Sinclair ZX Spectrum — 15 colors, bright and normal variants" }
  ],
  "Consoles & Handhelds": [
    { key: "GAME_GEAR", desc: "Sega Game Gear — 12-bit color, 4096 possible" },
    { key: "GAMEBOY", desc: "Game Boy DMG — 4 shades of yellow-green LCD" },
    { key: "GAMEBOY_COLOR", desc: "Game Boy Color — boot ROM default palette" },
    { key: "GAMEBOY_POCKET", desc: "Game Boy Pocket — cooler gray-green LCD tones" },
    { key: "GBA", desc: "Game Boy Advance — curated from 15-bit color" },
    { key: "NEO_GEO_POCKET", desc: "Neo Geo Pocket Color — SNK's handheld 16-color palette" },
    { key: "NES", desc: "Nintendo Entertainment System — curated 16 from the 2C02 PPU" },
    { key: "SEGA_MASTER_SYSTEM", desc: "Sega Master System — 6-bit RGB, 64 possible colors" },
    { key: "SNES", desc: "Super Nintendo — curated from 15-bit color space" },
    { key: "VIRTUAL_BOY", desc: "Virtual Boy — 4 shades of red on black" },
    { key: "WONDERSWAN", desc: "Bandai WonderSwan — 8-shade grayscale LCD" }
  ],
  "Fantasy Consoles": [
    { key: "PICO8", desc: "PICO-8 — beloved 16-color palette for pixel art" },
    { key: "TIC80", desc: "TIC-80 Sweetie 16 — softer companion to PICO-8" }
  ],
  "Game Aesthetic": [
    { key: "ACID_DREAM", desc: "Psychedelic — electric magenta, acid green, ultraviolet" },
    { key: "BAR_11_HALL_B", desc: "Cyberpunk bartending — dark purples to neon pink" },
    { key: "DUNGEON_CRAWL", desc: "Dark fantasy torch-lit stone — amber, blood, moss" },
    { key: "FALLWELL", desc: "Falling action — white, red, blue on black" },
    { key: "FALLWELL_FURIOUS", desc: "Falling action fury — cyan, magenta, orange" },
    { key: "FALLWELL_GREENBOY", desc: "Falling action handheld — muted green tones" },
    { key: "FALLWELL_NIKAIDO", desc: "Falling action Nikaido variant" },
    { key: "FALLWELL_RGB", desc: "Falling action RGB variant" },
    { key: "FALLWELL_ZENNYAN", desc: "Falling action pastel variant" },
    { key: "ICY_MOUNTAIN", desc: "Cold alpine blues with warm skin and golden accents" },
    { key: "NEON_DUSK", desc: "Vivid neon-on-dark with cyan and magenta emphasis" },
    { key: "NEON_VIOLENCE", desc: "Aggressive neons — hot pink, cyan, purple, blood red" },
    { key: "ONE_BIT", desc: "1-bit warm rendering — near-black and warm white" },
    { key: "PIXEL_NOIR", desc: "Noir pixel art — dark blues with neon red accent" },
    { key: "RETRO_KNIGHT", desc: "NES-inspired but richer — deep blues and warm golds" },
    { key: "TERRABOUND_1", desc: "Quirky RPG earth tones with pink and gold accents" }
  ],
  "PC-98": [
    { key: "PC98_DEIMOS", desc: "NEC PC-98 sci-fi palette — Mars moon atmosphere" },
    { key: "PC98_HAUNTSMAN", desc: "PC-98 horror — dark supernatural palette" },
    { key: "PC98_MAIDEN_CHERUB", desc: "PC-98 fantasy — ethereal pastels and deep tones" },
    { key: "PC98_NAIVE_VOYAGE", desc: "PC-98 adventure — warm journey colors" },
    { key: "PC98_SPACE_DEPUTIES", desc: "PC-98 space adventure — cinematic blues and oranges" },
    { key: "PC98_YUNA", desc: "PC-98 visual novel — soft warm tones" }
  ],
  "Film & Photography": [
    { key: "AUTOCHROME", desc: "Autochrome Lumière — early color photography, muted & dreamy" },
    { key: "CROSS_PROCESS", desc: "Cross-processed E6↔C41 — green shift, purple shadows" },
    { key: "CYANOTYPE", desc: "Prussian blue sun-printing process on cream paper" },
    { key: "DAGUERREOTYPE", desc: "Silver-mercury process — cool metallic tones (1839)" },
    { key: "KODACHROME", desc: "Kodachrome slide film — warm, saturated, legendary" },
    { key: "LOMOGRAPHY", desc: "Lomo — cross-processed, saturated, crushed blacks" },
    { key: "NOIR", desc: "Film noir — high-contrast grayscale with warm whites" },
    { key: "PLATINUM_PRINT", desc: "Platinum/palladium print — warm rich blacks on cream" },
    { key: "POLAROID", desc: "Faded instant film — desaturated warm with cyan shadows" },
    { key: "SEPIA", desc: "Sepia toning — 8-shade warm brown gradient" },
    { key: "TECHNICOLOR", desc: "3-strip Technicolor — oversaturated Hollywood primaries" },
    { key: "TINTYPE", desc: "Wet plate collodion tintype — cool metallic silver (1860s)" }
  ],
  "Animated Knockoffs": [
    { key: "BATHHOUSE_BUBBLEBATH", desc: "Ghostly spa day — powder pinks, porcelain neutrals, misty blue" },
    { key: "BATHHOUSE_SOOTSHIFT", desc: "Late-shift boiler room — charcoal, oxblood, stormy teal" },
    { key: "BATHHOUSE_TRAINRIDE", desc: "Dream commute at dusk — mauve, sky blue, warm tan" },
    { key: "BIGFUZZY_CAMPHOLLOW", desc: "Forest creature campfire — bark brown, slate blue, soot gray" },
    { key: "BIGFUZZY_PILLOWFORT", desc: "Gentle giant nap palette — mushroom gray, denim, oatmeal" },
    { key: "BIGFUZZY_RAINYPATH", desc: "Umbrella walk through the woods — wet stone, chestnut, faded blue" },
    { key: "BROOMCOURIER_MIDNIGHTDROP", desc: "After-hours delivery run — plum red, harbor teal, cocoa" },
    { key: "BROOMCOURIER_PASTRYBOX", desc: "Bakery window charm — blush pink, sky blue, frosted cream" },
    { key: "BROOMCOURIER_SIGNPAINT", desc: "Small-town shopfront — poster red, painted blue, warm kraft paper" },
    { key: "HARVEST_MEMOIR_AFTERNOON", desc: "Country scrapbook in summer — leaf green, cloud blue, sunflower" },
    { key: "HARVEST_MEMOIR_DAYBOOK", desc: "Memory album washed in daylight — sage, butter, schoolbook blue" },
    { key: "HARVEST_MEMOIR_DUSK", desc: "Evening farm road — inky blue, moss, dim lantern gold" },
    { key: "MARINA_MANOR_AFTER_DARK", desc: "Seaside mystery after curfew — pine black, wine, deep harbor teal" },
    { key: "MARINA_MANOR_MIST", desc: "Coastal manor morning fog — faded rose, sea glass, antique cream" },
    { key: "MARINA_MANOR_MOODY", desc: "Salt-air drama — mahogany, petrol blue, sanded brass" },
    { key: "SALTSPRITE_ABYSSBUBBLE", desc: "Deep tide fantasy — kelp shadow, coral ember, anchor rust" },
    { key: "SALTSPRITE_CANDYFOAM", desc: "Bubblegum shoreline — sherbet pink, aqua, seashell beige" },
    { key: "SALTSPRITE_TIDEPOP", desc: "Sunlit surf chaos — candy coral, sea blue, goldfish yellow" },
    { key: "SKYCASTLE_ENGINE_ROOM", desc: "Ancient flying machine at night — indigo steel, brass, smoke" },
    { key: "SKYCASTLE_POSTCARD", desc: "Floating-island postcard — lavender stone, cloud blue, parchment gold" },
    { key: "SKYCASTLE_STORMSIGNAL", desc: "Adventure serial sky chase — ultramarine, orchid, beacon gold" },
    { key: "WOLFSHADOW_BLUSH", desc: "Mythic forest dawn — clay pink, mist blue, pale amber" },
    { key: "WOLFSHADOW_EMBERROOT", desc: "Ash-and-cedar night hunt — charcoal, ember orange, bog green" },
    { key: "WOLFSHADOW_IRONBARK", desc: "Ancient woodland conflict — iron blue, bark brown, signal red" }
  ],
  "Art & Design": [
    { key: "ART_DECO", desc: "Roaring twenties luxury — gold, jade, lacquer, ivory" },
    { key: "ART_NOUVEAU", desc: "Organic curves era — sage, antique gold, muted rose" },
    { key: "BAUHAUS", desc: "Kandinsky color theory — geometric primaries + gray" },
    { key: "BYZANTINE", desc: "Eastern Roman mosaics — Tyrian purple, gold leaf, lapis" },
    { key: "MEMPHIS_MILANO", desc: "Memphis-Milano — Sottsass postmodern riot of color (1981)" },
    { key: "MONDRIAN", desc: "De Stijl — red, blue, yellow, black, white (1920s)" },
    { key: "POP_ART", desc: "Warhol / Lichtenstein — bold commercial primaries" },
    { key: "SOVIET_POSTER", desc: "Constructivist propaganda — bold red, black, cream, gold" },
    { key: "UKIYO_E", desc: "Japanese woodblock print — sumi, indigo, vermillion" }
  ],
  "Monochrome CRT": [
    { key: "IBM_3278", desc: "IBM 3278 terminal — specific green-on-black tone" },
    { key: "PHOSPHOR_AMBER", desc: "P3 amber phosphor — warm IBM terminal glow" },
    { key: "PHOSPHOR_GREEN", desc: "P1/P39 green phosphor — classic terminal aesthetic" },
    { key: "PHOSPHOR_WHITE", desc: "P4 blue-white phosphor — paper-white terminal" }
  ],
  "Nature & Seasons": [
    { key: "AUTUMN", desc: "Fall foliage — burnt sienna, rust, maple red, gold" },
    { key: "DESERT", desc: "Arid landscape — sand, terracotta, shadow umber" },
    { key: "FOREST", desc: "Temperate forest — deep greens, bark browns, golden light" },
    { key: "OCEAN", desc: "Deep navy through teal to seafoam and sand" },
    { key: "SANDY_STONE_BEACH", desc: "Sandy shore — warm sand, stone gray, ocean teal" },
    { key: "SPRING", desc: "Cherry blossom, new leaf, dandelion, lilac" },
    { key: "SUNSET", desc: "Golden hour gradient — warm orange to deep purple" },
    { key: "WINTER", desc: "Frost and midnight — steel blue, ice, snow, slate" }
  ],
  "Print & Process": [
    { key: "BLUEPRINT", desc: "Diazo/ferro process — Prussian blue on white" },
    { key: "NEWSPRINT", desc: "Newspaper halftone — ink black and gray on yellowed paper" },
    { key: "RISOGRAPH", desc: "Riso standard ink catalog — fluorescent spot colors" }
  ],
  "Decades": [
    { key: "EIGHTIES", desc: "Hot pink, electric blue, purple — neon and hairspray" },
    { key: "NINETIES", desc: "Teal, plum, chartreuse — grunge meets early web" },
    { key: "SEVENTIES", desc: "Burnt orange, harvest gold, avocado — shag carpet era" },
    { key: "Y2K", desc: "Chrome silver, digital lavender, cyber blue — millennium" }
  ],
  "Regional & Cultural": [
    { key: "ABORIGINAL", desc: "Australian ochre palette — earth pigments on bark" },
    { key: "CHINESE_PORCELAIN", desc: "Ming dynasty blue-and-white — cobalt on glaze" },
    { key: "KINTSUGI", desc: "Japanese gold-repair — beauty in broken ceramics" },
    { key: "MAYAN", desc: "Mesoamerican — Maya blue, jade, cinnabar, obsidian" },
    { key: "MOROCCAN", desc: "Zellige tile — cobalt, saffron, terracotta, emerald" },
    { key: "NORDIC", desc: "Scandinavian winter — fjords, birch white, lingonberry" },
    { key: "PERSIAN_MINIATURE", desc: "Manuscript illumination — lapis, turquoise, gold, vermillion" },
    { key: "WABI_SABI", desc: "Imperfect beauty — weathered wood, moss, aged clay" }
  ],
  "Weather & Atmosphere": [
    { key: "AURORA", desc: "Northern lights — electric green, cyan, magenta curtains" },
    { key: "FOG", desc: "Coastal fog — low contrast, desaturated, muted" },
    { key: "RAINBOW", desc: "Full spectrum ROYGBIV — 7 pure hues" },
    { key: "STORM", desc: "Thunderstorm — charcoal clouds, lightning white, rain teal" },
    { key: "VOLCANIC", desc: "Lava and basalt — obsidian, bright orange, ash" }
  ],
  "Food & Organic": [
    { key: "CANDY", desc: "Confectionery brights — cherry, bubblegum, lime, grape" },
    { key: "COFFEE", desc: "Espresso to latte — dark roast through milk foam" },
    { key: "SPICE", desc: "Spice rack — turmeric, paprika, cinnamon, cardamom" },
    { key: "WINE", desc: "Bordeaux to champagne — deep reds through rosé" }
  ],
  "Architecture & Interior": [
    { key: "BRUTALIST", desc: "Raw concrete minimalism — gray on gray on gray" },
    { key: "MID_CENTURY", desc: "Mid-century modern — teak, mustard, olive, burnt orange" },
    { key: "TERRACOTTA", desc: "Mediterranean clay — warm earth to whitewash" },
    { key: "ZEN_GARDEN", desc: "Raked gravel, moss, wet stone, bamboo, pond" }
  ],
  "Digital & Interface": [
    { key: "DOS_NAVIGATOR", desc: "Norton Commander — blue background, cyan text, yellow highlight" },
    { key: "HYPERCARD", desc: "Mac HyperCard — 1-bit with dithered grays (1987)" },
    { key: "TELETEXT_CEEFAX", desc: "UK Ceefax broadcast — pure RGB teletext colors" },
    { key: "WIN95", desc: "Windows 95/98 — desktop teal, title bar blue, button gray" },
    { key: "WORKBENCH", desc: "Amiga Workbench 1.x — blue, white, black, orange" }
  ],
  "Textile & Fashion": [
    { key: "DENIM", desc: "Indigo gradient — raw indigo through bleached white" },
    { key: "TARTAN", desc: "Royal Stewart tartan — deep red, navy, green plaid" },
    { key: "TIE_DYE", desc: "Spiral tie-dye — saturated spectrum on white cotton" }
  ],
  "Space & Astronomy": [
    { key: "LUNAR", desc: "Moon surface — gray regolith from shadow to sunlit" },
    { key: "MARS", desc: "Red planet — rust soil, butterscotch sky, basalt" },
    { key: "NEBULA", desc: "Hubble-inspired emission nebula — hydrogen, sulfur, oxygen" }
  ],
  "Gemstones & Minerals": [
    { key: "GEMSTONE", desc: "Precious stones — ruby, sapphire, emerald, amethyst, topaz" },
    { key: "PATINA", desc: "Oxidized copper — dark bronze through verdigris to green" }
  ],
  "Material & Texture": [
    { key: "MARBLE", desc: "White marble — veins of warm gray on cool white" },
    { key: "NEON_SIGN", desc: "Gas-tube neon on night sky — red, blue, pink, green" },
    { key: "RUST", desc: "Iron oxidation — deep oxide to bare metal" },
    { key: "STAINED_GLASS", desc: "Leaded glass — ruby, cobalt, amber, emerald on black" }
  ],
  "Music": [
    { key: "GRUNGE", desc: "Seattle flannel — dirty brown, khaki, army green, washed out" },
    { key: "JAZZ", desc: "Smoky club — deep purple, brass gold, velvet red" },
    { key: "REGGAE", desc: "Roots colors — red, gold, green on black" }
  ],
  "Signage & Safety": [
    { key: "HIGHWAY_SIGN", desc: "Road signage — reflective green, warning yellow, stop red" },
    { key: "SAFETY", desc: "OSHA/ISO safety — danger red, caution yellow, info blue" }
  ],
  "Modern Aesthetic": [
    { key: "CYBERPUNK", desc: "Neon-on-dark — cyan, magenta, matrix green, yellow" },
    { key: "PASTEL", desc: "Soft kawaii — baby pink, peach, mint, lavender" },
    { key: "SYNTHWAVE", desc: "Outrun — hot magenta, electric cyan, grid yellow on purple" },
    { key: "VAPORWAVE", desc: "Seapunk vaporwave — pastel pinks, purples, blues on black" },
    { key: "WIREDSOUND", desc: "Fauux neocities — pink, black, tan minimalism" }
  ]
};

const getPaletteSignature = (colors?: number[][] | null) =>
  Array.isArray(colors) ? JSON.stringify(colors) : "";

export const findMatchingThemeKey = (colors?: number[][] | null) => {
  const signature = getPaletteSignature(colors);
  if (!signature) return null;

  for (const [key, palette] of Object.entries(THEMES)) {
    if (getPaletteSignature(palette) === signature) {
      return key;
    }
  }

  return null;
};

export const getThemeDescription = (themeKey: string) => {
  for (const entries of Object.values(THEME_CATEGORIES)) {
    const match = entries.find((entry) => entry.key === themeKey);
    if (match) return match.desc;
  }

  return null;
};

const optionTypes = {
  palette: {
    type: COLOR_ARRAY,
    default: THEMES.CGA
  },
  colorDistanceAlgorithm: COLOR_DISTANCE_ALGORITHM
};

const defaults = {
  colors: optionTypes.palette.default,
  colorDistanceAlgorithm: optionTypes.colorDistanceAlgorithm.default
};

const getColor = (
  color,
  options = defaults
) => {
  const { colors } = options;
  const colorDistanceAlgorithm =
    options.colorDistanceAlgorithm || defaults.colorDistanceAlgorithm;

  if (!colors) {
    return color;
  }

  // WASM precomputed Lab path — palette Lab is cached, only pixel is converted per call.
  // Used for per-pixel matching (error diffusion) when Lab is selected.
  if (
    colorDistanceAlgorithm === LAB_NEAREST
    && (options as { _wasmAcceleration?: boolean })._wasmAcceleration
  ) {
    const idx = wasmNearestLabPrecomputed(color, colors);
    return colors[idx];
  }

  let min = null;
  let minDistance = 0;

  colors.forEach(pc => {
    const distance = colorDistance(pc, color, colorDistanceAlgorithm);

    if (min === null) {
      min = pc;
      minDistance = distance;
    } else if (distance < minDistance) {
      min = pc;
      minDistance = distance;
    }
  });

  return !min ? color : min;
};

const user = {
  name: "User/Adaptive",
  getColor,
  options: defaults,
  optionTypes,
  defaults
};

export default user;

export const createPalette = (colors) => ({
  ...user,
  options: { ...user.options, colors, defaults: colors }
});
