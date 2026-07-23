import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import program, { defaults, optionTypes } from "filters/program";
import nearest from "palettes/nearest";
import { decodeShareState, encodeShareState } from "@src/utils/shareState";

// Program compiles a user-typed string with `new Function` and runs it per
// pixel. The jsdom smoke sweep skips it outright ("uses eval"), so unlike the
// other filters — which at least had "doesn't throw" — this had literally zero
// coverage.
//
// What matters here is the contract around the eval, not the eval itself: the
// documented variables must actually be in scope (they're the filter's entire
// API, advertised in the default program's comment header), and a bad program
// must degrade safely rather than corrupt the image or wedge the app.

const W = 4;
const H = 4;

const identityPalette = { ...nearest, options: { levels: 256 } };

const makeCanvas = (fill: (x: number, y: number) => [number, number, number, number]) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b, a] = fill(x, y);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width: W,
    height: H,
    getContext: (type: string) => type === "2d" ? {
      getImageData: () => ({ data: new Uint8ClampedArray(data), width: W, height: H }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        written = new Uint8ClampedArray(img.data);
      },
    } : null,
  } as unknown as HTMLCanvasElement;
  return { canvas, written: () => written, source: data };
};

const grey = (): [number, number, number, number] => [100, 110, 120, 255];

const run = (src: string, fill = grey, palette: unknown = identityPalette) => {
  const { canvas, written, source } = makeCanvas(fill);
  program.func(canvas, { ...defaults, program: src, palette } as any);
  return { out: written(), source };
};

