# 065 - Warning-free validation

## Goal

Make the repository's release and browser validation complete without emitted
compiler, bundler, or unexpected runtime warnings. Keep intentional npm
notices and test-authored diagnostics out of scope; they are informational,
not warnings from the product or toolchain.

## Inventory

- Rust reports an unused `kw` binding in `error_diffuse_buffer`.
- The packed-library consumer does not inherit the source-tree filter chunk
  groups because its module IDs point at installed `dist/` files, producing a
  1.88 MB application chunk and Vite's large-chunk warning.
- The GL registry gate's synthetic "all scalar options missing" VHS profile
  removes controls that existed in every historical VHS state. That feeds NaN
  uniforms to the float conformance path and intentionally falls back with a
  console warning; the realistic legacy additions receive dedicated
  missing-option coverage instead.
- Playwright 1.59.1 uses Node's deprecated `module.register()` API. The current
  1.61.1 release uses the Node 26-compatible loader API.
- npm's install-script policy reports the direct native `canvas` dependency as
  unreviewed until the project explicitly records whether its build may run.

## Changes

1. Remove the unused Rust binding without changing diffusion behavior.
2. Give the synthetic packed consumer its own explicit 2 MB ceiling. Unlike
   the production source build, it consumes an already-built aggregate package
   graph that cannot be safely re-split at source-module boundaries. Pair the
   Vite warning limit with a post-build byte assertion so regressions fail.
3. Exempt VHS from the unrealistic bulk legacy-scalar profile while preserving
   every scalar min/max profile and individually testing all three controls
   introduced after its original saved-state schema.
4. Upgrade Playwright and explicitly approve the direct `canvas` build script.
5. Re-run Rust, TypeScript, ESLint, unit coverage, packed and production builds,
   the GL browser gate, and `git diff --check`; inspect output for warnings.

## Completion contract

- `npm run check` passes without Rust or Vite warnings.
- `npm run test:gl` passes without unexpected browser console warnings.
- `npm install` and Playwright startup complete without install-script or Node
  deprecation warnings.
- Production and packed-consumer bundles remain explicitly budget-checked.
- No warning is hidden by disabling compiler lints or broadly increasing the
  production chunk warning threshold.

## Result

- Rust's unused binding was removed; all 34 crate tests now compile and pass
  without warnings.
- The packed consumer completes without Vite's generic warning and enforces a
  2,000,000-byte ceiling itself. Its current largest JavaScript artifact is
  1,877,400 bytes. The production application retains its stricter 1,000 kB
  ceiling and currently tops out at approximately 495 kB.
- Playwright 1.61.1 starts without Node 26's `DEP0205` warning. npm records the
  direct `canvas` build approval and a repeated `npm install` is warning-free.
- The GL gate passes 2,436 profiles without the VHS fallback warning. Its three
  realistic legacy VHS cases cover each post-schema numeric control.
- `npm run check` passes without compiler or bundler warnings: 1,809 unit tests,
  TypeScript, ESLint, generation checks, Rust, packed artifacts, and production
  build all pass.
- The refreshed merged coverage gate remains above 80% for all metrics:
  statements 91.40%, branches 80.04%, functions 89.62%, and lines 92.14%.
