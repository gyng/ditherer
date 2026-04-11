import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ascii from "filters/ascii";

const makeCanvas = (width: number, height: number, data: Uint8ClampedArray | number[]) => ({
  width,
  height,
  getContext: (type: string) => type === "2d" ? {
    getImageData: () => ({
      data: new Uint8ClampedArray(data),
      width,
      height,
    }),
  } : null,
});

describe("ascii", () => {
  const originalCreateElement = document.createElement.bind(document);
  let lastCanvas: any = null;

  beforeEach(() => {
    document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() !== "canvas") {
        return originalCreateElement(tagName, options);
      }

      const drawn: string[] = [];
      const fills: string[] = [];
      const fonts: string[] = [];
      const shadowBlurs: number[] = [];
      const shadowColors: string[] = [];
      const transforms = {
        saves: 0,
        restores: 0,
        translates: [] as Array<[number, number]>,
        rotates: [] as number[],
        scales: [] as Array<[number, number]>,
      };
      lastCanvas = {
        width: 0,
        height: 0,
        __drawn: drawn,
        __fills: fills,
        __fonts: fonts,
        __shadowBlurs: shadowBlurs,
        __shadowColors: shadowColors,
        __transforms: transforms,
        getContext: (type: string) => type === "2d" ? {
          drawImage: () => {},
          fillRect: () => {},
          fillText: (text: string) => { drawn.push(text); },
          set fillStyle(value: string) { fills.push(value); },
          save: () => { transforms.saves += 1; },
          restore: () => { transforms.restores += 1; },
          translate: (x: number, y: number) => { transforms.translates.push([x, y]); },
          rotate: (radians: number) => { transforms.rotates.push(radians); },
          scale: (x: number, y: number) => { transforms.scales.push([x, y]); },
          set font(value: string) { fonts.push(value); },
          set shadowBlur(value: number) { shadowBlurs.push(value); },
          set shadowColor(value: string) { shadowColors.push(value); },
          set textBaseline(_value: string) {},
        } : null,
      } as any;
      return lastCanvas;
    }) as typeof document.createElement;
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
    lastCanvas = null;
  });

  it("exposes shared charset options alongside built-ins", () => {
    const charsetValues = ascii.optionTypes.charset.options.flatMap((option) =>
      Array.isArray(option.options) ? option.options.map((grouped) => grouped.value) : [option.value]
    );

    expect(charsetValues).toEqual(expect.arrayContaining([
      "ASCII",
      "BRAILLE",
      "BLOCK",
      "MATRIX_FILM",
      "MOJIBAKE",
      "EMOJI",
    ]));
    expect(ascii.defaults.sourceInfluence).toBe(1);
    expect(ascii.defaults.textDensity).toBe(1);
    expect(ascii.defaults.characterSizeVariation).toBe(0);
    expect(ascii.defaults.characterFlip).toBe(0);
    expect(ascii.defaults.classicGreen).toBe(false);
    expect(ascii.defaults.greenPhosphorGlow).toBe(false);
  });

  it("uses full unicode glyphs for shared charsets", () => {
    const width = 8;
    const height = 8;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = 255;
      source[i + 1] = 255;
      source[i + 2] = 255;
      source[i + 3] = 255;
    }

    const output = ascii.func(makeCanvas(width, height, source), {
      ...ascii.defaults,
      cellSize: 8,
      charset: "EMOJI",
      color: false,
      background: "black",
    }) as any;

    expect(output.__drawn[0]).toBe("🎲");
  });

  it("supports Matrix-style source influence and classic green rendering", () => {
    const width = 8;
    const height = 8;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = 32;
      source[i + 1] = 32;
      source[i + 2] = 32;
      source[i + 3] = 255;
    }

    const sparse = ascii.func(makeCanvas(width, height, source), {
      ...ascii.defaults,
      cellSize: 8,
      charset: "ASCII",
      sourceInfluence: 1,
      classicGreen: false,
      color: false,
    }) as any;

    const denseGreen = ascii.func(makeCanvas(width, height, source), {
      ...ascii.defaults,
      cellSize: 8,
      charset: "ASCII",
      sourceInfluence: 0,
      classicGreen: true,
      color: false,
    }) as any;

    expect(sparse.__drawn[0]).not.toBe(denseGreen.__drawn[0]);
    expect(denseGreen.__fills.some((fill: string) => /^rgb\(/.test(fill))).toBe(true);
  });

  it("supports size variation and deterministic flip transforms", () => {
    const width = 16;
    const height = 16;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = 220;
      source[i + 1] = 220;
      source[i + 2] = 220;
      source[i + 3] = 255;
    }

    ascii.func(makeCanvas(width, height, source), {
      ...ascii.defaults,
      cellSize: 8,
      charset: "ASCII",
      color: false,
      characterSizeVariation: 0.5,
      characterFlip: 1,
    });

    const usedFonts = Array.from(new Set(lastCanvas.__fonts));
    expect(usedFonts.length).toBeGreaterThan(1);
    expect(lastCanvas.__transforms.saves).toBeGreaterThan(0);
    expect(lastCanvas.__transforms.restores).toBe(lastCanvas.__transforms.saves);
    expect(
      lastCanvas.__transforms.rotates.length > 0 ||
      lastCanvas.__transforms.scales.length > 0
    ).toBe(true);
  });

  it("supports independent text density and optional phosphor glow", () => {
    const width = 8;
    const height = 8;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = 64;
      source[i + 1] = 64;
      source[i + 2] = 64;
      source[i + 3] = 255;
    }

    const sparse = ascii.func(makeCanvas(width, height, source), {
      ...ascii.defaults,
      cellSize: 8,
      charset: "ASCII",
      color: false,
      textDensity: 0.5,
    }) as any;

    const denseGlow = ascii.func(makeCanvas(width, height, source), {
      ...ascii.defaults,
      cellSize: 8,
      charset: "ASCII",
      color: false,
      textDensity: 2,
      classicGreen: true,
      greenPhosphorGlow: true,
    }) as any;

    expect(sparse.__drawn[0]).not.toBe(denseGlow.__drawn[0]);
    expect(denseGlow.__shadowBlurs.some((value: number) => value > 0)).toBe(true);
    expect(denseGlow.__shadowColors).toContain("rgba(110, 255, 140, 0.45)");
  });
});
