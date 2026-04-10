import { describe, expect, it } from "vitest";
import mode7 from "filters/mode7";

const makeCanvas = (width: number, height: number, pixelAt: (x: number, y: number) => [number, number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
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
        height: ch
      })
    } : null
  };
};

const makeStripCanvas = (rows: number[]) =>
  makeCanvas(1, rows.length, (_x, y) => [rows[y], 0, 0, 255]);

const runAndCapture = (filterFn, input, options): Uint8ClampedArray | null => {
  let captured: Uint8ClampedArray | null = null;
  const OriginalImageData = (globalThis as any).ImageData;

  (globalThis as any).ImageData = new Proxy(OriginalImageData, {
    construct(target, args): object {
      const instance = Reflect.construct(target, args) as object;
      if (args[0] instanceof Uint8ClampedArray) captured = args[0];
      return instance;
    }
  });

  try {
    filterFn(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("Mode 7", () => {
  it("flies by default", () => {
    expect(mode7.defaults.fly).toBe(true);
  });

  it("samples the projected floor with vertically flipped texture coordinates", () => {
    const input = makeStripCanvas([0, 100, 200, 255]);
    const data = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      horizon: 0,
      pitch: 80,
      fov: 70,
      tile: false
    });

    expect(data).not.toBeNull();
    expect(data![8]).toBeGreaterThan(0);
    expect(data![12]).toBeGreaterThan(data![8]);
  });

  it("renders a quantized retro sky above the horizon when enabled", () => {
    const input = makeCanvas(8, 8, () => [0, 0, 0, 255]);
    const withSky = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      horizon: 0.8,
      pitch: 10,
      sky: true
    });
    const withoutSky = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      horizon: 0.8,
      pitch: 10,
      sky: false
    });

    expect(withSky).not.toBeNull();
    expect(withoutSky).not.toBeNull();
    const topHalfWithSky = Array.from(withSky!.slice(0, withSky!.length / 2));
    const topHalfWithoutSky = Array.from(withoutSky!.slice(0, withoutSky!.length / 2));

    expect(topHalfWithSky.some((value, index) => index % 4 !== 3 && value > 0)).toBe(true);
    expect(topHalfWithSky).not.toEqual(topHalfWithoutSky);
    expect(new Set(topHalfWithSky.filter((_value, index) => index % 4 !== 3)).size).toBeLessThan(12);
  });

  it("supports multiple distinct retro sky motifs", () => {
    const input = makeCanvas(16, 12, () => [0, 0, 0, 255]);
    const sunset = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      horizon: 1,
      pitch: -5,
      sky: true,
      skyStyle: "sunsetCircuit"
    });
    const city = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      horizon: 1,
      pitch: -5,
      sky: true,
      skyStyle: "muteCity"
    });
    const storm = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      horizon: 1,
      pitch: -5,
      sky: true,
      skyStyle: "stormRun"
    });

    expect(sunset).not.toBeNull();
    expect(city).not.toBeNull();
    expect(storm).not.toBeNull();
    const sunsetSky = Array.from(sunset!.slice(0, sunset!.length * 3 / 4));
    const citySky = Array.from(city!.slice(0, city!.length * 3 / 4));
    const stormSky = Array.from(storm!.slice(0, storm!.length * 3 / 4));

    expect(sunsetSky).not.toEqual(citySky);
    expect(citySky).not.toEqual(stormSky);
    expect(sunsetSky).not.toEqual(stormSky);
  });

  it("keeps sampling visible texture rows while flying even when tile is off", () => {
    const input = makeStripCanvas([10, 60, 120, 240]);
    const data = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      horizon: 0,
      pitch: 80,
      fov: 70,
      tile: false,
      fly: true,
      forwardSpeed: 4,
      _frameIndex: 20
    });

    expect(data).not.toBeNull();
    expect(data![12]).toBeGreaterThan(0);
  });

  it("maintains altitude while flying forward unless lift is applied", () => {
    const input = makeCanvas(8, 8, (x, y) => [x * 20, y * 20, 40, 255]);
    const cruising = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      cameraY: 0.9,
      pitch: 45,
      fly: true,
      forwardSpeed: 3,
      _frameIndex: 20
    });
    const climbing = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      cameraY: 0.9,
      pitch: 45,
      fly: true,
      forwardSpeed: 3,
      liftSpeed: 0.5,
      _frameIndex: 20
    });

    expect(cruising).not.toBeNull();
    expect(climbing).not.toBeNull();
    expect(Array.from(climbing!)).not.toEqual(Array.from(cruising!));
  });

  it("turns the floor sampling sideways when yaw is applied", () => {
    const input = makeCanvas(8, 8, (x, y) => [x * 30, y * 20, 0, 255]);
    const straight = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      pitch: 80,
      fov: 70,
      tile: true
    });
    const turning = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      pitch: 80,
      fov: 70,
      tile: true,
      yaw: 30
    });

    expect(straight).not.toBeNull();
    expect(turning).not.toBeNull();
    expect(Array.from(turning!)).not.toEqual(Array.from(straight!));
  });

  it("supports camera translation controls for lateral, height, and forward offsets", () => {
    const input = makeCanvas(8, 8, (x, y) => [x * 20, y * 25, 0, 255]);
    const base = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      tile: true
    });
    const translated = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      tile: true,
      cameraX: 1.25,
      cameraY: 1.8,
      cameraZ: 0.75
    });

    expect(base).not.toBeNull();
    expect(translated).not.toBeNull();
    expect(Array.from(translated!)).not.toEqual(Array.from(base!));
  });

  it("supports roll banking in addition to yaw and pitch", () => {
    const input = makeCanvas(8, 8, (x, y) => [x * 25, y * 25, 0, 255]);
    const base = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      tile: true
    });
    const banked = runAndCapture(mode7.func, input, {
      ...mode7.defaults,
      tile: true,
      pitch: 42,
      roll: 18
    });

    expect(base).not.toBeNull();
    expect(banked).not.toBeNull();
    expect(Array.from(banked!)).not.toEqual(Array.from(base!));
  });
});
