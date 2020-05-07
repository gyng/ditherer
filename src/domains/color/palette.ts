import { Colorspace } from "../surface";
import { TypedArray } from "./util";
import { rgba2laba } from "./laba";
import { DistanceAlgorithm, distanceAlgorithmFunctions } from "./distance";

export class Palette {
  public colors: Record<Colorspace, TypedArray[]>;

  constructor(rgbColors: Uint8ClampedArray[]) {
    this.colors = {
      [Colorspace.SRGB]: rgbColors,
      [Colorspace.LAB]: rgbColors.map((c) => rgba2laba(c)),
    };
  }

  public getColors(colorspace: Colorspace) {
    return this.colors[colorspace];
  }

  public static getNearest(
    px: TypedArray,
    colors: TypedArray[],
    distanceAlgorithm = DistanceAlgorithm.Euclidean,
    alpha = false
  ) {
    if (colors.length === 0) {
      return px;
    }

    const distanceFn = distanceAlgorithmFunctions[distanceAlgorithm];

    let min: TypedArray | null = null;
    let minDistance = 0;

    for (let i = 0; i < colors.length; i++) {
      const currentPaletteColor = colors[i];
      const d = distanceFn(px, currentPaletteColor, alpha);
      if (min === null || d < minDistance) {
        min = currentPaletteColor;
        minDistance = d;
      }
    }

    return min ?? px;
  }
}
