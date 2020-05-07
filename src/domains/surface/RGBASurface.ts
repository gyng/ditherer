import { rgba2laba, convertTypedArray } from "../color";
import {
  ConvertCanvas,
  SurfaceClassNames,
  ConvertToSurface,
} from "./BaseSurface";
import { Colorspace, ImageFormat, SurfaceDescription } from "./Colorspace";
import { BitmapSurface } from "./BitmapSurface";
import { LabSurface, LabPixel } from "./LabSurface";

type Self = RGBASurface;
export type RGBAPixel = Uint8ClampedArray;
export type RGBABuffer = Uint8ClampedArray;

export class RGBASurface extends BitmapSurface<RGBAPixel, RGBABuffer>
  implements ConvertToSurface<Self | LabSurface>, ConvertCanvas {
  public pixelLength = 4;

  public constructor(options: {
    width: number;
    height: number;
    buffer: Uint8ClampedArray;
    surfaceDescription?: SurfaceDescription;
  }) {
    super({
      surfaceDescription: options.surfaceDescription ?? {
        colorspace: Colorspace.SRGB,
        imageFormat: ImageFormat.RGBA,
      },
      buffer: options.buffer,
      pixelLength: 4,
      height: options.height,
      width: options.width,
    });
  }

  public toImageData(): ImageData {
    return new ImageData(this.buffers[0], this.width, this.height);
  }

  public toSurface(classname: SurfaceClassNames): LabSurface | never {
    switch (classname) {
      case SurfaceClassNames.LabSurface:
        const convert = (inView: Uint8ClampedArray, outView: LabPixel) => {
          outView.set(rgba2laba(inView));
        };
        const newBuf = new Float32Array(this.buffers[0].length);
        convertTypedArray(this.buffers[0], newBuf, convert, 4, 4);

        return new LabSurface({
          width: this.width,
          height: this.height,
          buffer: newBuf,
        });
      default:
        throw new Error(`cannot convert from RGBASurface to ${classname}`);
    }
  }

  public asSurface(classname: SurfaceClassNames): never {
    switch (classname) {
      default:
        throw new Error(`cannot convert from RGBASurface as ${classname}`);
    }
  }

  public toRGBASurface() {
    return new RGBASurface({
      width: this.width,
      height: this.height,
      buffer: new Uint8ClampedArray(this.buffers[0]),
    });
  }

  public toCanvas(canvas: HTMLCanvasElement, options?: { resize?: boolean }) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("could not get canvas context");
    }

    if (options?.resize) {
      canvas.width = this.width;
      canvas.height = this.height;
    }

    const data = this.toImageData();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(data, 0, 0);
  }

  public static fromCanvas(canvas: HTMLCanvasElement): Promise<Self> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject("could not get canvas context");
            return;
          }
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve(
            new RGBASurface({
              buffer: imageData.data,
              height: canvas.height,
              width: canvas.width,
            })
          );
        } else {
          reject("could not get canvas data");
        }
      });
    });
  }
}
