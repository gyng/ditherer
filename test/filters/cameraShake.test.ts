import { describe, expect, it } from "vitest";

import cameraShake, { __testing } from "filters/cameraShake";

const makeCanvas = (width: number, height: number, pixelAt: (x: number, y: number) => [number, number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const pixel = pixelAt(x, y);
      data[i] = pixel[0];
      data[i + 1] = pixel[1];
      data[i + 2] = pixel[2];
      data[i + 3] = pixel[3];
    }
  }

  return {
    width,
    height,
    getContext: (type: string) => type === "2d" ? {
      getImageData: (_x: number, _y: number, cw: number, ch: number) => ({
        data: new Uint8ClampedArray(data),
        width: cw,
        height: ch,
      }),
    } : null,
  };
};

const runAndCapture = (input, options): Uint8ClampedArray | null => {
  let captured: Uint8ClampedArray | null = null;
  const OriginalImageData = globalThis.ImageData;

  globalThis.ImageData = new Proxy(OriginalImageData, {
    construct(target, args): object {
      const instance = Reflect.construct(target, args) as object;
      if (args[0] instanceof Uint8ClampedArray) captured = args[0];
      return instance;
    },
  }) as typeof ImageData;

  try {
    cameraShake.func(input, options);
  } finally {
    globalThis.ImageData = OriginalImageData;
  }

  return captured;
};

describe("cameraShake", () => {
  it("resets deterministically when the frame index restarts", () => {
    const input = makeCanvas(5, 5, (x, y) => [x * 40, y * 40, (x + y) * 20, 255]);
    const frame0 = runAndCapture(input, { ...cameraShake.defaults, _frameIndex: 0 });
    runAndCapture(input, { ...cameraShake.defaults, _frameIndex: 1 });
    const restarted = runAndCapture(input, { ...cameraShake.defaults, _frameIndex: 0 });

    expect(restarted).toEqual(frame0);
  });

  it("is deterministic for the same frame index", () => {
    __testing.resetRigState();
    const input = makeCanvas(5, 5, (x, y) => [x * 40, y * 40, (x + y) * 20, 255]);
    const options = {
      ...cameraShake.defaults,
      amountX: 8,
      amountY: 6,
      rotation: 2,
      zoomJitter: 0.03,
      frequency: 1,
      inertia: 0.7,
      tremor: 0.4,
      _frameIndex: 3,
    };

    const frameA = runAndCapture(input, options);
    __testing.resetRigState();
    const frameB = runAndCapture(input, options);

    expect(frameA).toEqual(frameB);
  });

  // Pixel-level assertion. cameraShake is now requiresGL: true, so the
  // dispatcher returns a stub canvas in jsdom. Cover with a Playwright /
  // headed-Chrome test if you want to verify actual warp output.
  it.skip("changes its whole-frame sampling across frames", () => {
    __testing.resetRigState();
    const input = makeCanvas(5, 5, (x, y) => [x * 40, y * 40, (x + y) * 20, 255]);
    const frame0 = runAndCapture(input, {
      ...cameraShake.defaults,
      amountX: 8,
      amountY: 6,
      rotation: 2,
      zoomJitter: 0.03,
      frequency: 1,
      inertia: 0.7,
      tremor: 0.4,
      _frameIndex: 0,
    });
    const frame1 = runAndCapture(input, {
      ...cameraShake.defaults,
      amountX: 8,
      amountY: 6,
      rotation: 2,
      zoomJitter: 0.03,
      frequency: 1,
      inertia: 0.7,
      tremor: 0.4,
      _frameIndex: 1,
    });

    expect(frame0).not.toEqual(frame1);
  });
});
