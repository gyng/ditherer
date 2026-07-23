# 090 — GL smoke harness reorganization

**Status:** Complete

## Objective

Turn the monolithic `src/glSmoke.ts` browser release gate into a maintainable
test harness with explicit ownership boundaries, data-driven contract
registration, reusable fixtures, and measurable timing, without reducing its
shader, option-branch, temporal, palette, malformed-state, or numerical
coverage.

## Audit findings

- One 3,921-line entrypoint currently mixes browser boot/reporting, WebGL call
  instrumentation, canvas fixtures, generic filter sweeps, option-profile
  generation, worker checks, and more than 40 domain-specific numerical
  contracts.
- Result types are duplicated between the browser entrypoint and Playwright,
  so producer and consumer can drift without a shared compiler contract.
- `runtimeOptions()` reconstructs an identical canvas and three history arrays
  every time it is called throughout the registry sweep.
- The long tail of numerical checks is imperatively recorded in `main`, making
  grouping, discovery, timing, and ownership difficult to inspect.
- Coverage exclusions name one file instead of classifying the whole browser
  harness, which would incorrectly add extracted test infrastructure to the
  product denominator.
- The result reports GL call counts but not sweep/contract elapsed time, so
  performance regressions are not observable in CI output.

## Design

1. Move the browser entrypoint to `src/gl-smoke/index.ts` and give the harness a
   shared result/check/filter type module consumed by Playwright.
2. Extract deterministic canvas fixtures, pixel metrics, runtime history, and
   generic execution helpers behind narrow modules.
3. Group domain contracts by concern and expose declarative contract records
   (`name`, `mode`, `run`) instead of a single imperative tail.
4. Reuse immutable runtime-history fixtures and verify their checksums after
   the run so the optimization cannot hide accidental filter mutation.
5. Report total, registry-sweep, and numerical-contract elapsed milliseconds;
   retain all existing coverage floors and GL call tracking.
6. Classify all `src/gl-smoke/**` modules as browser test infrastructure in
   both unit and merged coverage configuration.

## Durable contracts

- The reorganized gate discovers the same registry and exercises every prior
  default, linearized, CPU-disabled, enum, scalar-boundary, legacy-state,
  palette, temporal, worker, and numerical check.
- `GlSmokeResult` has one shared definition and includes phase timings.
- Reused history buffers remain byte-for-byte unchanged across the full run.
- A failed check retains its filter name, mode, and actionable reason.
- The Chromium release gate still requires real draws from `requiresGL`
  filters, rejects shader/link failures and black/transparent output, and meets
  the existing GL-filter coverage floors.

## Verification

- [x] focused harness/type tests pass
- [x] lint and project TypeScript checks pass
- [x] real Chromium WebGL2 gate passes with unchanged-or-greater contract and
      registry coverage
- [x] timing data is visible in Playwright output and runtime-history integrity
      is checked
- [x] generated catalog, full unit suite, package build, and app build pass
- [x] final review finds no duplicated result types, stale old entrypoint,
      coverage-denominator leak, temporary artifacts, or lost checks

## Outcome

- Split the 3,921-line working-tree entrypoint into a 469-line orchestrator,
  shared types, fixture and instrumentation modules, generic execution helpers,
  declarative suite registration, and four domain-owned contract modules.
- Replaced per-check runtime-history allocation with a frozen shared fixture and
  replaced repeated gradient painting with dimension-keyed immutable canvases.
  A browser contract checks both fixture families after the full run so hidden
  mutation fails the release gate.
- Added phase and per-suite timings to the shared `GlSmokeResult` contract and
  Playwright output. The final run completed its registry phase in 23,744 ms,
  contract phase in 3,098 ms, and page-side total in 26,858 ms.
- Controlled measurements reduced the registry phase from 40,113 ms with fresh
  canvases to 23,744 ms with paint-once pooled fixtures (about 41%). Compared
  with repainting a pooled canvas for every case (30,494 ms), it is about 22%
  faster.
- The final Chromium gate passed 2,656 checks with 35 intentional skips across
  267 GL filters and 157 GL-required filters. It observed 726 shader compiles,
  363 program links, and 8,921 draws with zero failures.
- Vitest passed 2,009 tests (179 skipped); lint, TypeScript, generated-catalog
  validation, the filter-package build, the application build, and diff
  whitespace validation all passed.
