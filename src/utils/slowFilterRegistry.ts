// Module-level registry of filters that have taken "too long" in the main-
// thread dispatch path. Callers record per-step durations; the random-chain
// picker and screensaver cycler consult `isSlowFilter` so slideshow mode
// can't land on a filter that just hung the UI.
//
// Why a module singleton: the dispatcher, the chain picker, and the
// observability hooks all need to agree on the same set, and there's no
// React state we want tied to this — it's pure runtime drift.
//
// Policy (tunable via the constants below):
//   • BUDGET_MS: soft threshold — exceeding once logs, exceeding twice
//     flags the filter as slow
//   • HARD_MS: one breach is enough — used to catch outright hangs where
//     the first run recovered but was still clearly unusable
//   • Flagged filters are retained for the rest of the session. Callers
//     can reset via clearSlowFilters() for tests.

const SLOW_SOFT_MS = 1500;
const SLOW_HARD_MS = 3500;

const strikes = new Map<string, number>();
const slow = new Set<string>();

export const recordFilterStepMs = (name: string, ms: number): void => {
  if (!name) return;
  if (slow.has(name)) return;
  if (ms >= SLOW_HARD_MS) {
    slow.add(name);
    console.warn(`[slow-filter] flagging ${name} after hard-breach ${Math.round(ms)}ms`);
    return;
  }
  if (ms >= SLOW_SOFT_MS) {
    const next = (strikes.get(name) ?? 0) + 1;
    strikes.set(name, next);
    if (next >= 2) {
      slow.add(name);
      console.warn(`[slow-filter] flagging ${name} after ${next} soft-breaches (last ${Math.round(ms)}ms)`);
    } else {
      console.info(`[slow-filter] soft-breach ${name} ${Math.round(ms)}ms (strike ${next})`);
    }
  }
};

export const isSlowFilter = (name: string | null | undefined): boolean =>
  name != null && slow.has(name);

export const getSlowFilters = (): readonly string[] => Array.from(slow).sort();

export const clearSlowFilters = (): void => {
  strikes.clear();
  slow.clear();
};

// Exported for tests and documentation.
export const SLOW_FILTER_BUDGETS = {
  soft: SLOW_SOFT_MS,
  hard: SLOW_HARD_MS,
} as const;
