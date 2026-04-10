import { RANGE, ENUM, BOOL, STRING } from "constants/controlTypes";
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
      { name: "ASCII", value: CHARSET_ASCII },
      { name: "Braille", value: CHARSET_BRAILLE },
      { name: "Block", value: CHARSET_BLOCK }
    ],
    default: CHARSET_ASCII,
    desc: "Character set used to represent luminance"
  },
  color: { type: BOOL, default: true, desc: "Use source colors instead of grayscale" },
  background: { type: STRING, default: "black", desc: "Background fill color" }
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  charset: optionTypes.charset.default,
  color: optionTypes.color.default,
  background: optionTypes.background.default
};

const ascii = (input, options = defaults) => {
  const { cellSize, charset, color, background } = options;
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
  outputCtx.font = `${size}px monospace`;
  outputCtx.textBaseline = "top";

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

      let ch;
      if (charset === CHARSET_BRAILLE) {
        ch = toBraille(lum);
      } else if (charset === CHARSET_BLOCK) {
        ch = BLOCK_CHARS[Math.round(lum / 255 * (BLOCK_CHARS.length - 1))];
      } else {
        ch = ASCII_CHARS[Math.round(lum / 255 * (ASCII_CHARS.length - 1))];
      }

      if (color) {
        outputCtx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a / 255})`;
      } else {
        const v = Math.round(lum);
        outputCtx.fillStyle = `rgb(${v},${v},${v})`;
      }
      outputCtx.fillText(ch, x, y);
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
