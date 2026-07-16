export type WorkerPrevOutputPayload =
  | ArrayBuffer
  | {
      imageData: ArrayBuffer;
      width: number;
      height: number;
    };

export const getWorkerPrevOutputFrame = (
  payload: WorkerPrevOutputPayload,
  fallbackWidth: number,
  fallbackHeight: number
) => {
  if (payload instanceof ArrayBuffer) {
    return {
      pixels: new Uint8ClampedArray(payload),
      width: fallbackWidth,
      height: fallbackHeight,
    };
  }

  return {
    pixels: new Uint8ClampedArray(payload.imageData),
    width: payload.width,
    height: payload.height,
  };
};
