export type CheckResult = { ok: true } | { ok: false; reason: string };

export type FilterLike = {
  func: (input: unknown, options: unknown) => unknown;
  defaults?: Record<string, unknown>;
  optionTypes?: Record<string, {
    type?: string;
    options?: { value: unknown }[];
    range?: [number, number];
  }>;
  requiresGL?: boolean;
  temporal?: boolean;
};

export type Contract = {
  name: string;
  mode: string;
  run: () => CheckResult | Promise<CheckResult>;
};

export type GlSmokeFailure = {
  name: string;
  mode: string;
  reason: string;
};

export type GlSmokeTimings = {
  totalMs: number;
  registryMs: number;
  contractsMs: number;
  suitesMs: Record<string, number>;
};

export type GlSmokeResult = {
  status: "ok" | "failed";
  passed: number;
  failed: number;
  skipped: number;
  glFilters: number;
  requiredGLFilters: number;
  shaderCompiles: number;
  programLinks: number;
  shaderFailures: number;
  drawCalls: number;
  timings: GlSmokeTimings;
  failures: GlSmokeFailure[];
};
