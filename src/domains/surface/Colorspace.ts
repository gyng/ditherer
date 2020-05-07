export enum ImageFormat {
  RGBA = "RGBA",
  LABA = "LABA",
}

export enum Colorspace {
  SRGB = "SRGB",
  LAB = "LAB",
}

export interface SurfaceDescription {
  colorspace: Colorspace;
  imageFormat: ImageFormat;
}
