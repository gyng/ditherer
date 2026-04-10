import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Overall burn intensity" },
  warmth: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6, desc: "Warm color bias of the burn" },
  hotspots: { type: RANGE, range: [0, 5], step: 1, default: 2, desc: "Number of concentrated burn areas" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for burn placement" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  warmth: optionTypes.warmth.default,
  hotspots: optionTypes.hotspots.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const filmBurn = (input, options: any = defaults) => {
  const { intensity, warmth, hotspots, seed, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(seed);

  // Generate hotspot positions
  const spots: { x: number; y: number; r: number; intensity: number }[] = [];
  for (let i = 0; i < hotspots; i++) {
    spots.push({
      x: rng() * W, y: rng() * H,
      r: (0.1 + rng() * 0.3) * Math.max(W, H),
      intensity: 0.3 + rng() * 0.7
    });
  }

  // Edge burn: warm cast creeping from all edges
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let r = buf[i], g = buf[i + 1], b = buf[i + 2];

      // Edge warmth: distance from nearest edge
      const edgeDist = Math.min(x, W - x, y, H - y) / (Math.min(W, H) * 0.3);
      const edgeBurn = Math.max(0, 1 - edgeDist) * intensity;

      // Warm color shift
      r = Math.min(255, Math.round(r + edgeBurn * warmth * 120));
      g = Math.min(255, Math.round(g + edgeBurn * warmth * 40));
      b = Math.max(0, Math.round(b - edgeBurn * warmth * 30));

      // Overexpose slightly
      const overexpose = edgeBurn * 0.3;
      r = Math.min(255, Math.round(r + overexpose * 80));
      g = Math.min(255, Math.round(g + overexpose * 50));

      // Hotspot overexposure
      for (const spot of spots) {
        const dx = x - spot.x, dy = y - spot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t = Math.max(0, 1 - dist / spot.r);
        const hotIntensity = t * t * spot.intensity * intensity;
        r = Math.min(255, Math.round(r + hotIntensity * 200));
        g = Math.min(255, Math.round(g + hotIntensity * 120));
        b = Math.min(255, Math.round(b + hotIntensity * 60));
      }

      // Film grain intensification near burns
      const grainAmount = edgeBurn * 20;
      if (grainAmount > 0) {
        const grainRng = mulberry32(x * 31 + y * 997 + seed);
        const n = (grainRng() - 0.5) * grainAmount;
        r = Math.max(0, Math.min(255, Math.round(r + n)));
        g = Math.max(0, Math.min(255, Math.round(g + n)));
        b = Math.max(0, Math.min(255, Math.round(b + n)));
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Film Burn", func: filmBurn, optionTypes, options: defaults, defaults };
