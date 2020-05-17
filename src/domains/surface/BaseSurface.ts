import { SurfaceDescription } from "./Colorspace";
import { RGBASurface } from "./RGBASurface";

export type SurfaceApply<TPixel, TBuffer = any, TOptions = any> = (
  px: TPixel,
  options: TOptions,
  surface: BaseSurface<TPixel, TBuffer>,
  x: number,
  y: number,
  idx: number
) => TPixel;

export type SurfaceApplyMut<TPixel, TBuffer = any, TOptions = any> = (
  px: TPixel,
  options: TOptions,
  surface: BaseSurface<TPixel, TBuffer>,
  x: number,
  y: number,
  idx: number
) => void;

export abstract class BaseSurface<TPixel, TBuffer, TOptions = any> {
  public buffers: Array<TBuffer>;
  public description: SurfaceDescription;
  public height: number;
  public width: number;

  public constructor(options: {
    buffers: Array<TBuffer>;
    surfaceDescription: SurfaceDescription;
    height: number;
    width: number;
  }) {
    this.buffers = options.buffers;
    this.description = options.surfaceDescription;
    this.height = options.height;
    this.width = options.width;
  }

  abstract get(x: number, y: number): TPixel;
  abstract getMut(x: number, y: number): TPixel;
  abstract setMut(x: number, y: number, px: TPixel): void;
  abstract apply(
    fn: SurfaceApply<TPixel, any, TOptions>,
    options: TOptions
  ): void;
  abstract applyMut(
    fn: SurfaceApplyMut<TPixel, any, TOptions>,
    options: TOptions
  ): void;
  abstract toRGBASurface(): RGBASurface;
}

export enum SurfaceClassNames {
  RGBASurface = "RGBASurface",
  LabSurface = "LabSurface",
}

export interface ConvertToSurface<To extends BaseSurface<any, any>> {
  toSurface(ToClass: SurfaceClassNames): To | never;
  asSurface(ToClass: SurfaceClassNames): To | never;
}

export interface ConvertCanvas {
  toImageData(): ImageData;
  toCanvas(canvas: HTMLCanvasElement, options?: { resize?: boolean }): void;
}
