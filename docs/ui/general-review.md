# General app review and release readiness

## Review scope

Inspect the UI changes and app boundaries for correctness, resilience,
accessibility and avoidable performance issues. Fix reproduced issues with the
smallest appropriate regression tests. The engine and its shader algorithms
are unchanged; do not expand this into a speculative algorithm rewrite.

## Concrete review queue

1. JSON export must not claim clipboard success after denial/unavailability.
2. Modal Copy must handle rejection and give useful recovery feedback.
3. Zero-time cached frames must not report Infinity fps.
4. Current source labels must distinguish loaded media from attempted failures.
5. CI/Pages/publication must use a supported Node LTS runtime, with local
   verification against that runtime and the complete repository gates.
6. Review the final diff, check release policy and remote state, then commit with
   plan 121 referenced and push. Follow the exact commit through CI and Pages.

The user explicitly requested commit/push once the goal and queued work are
complete. Pages deploys after successful master-push CI. Filter publication
requires a filters-v* tag or manual version dispatch; no filter package release
is warranted solely by app UI/tooling changes.

## Implemented findings

Clipboard denial now preserves immediate JSON access without claiming success;
modal Copy catches failure and explains manual recovery. Cached/invalid frame
durations render an unavailable FPS marker rather than Infinity. Media labels
and share URLs update after successful loading; a browser regression verifies
that failed replacement preserves the previous filename, canvas pixels and URL.
Empty source metadata reports no input. CI, Pages and publication workflows use
Node 24 LTS, with `.nvmrc` matching. Vite chunk groups supply their debug name.

The complete repository check passed under isolated Node 24.21.0: integrity,
generated registries, format, lint, typecheck, 34 Rust tests, 2,420 Vitest tests,
unit coverage, packed consumers and production build/bundle budgets. No engine
source or shaders changed. Production dependency audit reports zero issues.
The upstream CSS-composition PostCSS warning remains; production fonts and
controls render correctly. Final browser coverage and remote CI/Pages checks
are recorded below when complete.

## Final local verification

All 43 real-browser release tasks have passing results: 41 passed in the full
instrumented run; two long UX tasks exceeded their original 30-second total
limit and passed on instrumented rerun (20.3s/27.9s). Coverage-only UX timeout
is now 60 seconds. No assertions were weakened. New pointer access and failed
source-replacement coverage also pass. The merger now requires and merges all
ten accessibility task artifacts, plus source-replacement regression coverage.

Merged coverage gate passes: lines 96.03%, statements 94.82%, functions 90.51%,
branches 83.04% (all floors 80%). GL validated 270 filters, 750 compiles and
12,344 draws; WASM and export artifacts pass. Final `08-*` main captures report
no runtime errors or page overflow at all four viewports; export, compact
compose and corrected command captures were visually inspected. Dependency
audit including development packages reports zero vulnerabilities. The native
LightningCSS crash also reproduces under Node 24; esbuild stays as CSS backend
(later traced to a corrupted local binary; see plan 123).

The implementation and queued design-system/general reviews are complete.
Remote head was checked against the unchanged starting commit before push.
Pages is the app release mechanism at https://gyng.github.io/ditherer/.
No filter version/tag is added because its package source is unchanged.
Follow the resulting commit's CI and Pages deployment before marking the
user's goal complete.
