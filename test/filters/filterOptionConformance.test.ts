import { describe, expect, it, vi } from "vitest";
import { BOOL, ENUM, RANGE } from "constants/controlTypes";
import { filterIndex } from "@gyng/ditherer-filters";
import type {
  EnumOption,
  EnumOptionGroup,
  FilterDefinition,
  FilterOptionDefinition,
} from "filters/types";

type SignalKind = "edge" | "black" | "white" | "impulse" | "alpha" | "primary-gradient";

const makeSignalCanvas = (kind: SignalKind = "edge", width = 8, height = 8) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas unavailable in test environment");
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const isCenter = x === Math.floor(width / 2) && y === Math.floor(height / 2);
      if (kind === "black" || kind === "white" || kind === "impulse") {
        const value = kind === "white" || (kind === "impulse" && isCenter) ? 255 : 0;
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
      } else if (kind === "alpha") {
        image.data[offset] = x * 31;
        image.data[offset + 1] = y * 31;
        image.data[offset + 2] = (x + y) * 15;
        image.data[offset + 3] = (x + y) % 3 === 0 ? 0 : x * 32;
      } else if (kind === "primary-gradient") {
        image.data[offset] = Math.round((x / (width - 1)) * 255);
        image.data[offset + 1] = Math.round((y / (height - 1)) * 255);
        image.data[offset + 2] = Math.round(((width - 1 - x) / (width - 1)) * 255);
        image.data[offset + 3] = 255;
      } else {
        image.data[offset] = x < width / 2 ? 24 : 232;
        image.data[offset + 1] = Math.round((y / (height - 1)) * 255);
        image.data[offset + 2] = (x + y) % 2 === 0 ? 48 : 208;
        image.data[offset + 3] = 255;
      }
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
};

const enumValues = (definition: FilterOptionDefinition): Array<string | number> => {
  if (definition.type !== ENUM || !("options" in definition)) return [];
  return definition.options.flatMap((option: EnumOption | EnumOptionGroup) =>
    "options" in option ? option.options.map((entry) => entry.value) : [option.value],
  );
};

type Case = { label: string; patch: Record<string, unknown> };

const optionCases = (filter: FilterDefinition): Case[] => {
  const base = { ...(filter.defaults ?? filter.options ?? {}) };
  const cases: Case[] = [{ label: "defaults", patch: {} }];

  for (const [key, definition] of Object.entries(filter.optionTypes ?? {})) {
    const current = base[key] ?? definition.default;
    if (definition.type === BOOL) {
      cases.push({ label: `${key}=false`, patch: { [key]: false } });
      cases.push({ label: `${key}=true`, patch: { [key]: true } });
    } else if (definition.type === ENUM) {
      for (const value of enumValues(definition)) {
        if (value !== current)
          cases.push({ label: `${key}=${String(value)}`, patch: { [key]: value } });
      }
    } else if (definition.type === RANGE && "range" in definition) {
      const [minimum, maximum] = definition.range;
      if (minimum !== undefined && minimum !== current) {
        cases.push({ label: `${key}=min`, patch: { [key]: minimum } });
      }
      if (maximum !== undefined && maximum !== current) {
        cases.push({ label: `${key}=max`, patch: { [key]: maximum } });
      }
    }
  }

  return cases;
};

const combinedOptionProfiles = (filter: FilterDefinition): Case[] => {
  const minimum: Record<string, unknown> = {};
  const maximum: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(filter.optionTypes ?? {})) {
    if (definition.type === BOOL) {
      minimum[key] = false;
      maximum[key] = true;
    } else if (definition.type === ENUM) {
      const values = enumValues(definition);
      if (values.length > 0) {
        minimum[key] = values[0];
        maximum[key] = values.at(-1);
      }
    } else if (definition.type === RANGE && "range" in definition) {
      minimum[key] = definition.range[0];
      maximum[key] = definition.range[1];
    }
  }
  return [
    { label: "combined minimum/first/disabled profile", patch: minimum },
    { label: "combined maximum/last/enabled profile", patch: maximum },
  ];
};

const hardSkip = new Set(["Glitch", "Program"]);

// These algorithms use scalar controls to size lookup structures, so their
// persisted representation requires the existing migration layer to restore
// defaults before dispatch rather than accepting a sparse object directly.
const requiresMigratedScalarDefaults = new Set(["Contour Map", "Palette Mapper"]);

const requiresMigratedEnumDefaults = new Set(["Anaglyph:depthSource", "Convolve:kernel"]);

