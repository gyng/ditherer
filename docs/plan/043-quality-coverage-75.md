# 043 - Quality coverage to 75%

## Goal

Raise enforced project coverage to at least 75% without padding the suite with
implementation snapshots or superficial render assertions. Coverage from unit,
integration, and real-browser shader tests should reflect the layer where the
behavior actually runs.

## Baseline

Vitest currently reports 54.59% lines, 55.11% statements, 45.96% functions,
and 35.63% branches. The configured gates are only 53/54/44/34. Browser-only
GL execution is validated separately but is not represented in the aggregate.

## Plan

1. Make browser coverage measurable and mergeable so real WebGL and application
   integration execution count instead of being hidden behind exclusions.
2. Add behavior-focused unit tests for high-risk pure and orchestration seams:
   worker lifecycle/error handling, export routing/finalization, reducer and URL
   state, temporal state, and representative CPU algorithms.
3. Remove or justify skips and exclusions according to the testing pyramid;
   browser-only code belongs to Playwright, deterministic logic belongs to
   Vitest, and duplicate smoke assertions do not substitute for either.
4. Raise all enforced coverage thresholds toward 75 as evidence lands, with a
   final gate of at least 75% for lines, statements, functions, and branches.
5. Run lint, typecheck, the full unit suite, real-browser suites, production
   build, and the merged coverage gate before declaring completion.

## Test design rules

- Assert observable behavior and failure recovery, not source structure.
- Use deterministic fixtures that exercise meaningful state transitions.
- Prefer one focused decision-table test over many near-identical examples.
- Keep real codecs, workers, WebGL, and media timing in browser integration;
  mock only external boundaries in unit tests.
- Every exclusion must name the browser or generated-data suite that owns it.

## Result

- Source-location-aware merging combines Vitest and Chromium execution without
  double-counting transform-specific Istanbul IDs. Browser-only WebGL, WASM,
  media, worker, export, and application integration paths remain in scope.
- The enforced merged floor is now 75% for statements, branches, functions,
  and lines. Final synchronized coverage is 89.83% statements, 75.09%
  branches, 86.51% functions, and 90.68% lines.
- Added decision-focused tests cover shader output contracts, temporal/export
  orchestration, draggable window boundaries, audio permission and tempo state,
  patch-cable interaction, filter option conformance, reducer recovery, worker
  failures, WebMCP contracts, and representative image-processing algorithms.
- Final validation passes lint, TypeScript, 1,355 unit/integration tests, 25
  Chromium workflows, the 830-mode WebGL shader gate, and the production build.
