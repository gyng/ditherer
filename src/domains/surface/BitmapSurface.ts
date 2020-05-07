import { TypedArray } from "../color";
import { BaseSurface } from "./BaseSurface";
import { SurfaceDescription } from "./Colorspace";
import { RGBASurface } from "./RGBASurface";

export abstract class BitmapSurface<
  TPixel extends TypedArray,
  TBuffer extends TypedArray
> extends BaseSurface<TPixel, TBuffer> {
  public pixelLength: number;
  public surfaceDescription: SurfaceDescription;

  public constructor(options: {
    width: number;
    height: number;
    surfaceDescription: SurfaceDescription;
    pixelLength: number;
    buffer: TBuffer;
  }) {
    super({
      buffers: [options.buffer],
      surfaceDescription: options.surfaceDescription,
      height: options.height,
      width: options.width,
    });

    this.pixelLength = options.pixelLength;
    this.surfaceDescription = options.surfaceDescription;
  }

  public getBufferIdx(x: number, y: number): number {
    const idx = y * this.width + x;
    return idx * this.pixelLength;
  }

  public get(x: number, y: number): TPixel {
    const idx = this.getBufferIdx(x, y);
    // @ts-ignore TypedArray must have slice
    return this.buffers[0].slice(idx, idx + this.pixelLength);
  }

  public getMut(x: number, y: number): TPixel {
    const idx = this.getBufferIdx(x, y);
    // @ts-ignore TypedArray must have subarray
    return this.buffers[0].subarray(idx, idx + this.pixelLength);
  }

  public setMut(x: number, y: number, pixel: TPixel) {
    const idx = this.getBufferIdx(x, y);
    this.buffers[0].set(pixel, idx);
  }

  public apply(fn: (px: TPixel, x: number, y: number, idx: number) => TPixel) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = this.getBufferIdx(x, y);
        const curPx = this.get(x, y);
        const newSlice = fn(curPx, x, y, idx);
        this.setMut(x, y, newSlice);
      }
    }
  }

  public applyMut(fn: (px: TPixel, x: number, y: number, idx: number) => void) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = this.getBufferIdx(x, y);
        const curPx = this.getMut(x, y);
        fn(curPx, x, y, idx);
      }
    }
  }

  abstract toRGBASurface(): RGBASurface;
}
