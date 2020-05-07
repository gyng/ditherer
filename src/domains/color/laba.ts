import { clamp } from "./util";

// treat alpha 0 - 255 always

enum ReferenceValue {
  D65 = "D65",
}

// http://www.easyrgb.com/en/math.php#text1
interface ReferenceValues {
  x: number;
  y: number;
  z: number;
}

enum ReferenceStandard {
  CIE_1931 = "CIE_1931",
  CIE_1964 = "CIE_1964",
}

const referenceTable: Record<
  ReferenceStandard,
  Record<ReferenceValue, ReferenceValues>
> = {
  [ReferenceStandard.CIE_1931]: {
    // 2° (CIE 1931)
    D65: { x: 95.047, y: 100, z: 108.883 },
  },
  [ReferenceStandard.CIE_1964]: {
    // 10° (CIE 1964)
    D65: { x: 94.811, y: 100, z: 107.304 },
  },
};

// https://stackoverflow.com/questions/7880264/convert-lab-color-to-rgb
// http://www.easyrgb.com/en/math.php#text8
// Convert RGB > XYZ > CIE Lab, copying alpha channel
export const rgba2laba = (
  rgba: Uint8ClampedArray,
  ref = referenceTable[ReferenceStandard.CIE_1931][ReferenceValue.D65]
): Float32Array => {
  if (rgba.length !== 4) {
    throw new Error(`unexpected input length, expected 4, got: ${rgba.length}`);
  }

  let r = rgba[0] / 255;
  let g = rgba[1] / 255;
  let b = rgba[2] / 255;

  // sRGB to linear RGB, undo gamma correction
  r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92;
  g = g > 0.04045 ? ((g + 0.055) / 1.055) ** 2.4 : g / 12.92;
  b = b > 0.04045 ? ((b + 0.055) / 1.055) ** 2.4 : b / 12.92;

  r *= 100;
  g *= 100;
  b *= 100;

  // Observer= 2° (Only use CIE 1931!)
  let x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let z = r * 0.0193 + g * 0.1192 + b * 0.9505;

  x /= ref.x;
  y /= ref.y;
  z /= ref.z;

  x = x > 0.008856 ? x ** (1 / 3) : x * 7.787 + 16 / 116;
  y = y > 0.008856 ? y ** (1 / 3) : y * 7.787 + 16 / 116;
  z = z > 0.008856 ? z ** (1 / 3) : z * 7.787 + 16 / 116;

  const outL = 116 * y - 16;
  const outA = 500 * (x - y);
  const outB = 200 * (y - z);

  // TODO: check if alpha is copied right
  return new Float32Array([outL, outA, outB, rgba[3]]);
};

// Convert CIE Lab > XYZ > RGBA, copying alpha channel
export const laba2rgba = (
  laba: Float32Array,
  ref = referenceTable[ReferenceStandard.CIE_1931][ReferenceValue.D65]
): Uint8ClampedArray => {
  if (laba.length !== 4) {
    throw new Error(`unexpected input length, expected 4, got: ${laba.length}`);
  }

  let y = (laba[0] + 16) / 116;
  let x = laba[1] / 500 + y;
  let z = y - laba[2] / 200;

  y = y ** 3 > 0.008856 ? y ** 3 : (y - 16 / 116) / 7.787;
  x = x ** 3 > 0.008856 ? x ** 3 : (x - 16 / 116) / 7.787;
  z = z ** 3 > 0.008856 ? z ** 3 : (z - 16 / 116) / 7.787;

  // Observer= 2° (Only use CIE 1931!)
  x *= ref.x;
  y *= ref.y;
  z *= ref.z;

  // Normalize
  x /= 100;
  y /= 100;
  z /= 100;

  let r = x * 3.2406 + y * -1.5372 + z * -0.4986;
  let g = x * -0.9689 + y * 1.8758 + z * 0.0415;
  let b = x * 0.0557 + y * -0.204 + z * 1.057;

  // linear RGB to RGB, apply gamma correction
  r = r > 0.0031308 ? 1.055 * r ** (1 / 2.4) - 0.055 : 12.92 * r;
  g = g > 0.0031308 ? 1.055 * g ** (1 / 2.4) - 0.055 : 12.92 * g;
  b = b > 0.0031308 ? 1.055 * b ** (1 / 2.4) - 0.055 : 12.92 * b;

  r = clamp(0, 255, Math.round(r * 255));
  g = clamp(0, 255, Math.round(g * 255));
  b = clamp(0, 255, Math.round(b * 255));

  // TODO: check if alpha is copied right
  return new Uint8ClampedArray([r, g, b, laba[3]]);
};
