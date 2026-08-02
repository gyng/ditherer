const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, finite(value)));

/** Map normalized luminance into the 16 optical states of a GC16 waveform. */
export const einkReflectanceLevel = (
  luminance: number,
  inkBlack: number,
  paperWhite: number,
): number => {
  const black = clamp01(inkBlack);
  const white = Math.max(black, clamp01(paperWhite));
  const code = Math.round(clamp01(luminance) * 15);
  return black + (code / 15) * (white - black);
};

/** Four-bit channel quantization: 16³ combinations form a 4096-color cube. */
export const kaleidoChannelLevel = (channel: number): number =>
  Math.round(clamp01(channel) * 15) / 15;

/** Centre sample of the three-monochrome-pixel-wide Kaleido color cell. */
export const kaleidoColorCell = (pixel: number): number => {
  const coordinate = Math.max(0, Math.floor(finite(pixel)));
  return Math.floor(coordinate / 3) * 3 + 1;
};

/** Resolution-independent Gaussian raster-beam transmission. */
export const vintageTvRasterGain = (
  pixelY: number,
  outputHeight: number,
  sourceLines: number,
  strength: number,
): number => {
  const height = Math.max(1, finite(outputHeight, 1));
  const lines = Math.max(1, finite(sourceLines, 240));
  const amount = clamp01(strength);
  const phase = ((finite(pixelY) + 0.5) / height) * lines;
  const distance = Math.abs(phase - Math.floor(phase) - 0.5);
  const beam = Math.exp(-0.5 * (distance / 0.22) ** 2);
  return 1 - amount * (1 - beam);
};

/** Add ambient and flash exposure in linear-light reflectance units. */
export const flashLinearChannel = (
  sourceReflectance: number,
  ambientExposure: number,
  flashExposure: number,
  flashTint: number,
  sensorSaturation: number,
): number => {
  const source = clamp01(sourceReflectance);
  const ambient = Math.max(0, finite(ambientExposure, 1));
  const flash = Math.max(0, finite(flashExposure));
  const tint = Math.max(0, finite(flashTint, 1));
  const saturation = Math.max(0, finite(sensorSaturation, 1));
  return Math.min(saturation, source * ambient + source * flash * tint);
};

/** Round a centered frame-jitter sample without floor's negative bias. */
export const mavicaFrameJitterOffset = (
  unitSample: number,
  strength: number,
  span: number,
): number => {
  const unit = clamp01(unitSample);
  const amplitude = Math.max(0, finite(strength)) * Math.max(0, finite(span, 1));
  return Math.floor((unit - 0.5) * amplitude + 0.5);
};
