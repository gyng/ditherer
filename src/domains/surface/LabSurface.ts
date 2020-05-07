import { laba2rgba, convertTypedArray } from "../color";
import { SurfaceClassNames, ConvertToSurface } from "./BaseSurface";
import { Colorspace, ImageFormat } from "./Colorspace";
import { RGBASurface } from "./RGBASurface";
import { BitmapSurface } from "./BitmapSurface";

export type LabPixel = Float32Array;
export type LabBuffer = Float32Array;

export class LabSurface extends BitmapSurface<LabPixel, LabBuffer>
  implements ConvertToSurface<RGBASurface> {
  public pixelLength = 4;

  public constructor(options: {
    width: number;
    height: number;
    buffer: LabBuffer;
  }) {
    super({
      surfaceDescription: {
        colorspace: Colorspace.LAB,
        imageFormat: ImageFormat.LABA,
      },
      pixelLength: 4,
      buffer: options.buffer,
      height: options.height,
      width: options.width,
    });
  }

  public toSurface(classname: SurfaceClassNames): RGBASurface | never {
    switch (classname) {
      case SurfaceClassNames.RGBASurface:
        const convert = (inView: LabPixel, outView: Uint8ClampedArray) => {
          outView.set(laba2rgba(inView));
        };
        const newBuf = new Uint8ClampedArray(this.buffers[0].length);
        convertTypedArray(this.buffers[0], newBuf, convert, 4, 4);

        return new RGBASurface({
          width: this.width,
          height: this.height,
          buffer: newBuf,
        });
      default:
        throw new Error(`cannot convert from LabSurface to ${classname}`);
    }
  }

  public asSurface(classname: SurfaceClassNames): RGBASurface | never {
    switch (classname) {
      default:
        throw new Error(`cannot convert from LabSurface as ${classname}`);
    }
  }

  public toRGBASurface() {
    return this.toSurface(SurfaceClassNames.RGBASurface);
  }
}
