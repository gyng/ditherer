# 064 - Coverage to 80% with durable tests

## Goal

Raise the merged release coverage gate to at least 80% for statements,
branches, functions, and lines while improving correctness evidence and test
design. Coverage is the measurement, not the implementation target: every new
test must protect an observable behavior, boundary, failure mode, backend
contract, or state transition that could realistically regress.

## Baseline

The 2026-07-21 Vitest baseline covers 1,775 passing tests across 117 files:

| Metric | Unit coverage |
|---|---:|
| Statements | 58.57% |
| Branches | 51.46% |
| Functions | 47.35% |
| Lines | 58.28% |

Merging that unit map with the last complete browser map gives a preliminary
87.48% lines, 86.02% statements, 69.35% functions, and 70.96% branches. Those
browser maps predate the latest UI work, so a fresh instrumented run is
required before treating the merged percentages as authoritative. The rough
gap is approximately 456 function declarations and 1,506 branch outcomes.

The first fresh full browser run established the authoritative merged baseline:

| Metric | Fresh merged baseline |
|---|---:|
| Statements | 88.60% (31,933 / 36,038) |
| Branches | 75.27% (12,552 / 16,674) |
| Functions | 75.46% (3,233 / 4,284) |
| Lines | 90.10% (28,544 / 31,679) |

That reduced the actual gap to 195 functions and 788 branch outcomes.

## Coverage contract

- Raise the merged thresholds in `scripts/merge-coverage.mjs` to 80 for all
  four metrics only when the current maps prove the gate passes.
- Keep all shipped TypeScript under `src/` and
  `packages/ditherer-filters/src/` in the denominator. Existing exclusions are
  limited to browser test harnesses and generated WASM glue.
- Do not add ignore directives or exclude shipped product modules to move the
  percentage. Browser-only test entrypoints may be classified consistently
  with the existing smoke harnesses when they are not part of either shipped
  application bundle.
- Do not assert private helper calls, duplicated option literals, or exact
  registry lists unless that shape is a public contract.
- Prefer small deterministic signals and exact output properties over
  "does not throw" assertions.

## Strategy

1. Generate fresh unit and browser coverage maps and rank files by uncovered
   function/branch counts, weighted by product risk and feasible test layer.
2. Add table-driven unit tests for CPU filter behavior where small buffers can
   prove identity, boundary, temporal, palette, and option-mode contracts.
3. Add focused integration tests for worker/runtime, serialization, backend
   routing, and error recovery where multiple modules form the contract.
4. Extend real-browser suites only for behavior that requires Canvas, WebGL2,
   WASM, media, worker, or React lifecycle semantics.
5. After each tranche, rerun focused tests and unit coverage, then periodically
   rerun the merged gate. Fix product defects revealed by stronger assertions.
6. Finish with a test-quality audit: sample every new table/suite for a
   demonstrated pre-fix or mutation-sensitive failure, remove redundant cases,
   and run the complete release validation.

## Implemented coverage tranches

- The selective-export contract now resolves every advertised lazy filter and
  proves that each loader maps to the canonical implementation and option
  schema. This protects generated loader/registry drift rather than merely
  checking that imports do not throw.
- The real-browser GL gate now covers scalar boundary profiles, legacy states
  missing newer scalar or enum controls, identity and custom palettes in sRGB
  and linearized modes, and the explicit WebGL-disabled CPU path for every
  hybrid filter. Every profile still validates canvas shape, shader failures,
  and GL draws where the effect contract requires one.
- Dialog, collapsible-section, modal import/export, WebMCP badge, backend badge,
  media-query, and chain-preview tests cover focus restoration, keyboard traps,
  responsive state, parsing failures, reactive status changes, and drag
  lifecycle behavior.
- Loop playback and realtime recording tests cover timeline sampling, GIF
  delay assignment, aborts, missing canvases, audio-track cloning, stream
  cleanup, seek/start ordering, timer races, autoplay rejection, and inactive
  recorder guards.
- Offline audio tests cover source/fetch/decode failures, WebKit fallback,
  resampling, empty tracks, Opus capability rejection, stereo/mono bitrates,
  chunk boundaries, mux output, aborts, progress, and encoder cleanup.
- Thumbnail tests cover deferred visibility work, source-keyed cache reuse,
  missing registry entries, filter failures, cancellation, and both timer and
  idle-callback schedulers.
- `src/ncParity.ts` is now classified with the `src/gl-smoke/` harness and
  `src/wasmSmoke.ts` as browser test harness infrastructure rather than shipped
  product code. The N-candidate filter and shader remain protected by their
  pixel-exact browser parity suite and the GL registry gate.

## Final result

The final clean unit run covers 1,808 passing tests across 121 files (with 156
explicitly skipped cases). Merging that map with the clean 31-test browser run
produces:

| Metric | Merged coverage |
|---|---:|
| Statements | 91.56% (32,930 / 35,963) |
| Branches | 80.07% (13,331 / 16,648) |
| Functions | 89.73% (3,839 / 4,278) |
| Lines | 92.32% (29,192 / 31,618) |

The merged thresholds are now 80 for all four metrics.

## Completion evidence

- Fresh unit and instrumented browser stages, followed by
  `npm run coverage:merge`, pass with every merged metric at or above 80% and
  thresholds set to 80.
- `npm audit`, TypeScript, ESLint, Rust tests, package generation, packed
  consumer, production build, WebGL release gate, and relevant browser suites
  pass.
- `git diff --check` passes and no shipped modules or ignore directives were
  excluded to inflate the result.
- The plan records the tested contracts, any correctness bugs found, and the
  final per-metric totals.
