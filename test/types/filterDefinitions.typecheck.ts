import { BOOL, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";

const inferredOptionTypes = {
  strength: { type: RANGE, range: [0, 10], step: 1, default: 5 },
  enabled: { type: BOOL, default: true },
};

const inferredDefaults = {
  strength: inferredOptionTypes.strength.default,
  enabled: inferredOptionTypes.enabled.default,
};

const inferredFilter = defineFilter({
  name: "Typecheck Inference",
  func: (input, options = inferredDefaults) => {
    const strength = options.strength;
    const enabled = options.enabled;
    void strength;
    void enabled;
    return input;
  },
  optionTypes: inferredOptionTypes,
  options: inferredDefaults,
  defaults: inferredDefaults,
});

const inferredDefaultsCheck: { strength: number; enabled: boolean } | undefined =
  inferredFilter.defaults;
const inferredOptionsCheck: { strength: number; enabled: boolean } | undefined =
  inferredFilter.options;
void inferredDefaultsCheck;
void inferredOptionsCheck;

type RuntimeOptions = FilterOptionValues & {
  strength?: number;
  _frameIndex?: number;
};

const runtimeOptionTypes = {
  strength: { type: RANGE, range: [0, 10], step: 1, default: 4 },
};

const runtimeDefaults = {
  strength: runtimeOptionTypes.strength.default,
};

const runtimeFilter = defineFilter<RuntimeOptions>({
  name: "Typecheck Runtime",
  func: (input, options = runtimeDefaults) => {
    const strength = Number(options.strength ?? 0);
    const frameIndex = Number(options._frameIndex ?? 0);
    void strength;
    void frameIndex;
    return input;
  },
  optionTypes: runtimeOptionTypes,
  options: runtimeDefaults,
  defaults: runtimeDefaults,
});

const runtimeDefaultsCheck: RuntimeOptions | undefined = runtimeFilter.defaults;
void runtimeDefaultsCheck;
