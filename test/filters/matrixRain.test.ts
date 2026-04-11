import { afterEach, beforeEach, describe, expect, it } from "vitest";
import matrixRain, { __testing } from "filters/matrixRain";

const makeCanvas = (width: number, height: number, data: Uint8ClampedArray | number[]) => ({
  width,
  height,
  getContext: (type: string) => type === "2d" ? {
    getImageData: (_x: number, _y: number, cw: number, ch: number) => ({
      data: new Uint8ClampedArray(data),
      width: cw,
      height: ch,
    }),
    putImageData: () => {},
  } : null,
});

const runAndCapture = (input, options): Uint8ClampedArray | null => {
  let captured: Uint8ClampedArray | null = null;
  const OriginalImageData = (globalThis as any).ImageData;

  (globalThis as any).ImageData = new Proxy(OriginalImageData, {
    construct(target, args): object {
      const instance = Reflect.construct(target, args) as object;
      if (args[0] instanceof Uint8ClampedArray) captured = args[0];
      return instance;
    },
  });

  try {
    matrixRain.func(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

const sumGreen = (data: Uint8ClampedArray) => {
  let total = 0;
  for (let i = 1; i < data.length; i += 4) total += data[i];
  return total;
};

const backgroundGreen = (width: number, height: number) => width * height * 2;
const fillCell = (data: Uint8ClampedArray, width: number, x0: number, y0: number, size: number) => {
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const i = ((y * width) + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
};

describe("matrixRain", () => {
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
      if (tagName.toLowerCase() !== "canvas") {
        return originalCreateElement(tagName, options);
      }

      return {
        width: 0,
        height: 0,
        getContext: (type: string) => type === "2d" ? {
          clearRect: () => {},
          fillText: () => {},
          putImageData: () => {},
          drawImage: () => {},
          getImageData: (_x: number, _y: number, cw: number, ch: number) => ({
            data: new Uint8ClampedArray(cw * ch * 4).map((_, index) => (
              index % 4 === 3 ? 255 : 0
            )),
            width: cw,
            height: ch,
          }),
        } : null,
      } as any;
    }) as typeof document.createElement;
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
  });

  it("can trigger local drops from motion instead of only gating existing rain", () => {
    const width = 6;
    const height = 12;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i + 3] = 255;
    }

    // Bright motion in the sampled 2x2 cell.
    fillCell(source, width, 2, 0, 2);

    const ema = new Float32Array(source.length);

    const output = runAndCapture(
      makeCanvas(width, height, source),
      {
        ...matrixRain.defaults,
        columnWidth: 2,
        trailLength: 3,
        density: 0,
        sourceInfluence: 0,
        classicGreen: true,
        motionMode: "TRIGGER_DROPS",
        motionSensitivity: 3,
        _frameIndex: 0,
        _ema: ema,
      }
    );
    expect(output).toBeTruthy();
    expect(sumGreen(output!)).toBeGreaterThan(backgroundGreen(width, height));
  });

  it("uses motionDropStrength to make trigger drops burstier", () => {
    const width = 8;
    const height = 20;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i + 3] = 255;
    }

    fillCell(source, width, 4, 0, 2);

    const ema = new Float32Array(source.length);
    const base = {
      ...matrixRain.defaults,
      columnWidth: 2,
      trailLength: 10,
      density: 0,
      sourceInfluence: 0,
      classicGreen: true,
      motionMode: "TRIGGER_DROPS",
      motionSensitivity: 3,
      _frameIndex: 0,
      _ema: ema,
    };

    const subtle = runAndCapture(makeCanvas(width, height, source), {
      ...base,
      motionDropStrength: 0.25,
    });
    const bursty = runAndCapture(makeCanvas(width, height, source), {
      ...base,
      motionDropStrength: 2,
    });

    expect(subtle).toBeTruthy();
    expect(bursty).toBeTruthy();
    expect(sumGreen(bursty!)).toBeGreaterThan(sumGreen(subtle!));
  });

  it("supports alternate character sets", () => {
    const width = 8;
    const height = 8;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = 255;
      source[i + 1] = 255;
      source[i + 2] = 255;
      source[i + 3] = 255;
    }

    const charsetValues = matrixRain.optionTypes.charset.options.flatMap((option) =>
      Array.isArray(option.options) ? option.options.map((grouped) => grouped.value) : [option.value]
    );

    expect(charsetValues).toEqual(
      expect.arrayContaining([
        "HEX",
        "BLUEPRINT",
        "TICKER",
        "RUNES",
        "CIRCUIT",
        "LEGAL",
        "TRANSIT",
        "ALCHEMY",
        "WEATHER",
        "CYRILLIC",
        "JAPANESE",
        "HIRAGANA",
        "CHINESE",
        "KANJI_LEDGER",
        "HEBREW",
        "ARABIC",
        "DEVANAGARI",
        "MONGOLIAN",
        "HIEROGLYPHS",
        "THAI",
        "OGHAM",
        "ORACLE_BONES",
        "MANCHU",
        "TIFINAGH",
        "TIBETAN",
        "GEORGIAN",
        "ARMENIAN",
        "ETHIOPIC",
        "CHEROKEE",
        "COSMIC",
        "SPACE_SIGNAL",
        "ALIEN_GLYPHS",
        "EMOJI",
        "BRAILLE",
        "BOX_DRAWING",
        "BLOCK_ELEMENTS",
        "ASCII_ART",
        "OCR",
        "BINARY_CONTROL",
        "SUBWAY_SIGNAGE",
        "SCHEMATICS",
        "GLITCH_UI",
        "UI_WIREFRAME",
        "RAIL_TIMETABLE",
        "BARCODE_SCANNER",
        "TELETEXT",
        "INDUSTRIAL_STENCIL",
        "LEGACY_COMPUTING",
        "MOJIBAKE",
        "MOJIBAKE_UTF8_LATIN1",
        "MOJIBAKE_CP1252",
        "MOJIBAKE_REPLACEMENT",
        "MOJIBAKE_SHIFT_JIS",
        "MOJIBAKE_HALF_WIDTH",
        "MOJIBAKE_JP_UTF8",
        "MOJIBAKE_DOUBLE_DECODE",
        "MOJIBAKE_ENTITY_LEAK",
        "MOJIBAKE_FORUM_EXPORT",
        "MOJIBAKE_CONTROL_ROT",
        "MOJIBAKE_CSV_EXCEL",
        "MOJIBAKE_XML_SCREAM",
        "MOJIBAKE_SUBTITLE_RIP",
        "MOJIBAKE_EMAIL_HEADER",
        "MOJIBAKE_PDF_COPY",
        "MOJIBAKE_TERMINAL_BLEED",
        "MOJIBAKE_ZALGO_EXPORT",
        "ARROWS",
        "MATH",
        "CURRENCY",
        "GREEK",
        "MUSIC",
        "ASTROLOGY",
        "HAZARD",
        "STAR_MAP",
        "DNA_LAB",
        "PIXEL_DEBRIS",
        "ANCIENT_NUMERALS",
        "CUNEIFORM",
        "MORSE_SIGNAL",
        "MAP_SYMBOLS",
        "YIJING",
        "BYZANTINE_MUSIC",
        "ALCHEMY_EXPANDED",
        "WEATHER_EXTENDED",
        "TAROT",
        "CHESS",
        "MAHJONG",
        "PLAYING_CARDS",
        "DICE_TABLETOP",
        "DOMINOES",
        "CUSTOM",
      ])
    );

    const output = runAndCapture(makeCanvas(width, height, source), {
      ...matrixRain.defaults,
      charset: "EMOJI",
      classicGreen: true,
      motionMode: "GATE",
      motionSensitivity: 0,
      _frameIndex: 2,
    });

    expect(output).toBeTruthy();
    expect(sumGreen(output!)).toBeGreaterThan(backgroundGreen(width, height));
  });

  it("supports column and character size variation", () => {
    const width = 20;
    const height = 20;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = 255;
      source[i + 1] = 255;
      source[i + 2] = 255;
      source[i + 3] = 255;
    }

    expect(matrixRain.optionTypes.columnSizeVariation.default).toBe(0);
    expect(matrixRain.optionTypes.characterSizeVariation.default).toBe(0);

    const base = {
      ...matrixRain.defaults,
      classicGreen: true,
      motionMode: "GATE",
      motionSensitivity: 0,
      density: 1.6,
      _frameIndex: 3,
    };

    const uniform = runAndCapture(makeCanvas(width, height, source), {
      ...base,
      columnSizeVariation: 0,
      characterSizeVariation: 0,
    });
    const varied = runAndCapture(makeCanvas(width, height, source), {
      ...base,
      columnSizeVariation: 0.75,
      characterSizeVariation: 0.75,
    });

    expect(uniform).toBeTruthy();
    expect(varied).toBeTruthy();
    expect(sumGreen(varied!)).not.toBe(sumGreen(uniform!));
  });

  it("supports character flipping and rotation without changing the default behavior", () => {
    expect(matrixRain.defaults.characterFlip).toBe(0);
    const bitmap = new Uint8Array([
      255, 0, 0,
      0, 255, 0,
      0, 0, 0,
    ]);

    expect(__testing.sampleBitmapAlpha(bitmap, 3, 0, 0, 0)).toBe(1);
    expect(__testing.sampleBitmapAlpha(bitmap, 3, 0, 0, 1)).toBe(0);
    expect(__testing.sampleBitmapAlpha(bitmap, 3, 2, 0, 4)).toBe(1);
    expect(__testing.sampleBitmapAlpha(bitmap, 3, 0, 2, 5)).toBe(1);
  });

  it("supports a custom editable character set", () => {
    const width = 8;
    const height = 8;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = 255;
      source[i + 1] = 255;
      source[i + 2] = 255;
      source[i + 3] = 255;
    }

    expect(matrixRain.defaults.customCharset.length).toBeGreaterThan(0);

    const output = runAndCapture(makeCanvas(width, height, source), {
      ...matrixRain.defaults,
      charset: "CUSTOM",
      customCharset: "Ж雨$",
      classicGreen: true,
      motionMode: "GATE",
      motionSensitivity: 0,
      _frameIndex: 1,
    });

    expect(output).toBeTruthy();
    expect(sumGreen(output!)).toBeGreaterThan(backgroundGreen(width, height));
  });

  it("uses columnOverlap to blend rain into neighboring columns", () => {
    const width = 20;
    const height = 20;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = 255;
      source[i + 1] = 255;
      source[i + 2] = 255;
      source[i + 3] = 255;
    }

    const base = {
      ...matrixRain.defaults,
      columnWidth: 4,
      trailLength: 6,
      speed: 6,
      sourceInfluence: 0,
      classicGreen: true,
      motionSensitivity: 0,
      density: 1.6,
      _frameIndex: 4,
    };

    const lowOverlap = runAndCapture(makeCanvas(width, height, source), {
      ...base,
      columnOverlap: 0,
    });
    const highOverlap = runAndCapture(makeCanvas(width, height, source), {
      ...base,
      columnOverlap: 1.5,
    });

    expect(lowOverlap).toBeTruthy();
    expect(highOverlap).toBeTruthy();
    expect(sumGreen(highOverlap!)).toBeGreaterThan(sumGreen(lowOverlap!));
  });
});
