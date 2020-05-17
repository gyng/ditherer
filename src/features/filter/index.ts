import {
  BaseSurface,
  SurfaceApplyMut,
  RGBAPixel,
  Colorspace,
} from "@src/domains/surface";
import { Palette } from "@src/domains/color/palette";
import { rgba } from "@src/domains/color";
import { DistanceAlgorithm } from "@src/domains/color/distance";

enum OptionType {
  DistanceAlgorithm = "DistanceAlgorithm",
  Palette = "Palette",
}

interface Option<T> {
  type: OptionType;
  value: T;
}

interface OptionSelect<T> extends Option<T> {
  range: T[];
}

export interface FilterDescriptor {
  options: Record<string, Option<any>>;
}

export type FilterOptions<FD extends FilterDescriptor> = FD["options"];

export interface FilterNode<T extends FilterDescriptor = any> {
  filter: Filter<T>;
  options: FilterOptions<T>;
}

interface PaletteSwapDescriptor extends FilterDescriptor {
  options: {
    distanceAlgorithm: Option<DistanceAlgorithm>;
    palette: Option<Palette>;
  };
}

const convert: SurfaceApplyMut<RGBAPixel> = (
  px,
  options: FilterOptions<PaletteSwapDescriptor>,
  surface
) => {
  px.set(
    Palette.getNearest(
      px,
      options.palette.value.colors[surface.description.colorspace],
      options.distanceAlgorithm.value
    )
  );
};

export const paletteSwap: Filter<PaletteSwapDescriptor> = {
  descriptor: () => ({
    options: {
      distanceAlgorithm: {
        type: OptionType.DistanceAlgorithm,
        value: DistanceAlgorithm.ApproxRGBA,
      },
      palette: {
        type: OptionType.Palette,
        value: new Palette([
          rgba(255, 0, 0, 255),
          rgba(0, 255, 0, 255),
          rgba(0, 0, 255, 255),
          rgba(0, 0, 0, 255),
          rgba(255, 255, 255, 255),
        ]),
      },
    },
  }),
  fnMut: (input, options) => {
    input.applyMut(convert, options);
    return input;
  },
};

export interface Filter<FD extends FilterDescriptor> {
  descriptor: () => FD;
  fnMut: (
    inSurface: BaseSurface<any, any>,
    options: FD["options"]
  ) => BaseSurface<any, any>;
}

export const filterMut = <FD extends FilterDescriptor>(
  inputSurface: BaseSurface<any, any>,
  filter: Filter<FD>,
  filterOptions: FilterOptions<FD>
): BaseSurface<any, any> => {
  return filter.fnMut(inputSurface, filterOptions);
};