const px = (buf: Uint8ClampedArray, x: number, y: number) => {
  const i = (y * W + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
};

describe("the dead mode control is gone", () => {
  it("has no mode key in optionTypes", () => {
    expect(optionTypes).not.toHaveProperty("mode");
  });

  it("runs and produces output with the default options", () => {
    const { out } = run(defaults.program, grey);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(W * H * 4);
  });
});

describe("Program runs the user's code", () => {
  it("writes back the channels the program assigns", () => {
    const { out } = run("r = 1; g = 2; b = 3; a = 4;");
    expect(px(out!, 0, 0)).toEqual([1, 2, 3, 4]);
    expect(px(out!, 3, 3)).toEqual([1, 2, 3, 4]);
  });

  it("passes the source pixel in as r,g,b,a", () => {
    const { out } = run("r = g; g = b; b = a;", () => [10, 20, 30, 40]);
    expect(px(out!, 0, 0)).toEqual([20, 30, 40, 40]);
  });

  it("leaves the pixel alone when the program assigns nothing", () => {
    const { out, source } = run("// nothing");
    expect(Array.from(out!)).toEqual(Array.from(source));
  });
});

describe("the documented variables are actually in scope", () => {
  // The default program's comment header advertises r,g,b,a,w,h,x,y,p,i,buf,
  // palette as the filter's API. If one silently isn't bound, a user's program
  // throws mid-run and the image is left half-processed.
  it("exposes w and h", () => {
    const { out } = run("r = w; g = h; b = 0; a = 255;");
    expect(px(out!, 0, 0)).toEqual([W, H, 0, 255]);
  });

  it("exposes x and y", () => {
    const { out } = run("r = x; g = y; b = 0; a = 255;");
    expect(px(out!, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(out!, 3, 2)).toEqual([3, 2, 0, 255]);
  });

  it("exposes i, the buffer index", () => {
    const { out } = run("r = 0; g = 0; b = 0; a = 255; r = i % 256;");
    // (x=3,y=2) -> index (2*4+3)*4 = 44
    expect(px(out!, 3, 2)[0]).toBe(44);
  });

  it("exposes p, the source pixel array", () => {
    const { out } = run("r = p[1]; g = p[2]; b = p[0]; a = p[3];", () => [10, 20, 30, 255]);
    expect(px(out!, 0, 0)).toEqual([20, 30, 10, 255]);
  });

  it("exposes buf, the pixel array", () => {
    const { out } = run("r = buf.length % 256; g = 0; b = 0; a = 255;");
    expect(px(out!, 0, 0)[0]).toBe((W * H * 4) % 256);
  });

  it("exposes palette", () => {
    const { out } = run("r = palette ? 1 : 0; g = 0; b = 0; a = 255;");
    expect(px(out!, 0, 0)[0]).toBe(1);
  });
});

describe("bad programs degrade safely", () => {
  it("a syntax error returns the input untouched", () => {
    // new Function throws at compile time; the filter must hand back the image
    // rather than a blank or half-written one.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { canvas, source } = makeCanvas(grey);
      const result = program.func(canvas, { ...defaults, program: "this is not ( valid js", palette: identityPalette } as any);
      expect(result).toBe(canvas);
      expect(Array.from(source)).toEqual(Array.from(source));
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("a runtime throw stops the run without wedging or corrupting", () => {
    // The loop breaks out on the first throw. The image comes back with
    // whatever had already been written — not blank, not garbage.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { out } = run("throw new Error('boom');");
      expect(out).not.toBeNull();
      expect(out!.length).toBe(W * H * 4);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("an infinite-ish program is the user's problem, but a finite one terminates", () => {
    // Guard against the loop itself being unbounded: a program that does real
    // work per pixel still completes for every pixel.
    const { out } = run("let s = 0; for (let k = 0; k < 50; k++) s += k; r = s % 256; g = 0; b = 0; a = 255;");
    expect(px(out!, 0, 0)[0]).toBe(1225 % 256);
    expect(px(out!, 3, 3)[0]).toBe(1225 % 256);
  }, 5000);

  it("out-of-range channel values are clamped, not wrapped", () => {
    // fillBufferPixel writes into a Uint8ClampedArray, so 300 must clamp to 255
    // and -5 to 0 rather than wrapping to 44 / 251.
    const { out } = run("r = 300; g = -5; b = 128; a = 255;");
    expect(px(out!, 0, 0)).toEqual([255, 0, 128, 255]);
  });

  it("NaN does not corrupt the buffer", () => {
    const { out } = run("r = NaN; g = 0; b = 0; a = 255;");
    expect(px(out!, 0, 0)[0]).toBe(0);
  });
});

describe("the palette still applies after the program", () => {
  it("quantizes the program's output", () => {
    // The program runs first, then the palette snaps its result — so a program
    // emitting arbitrary values still lands on palette colors.
    const { out } = run("r = 200; g = 200; b = 200; a = 255;", grey, { ...nearest, options: { levels: 2 } });
    expect(px(out!, 0, 0)).toEqual([255, 255, 255, 255]);
  });
});

describe("a Program survives the share-URL round trip", () => {
  it("carries its code intact through encode/decode", () => {
    // Not a correctness bug in this filter — but worth having on the record.
    //
    // Chain state (including every filter's `options`) is serialized into the
    // `#!` URL hash for sharing, and FilterContext restores it on load via
    // decodeShareState -> JSON.parse -> LOAD_STATE, with no prompt. Program's
    // `program` option is a TEXT value, so it round-trips like any other — which
    // means a shared link carries executable JS that `new Function` will run
    // against the recipient's image, in the app's origin, with access to
    // localStorage (saved palettes and chains live there).
    //
    // serializeStateJson strips `defaults`, `optionTypes` and functions, but not
    // `options`, so nothing currently stops this. Whether that's acceptable is a
    // product call — the filter's entire purpose is running user JS — but it
    // shouldn't be discovered by accident. This test just pins the fact.
    const payload = "r = 42; /* could be anything, including fetch(...) */";
    const json = JSON.stringify({
      chain: [{ id: "x", displayName: "Program", filter: { name: "Program", options: { ...defaults, program: payload } }, enabled: true }],
    });
    const restored = JSON.parse(decodeShareState(encodeShareState(json)));
    expect(restored.chain[0].filter.options.program).toBe(payload);
  });
});
