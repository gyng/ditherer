# 062 - Production chunk budget

## Goal

Remove Vite's production chunk-size warning by splitting the eagerly loaded
filter engine into bounded, cacheable chunks in both the browser application
and its module worker. Keep the existing boot-time availability contract: all
filters remain ready before the application renders and the worker can still
execute any registered filter without an extra request-time loader path.

## Baseline

`npm run build` succeeds but reports two JavaScript chunks over the configured
1,000 kB warning limit:

- application entry: approximately 1,868 kB minified;
- filter worker: approximately 1,485 kB minified.

The existing vendor groups are already below budget. The oversized chunks come
from the complete 300+ filter registry being intentionally imported by both
entries.

## Implementation

1. Move the production output configuration to Vite 8's Rolldown-native
   `rolldownOptions.output.codeSplitting` API.
2. Preserve the current React, UI, and export dependency groups.
3. Keep shared engine utilities in one dependency chunk and divide only filter
   implementation modules into deterministic alphabetical groups. Keeping the
   registry coordinator outside those groups preserves the initialization
   direction `entry → filters → core` and avoids circular chunk execution.
4. Emit the filter worker as ES modules and apply the same filter-engine chunk
   policy to its graph.
5. Add a post-build assertion that fails if any emitted JavaScript chunk
   exceeds the configured 1,000 kB production budget. This turns the warning
   into a durable build contract rather than a console-only advisory.

## Non-goals

- Do not raise or disable `chunkSizeWarningLimit`.
- Do not convert the application to on-demand filter loading; that changes the
  current boot and first-use behavior and belongs in a separate performance
  project.
- Do not split individual shaders or alter filter execution semantics.

## Verification

- Demonstrate that the bundle-budget assertion fails against the current
  oversized build.
- `npm run build` passes without Vite's chunk-size warning and every emitted
  JavaScript file stays within the asserted budget.
- `npm run typecheck` and `npm run lint -- --quiet` pass.
- Vitest worker/runtime contracts pass.
- Browser worker and application workflow smoke tests pass against the
  production-compatible module graph.
- `git diff --check` passes.

## Result

- The first generic `maxSize` split was rejected during browser verification:
  it separated shared helpers from filter modules across a circular chunk
  boundary, and the production app stopped at boot with `scaleMatrix is not a
  function`. No version of that topology was kept.
- The final topology gives the shared engine a one-way dependency boundary and
  emits four deterministic implementation chunks (`a–f`, `g–m`, `n–s`, and
  `t–z`) for both the application and worker graphs.
- `npm run build` completes without the Vite warning. The largest JavaScript
  chunk is approximately 495 kB; the app entry is approximately 433 kB and the
  worker entry approximately 54 kB.
- The build-time 1,000 kB assertion passes.
- TypeScript, ESLint, 1,775 Vitest tests, 18 focused worker/runtime tests, and
  three production-served Playwright workflows pass. The browser also reached
  the ready application state with no page or request errors.
