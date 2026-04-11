import { RANGE, ENUM, BOOL, STRING } from "constants/controlTypes";
import { CHARSET, SHARED_CHARSET_GROUPS, getCharsetString } from "./charsets";
import { cloneCanvas } from "utils";

const CHARSET_ASCII = "ASCII";
const CHARSET_BRAILLE = "BRAILLE";
const CHARSET_BLOCK = "BLOCK";

const ASCII_CHARS = " .:-=+*#%@";
const BLOCK_CHARS = " ░▒▓█";

// Map luminance 0-255 to a braille density character
const BRAILLE_PATTERNS = [0x2800, 0x2801, 0x2803, 0x2807, 0x280F, 0x281F, 0x283F, 0x287F, 0x28FF];
const toBraille = (lum) =>
  String.fromCodePoint(BRAILLE_PATTERNS[Math.round(lum / 255 * 8)]);

export const optionTypes = {
  cellSize: { type: RANGE, range: [4, 32], step: 1, default: 8, desc: "Size of each character cell in pixels" },
  charset: {
    type: ENUM,
    options: [
      {
        label: "Built-ins",
        options: [
          { name: "ASCII tonal", value: CHARSET_ASCII },
          { name: "Braille density", value: CHARSET_BRAILLE },
          { name: "Block ramp", value: CHARSET_BLOCK },
        ],
      },
      ...SHARED_CHARSET_GROUPS,
    ],
    default: CHARSET_ASCII,
    desc: "Character set used to represent luminance; includes shared Matrix rain charsets for stylized text rendering"
  },
  sourceInfluence: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "How much source brightness drives character selection; lower values create denser, fuller text fields" },
  textDensity: { type: RANGE, range: [0.5, 2], step: 0.05, default: 1, desc: "Bias character selection toward lighter or fuller glyphs without changing the source image itself" },
  characterSizeVariation: { type: RANGE, range: [0, 0.75], step: 0.05, default: 0, desc: "Vary character size from cell to cell for a rougher, more unstable text field" },
  characterFlip: { type: RANGE, range: [0, 1], step: 0.05, default: 0, desc: "Introduce deterministic flips and rotations for glitched, scrambled character shapes" },
  color: { type: BOOL, default: true, desc: "Use source colors instead of grayscale" },
  classicGreen: { type: BOOL, default: false, desc: "Use an authentic Matrix green monitor look instead of source colors" },
  greenPhosphorGlow: { type: BOOL, default: false, desc: "Add a subtle phosphor bloom around characters when classic green mode is enabled" },
  background: { type: STRING, default: "black", desc: "Background fill color" }
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  charset: optionTypes.charset.default,
  sourceInfluence: optionTypes.sourceInfluence.default,
  textDensity: optionTypes.textDensity.default,
  characterSizeVariation: optionTypes.characterSizeVariation.default,
  characterFlip: optionTypes.characterFlip.default,
  color: optionTypes.color.default,
  classicGreen: optionTypes.classicGreen.default,
  greenPhosphorGlow: optionTypes.greenPhosphorGlow.default,
  background: optionTypes.background.default
};

const hashCell = (x, y) => {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  return (Math.imul(h, 1274126177) >>> 0) / 0xffffffff;
};

const getTransformMode = (x, y, intensity) => {
  if (intensity <= 0) return 0;
  const roll = hashCell(x, y);
  if (roll > intensity) return 0;

  const variant = hashCell(y, x + 17);
  if (variant < 0.25) return 1; // mirror x
  if (variant < 0.5) return 2; // mirror y
  if (variant < 0.75) return 3; // rotate 180
  return 4; // rotate 90
};

const ascii = (input, options = defaults) => {
  const {
    cellSize,
    charset,
    sourceInfluence,
    textDensity,
    characterSizeVariation,
    characterFlip,
    color,
    classicGreen,
    greenPhosphorGlow,
    background
  } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const size = Math.max(1, Math.round(cellSize));

  outputCtx.fillStyle = background;
  outputCtx.fillRect(0, 0, W, H);
  outputCtx.textBaseline = "top";
  outputCtx.shadowBlur = classicGreen && greenPhosphorGlow ? Math.max(2, size * 0.45) : 0;
  outputCtx.shadowColor = classicGreen && greenPhosphorGlow ? "rgba(110, 255, 140, 0.45)" : "transparent";

  for (let y = 0; y < H; y += size) {
    for (let x = 0; x < W; x += size) {
      const blockW = Math.min(size, W - x);
      const blockH = Math.min(size, H - y);
      const pixels = blockW * blockH;
      let r = 0, g = 0, b = 0, a = 0;

      for (let by = 0; by < blockH; by += 1) {
        for (let bx = 0; bx < blockW; bx += 1) {
          const idx = ((y + by) * W + (x + bx)) * 4;
          r += buf[idx];
          g += buf[idx + 1];
          b += buf[idx + 2];
          a += buf[idx + 3];
        }
      }

      r /= pixels;
      g /= pixels;
      b /= pixels;
      a /= pixels;

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const effectiveLum = (lum / 255) * sourceInfluence + (1 - sourceInfluence);
      const glyphLum = Math.min(1, Math.max(0, 1 - Math.pow(1 - effectiveLum, textDensity)));

      let ch;
      if (charset === CHARSET_BRAILLE) {
        ch = toBraille(glyphLum * 255);
      } else if (charset === CHARSET_BLOCK) {
        ch = BLOCK_CHARS[Math.round(glyphLum * (BLOCK_CHARS.length - 1))];
      } else {
        const glyphs = charset === CHARSET_ASCII
          ? Array.from(ASCII_CHARS)
          : Array.from(getCharsetString(charset, CHARSET.ASCII_ART));
        ch = glyphs[Math.round(glyphLum * (glyphs.length - 1))] || glyphs[glyphs.length - 1] || " ";
      }

      if (classicGreen) {
        const green = Math.round(effectiveLum * 220);
        outputCtx.fillStyle = `rgb(${Math.round(green * 0.05)},${green},${Math.round(green * 0.05)})`;
      } else if (color) {
        outputCtx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a / 255})`;
      } else {
        const v = Math.round(lum);
        outputCtx.fillStyle = `rgb(${v},${v},${v})`;
      }

      const cellX = Math.floor(x / size);
      const cellY = Math.floor(y / size);
      const variationRoll = hashCell(cellX + 101, cellY + 37) * 2 - 1;
      const scaleFactor = Math.max(0.45, 1 + variationRoll * characterSizeVariation);
      const fontSize = Math.max(1, Math.round(size * scaleFactor));
      const transformMode = getTransformMode(cellX, cellY, characterFlip);

      if (transformMode === 0 && characterSizeVariation <= 0) {
        outputCtx.font = `${fontSize}px monospace`;
        outputCtx.fillText(ch, x, y);
        continue;
      }

      const drawX = x + size / 2;
      const drawY = y + size / 2;
      outputCtx.save();
      outputCtx.translate(drawX, drawY);
      outputCtx.font = `${fontSize}px monospace`;

      if (transformMode === 1) {
        outputCtx.scale(-1, 1);
      } else if (transformMode === 2) {
        outputCtx.scale(1, -1);
      } else if (transformMode === 3) {
        outputCtx.rotate(Math.PI);
      } else if (transformMode === 4) {
        outputCtx.rotate(Math.PI / 2);
      }

      outputCtx.fillText(ch, -fontSize * 0.3, -fontSize * 0.55);
      outputCtx.restore();
    }
  }

  return output;
};

export default {
  name: "ASCII",
  func: ascii,
  options: defaults,
  optionTypes,
  defaults
};