describe("CPU filter option conformance", () => {
  for (const [name, filter] of Object.entries(filterIndex)) {
    if (filter.requiresGL || hardSkip.has(name)) continue;

    it(`${name} accepts every declared enum, bool, and range boundary`, async () => {
      const base = { ...(filter.options ?? filter.defaults ?? {}) };
      const previous = new Uint8ClampedArray(8 * 8 * 4).fill(127);
      for (const testCase of optionCases(filter)) {
        const input = makeSignalCanvas();
        const options = {
          ...base,
          ...testCase.patch,
          _frameIndex: 1,
          _isAnimating: true,
          _linearize: false,
          _wasmAcceleration: false,
          _prevInput: previous,
          _prevOutput: previous,
          _ema: new Float32Array(previous),
        };
        const result = await filter.func(input, options, vi.fn());

        expect(result, `${name}: ${testCase.label}`).toBeInstanceOf(HTMLCanvasElement);
        expect(result.width, `${name}: ${testCase.label} width`).toBeGreaterThan(0);
        expect(result.height, `${name}: ${testCase.label} height`).toBeGreaterThan(0);
      }

      // Single-control boundaries catch local parsing bugs; these pairwise
      // endpoint profiles catch cross-option contracts (for example flash +
      // frame capture, temporal mode + scan order, or preserve-alpha + an
      // alternate palette strategy) without an exponential Cartesian suite.
      for (const [profileIndex, testCase] of combinedOptionProfiles(filter).entries()) {
        const input = makeSignalCanvas(profileIndex === 0 ? "primary-gradient" : "edge");
        const hasHistory = profileIndex === 1;
        const result = await filter.func(
          input,
          {
            ...base,
            ...testCase.patch,
            _frameIndex: profileIndex + 7,
            _isAnimating: hasHistory,
            _linearize: profileIndex === 0,
            _wasmAcceleration: false,
            _prevInput: hasHistory ? previous : null,
            _prevOutput: hasHistory ? previous : null,
            _ema: hasHistory ? new Float32Array(previous) : null,
          },
          vi.fn(),
        );

        expect(result, `${name}: ${testCase.label}`).toBeInstanceOf(HTMLCanvasElement);
        expect(result.width, `${name}: ${testCase.label} width`).toBeGreaterThan(0);
        expect(result.height, `${name}: ${testCase.label} height`).toBeGreaterThan(0);
      }

      // Old share URLs and saved chains can legitimately omit controls added
      // by a newer filter version. A partial option object must remain a safe
      // input contract instead of producing a throw or zero-sized canvas.
      const partialOptions = { ...base };
      if (!requiresMigratedScalarDefaults.has(name)) {
        for (const [key, definition] of Object.entries(filter.optionTypes ?? {})) {
          if (definition.type === RANGE || definition.type === BOOL) delete partialOptions[key];
        }
      }
      const partialResult = await filter.func(
        makeSignalCanvas("primary-gradient"),
        {
          ...partialOptions,
          _frameIndex: 3,
          _isAnimating: false,
          _linearize: false,
          _wasmAcceleration: false,
          _prevInput: previous,
          _prevOutput: previous,
          _ema: new Float32Array(previous),
        },
        vi.fn(),
      );
      expect(partialResult, `${name}: partial serialized options`).toBeInstanceOf(
        HTMLCanvasElement,
      );
      expect(partialResult.width, `${name}: partial serialized options width`).toBeGreaterThan(0);
      expect(partialResult.height, `${name}: partial serialized options height`).toBeGreaterThan(0);

      for (const [key, definition] of Object.entries(filter.optionTypes ?? {})) {
        if (definition.type !== ENUM || requiresMigratedEnumDefaults.has(`${name}:${key}`))
          continue;
        const partialEnumOptions = { ...base };
        delete partialEnumOptions[key];
        const partialEnumResult = await filter.func(
          makeSignalCanvas("edge"),
          {
            ...partialEnumOptions,
            _frameIndex: 4,
            _isAnimating: false,
            _linearize: false,
            _wasmAcceleration: false,
            _prevInput: previous,
            _prevOutput: previous,
            _ema: new Float32Array(previous),
          },
          vi.fn(),
        );
        expect(partialEnumResult, `${name}: missing enum ${key}`).toBeInstanceOf(HTMLCanvasElement);
        expect(partialEnumResult.width, `${name}: missing enum ${key} width`).toBeGreaterThan(0);
        expect(partialEnumResult.height, `${name}: missing enum ${key} height`).toBeGreaterThan(0);
      }

      const contextlessInput = makeSignalCanvas("edge");
      contextlessInput.getContext = (() => null) as typeof contextlessInput.getContext;
      const contextlessResult = await filter.func(
        contextlessInput,
        {
          ...base,
          _frameIndex: 0,
          _isAnimating: false,
          _linearize: false,
          _wasmAcceleration: false,
          _prevInput: null,
          _prevOutput: null,
          _ema: null,
        },
        vi.fn(),
      );
      expect(contextlessResult, `${name}: unavailable 2D context`).toBeInstanceOf(
        HTMLCanvasElement,
      );
      expect(contextlessResult.width, `${name}: unavailable 2D context width`).toBeGreaterThan(0);
      expect(contextlessResult.height, `${name}: unavailable 2D context height`).toBeGreaterThan(0);

      const tinyResult = await filter.func(
        makeSignalCanvas("impulse", 1, 1),
        {
          ...base,
          _frameIndex: 0,
          _isAnimating: false,
          _linearize: false,
          _wasmAcceleration: false,
          _prevInput: new Uint8ClampedArray([0, 0, 0, 255]),
          _prevOutput: new Uint8ClampedArray([0, 0, 0, 255]),
          _ema: new Float32Array([0, 0, 0, 255]),
        },
        vi.fn(),
      );
      expect(tinyResult, `${name}: 1x1 media`).toBeInstanceOf(HTMLCanvasElement);
      expect(tinyResult.width, `${name}: 1x1 media width`).toBeGreaterThan(0);
      expect(tinyResult.height, `${name}: 1x1 media height`).toBeGreaterThan(0);

      for (const signal of ["black", "white", "impulse", "alpha", "primary-gradient"] as const) {
        const result = await filter.func(
          makeSignalCanvas(signal),
          {
            ...base,
            _frameIndex: 0,
            _isAnimating: false,
            _linearize: true,
            _wasmAcceleration: false,
            _prevInput: null,
            _prevOutput: null,
            _ema: null,
          },
          vi.fn(),
        );

        expect(result, `${name}: ${signal} signal`).toBeInstanceOf(HTMLCanvasElement);
        expect(result.width, `${name}: ${signal} width`).toBeGreaterThan(0);
        expect(result.height, `${name}: ${signal} height`).toBeGreaterThan(0);
      }
    }, 20_000);
  }
});
