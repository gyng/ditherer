# 104 — GL allocation failure hardening

## Status

Complete.

## Objective

Make shared texture/framebuffer caches and shader/program construction
transactional when WebGL allocation, compilation, or linking fails, so retries
cannot leak partial handles or publish deleted resources.

## Findings

- Shared RGBA8/RGBA16F and FFT RGBA32F allocators delete resized cache handles
  before invalidating the cache entry and do not clean half-created replacement
  pairs. A failed framebuffer allocation can leak its texture, while a later
  request for the old dimensions can reuse deleted handles.
- Program construction can leak a compiled vertex shader when fragment
  compilation fails, both shaders when program creation fails, and the failed
  program when linking fails.
- FFT cache initialization links four programs in sequence. Failure after the
  first link leaves every earlier program unreachable because the composite
  cache is never published.
- Shared fullscreen-quad initialization can orphan its VAO and vertex buffer
  when buffer allocation or any binding/upload/attribute setup step fails.

## Implementation

1. Invalidate old cache entries before disposal and stage replacement texture
   and framebuffer handles privately until both exist and initialization
   completes.
2. Delete every partially created handle on allocation/setup failure, leaving
   no published cache entry so the next call retries from a clean state.
3. Scope shader and program construction with explicit ownership transfer and
   cleanup for compile, create-program, attach, and link failures.
4. Build the FFT program bundle transactionally and delete every earlier
   program if any later link fails.
5. Stage the shared quad VAO and vertex buffer together, deleting both if any
   setup step fails before the VAO is cached.
6. Add failure-injection tests for every partial-allocation, setup,
   compile/link, uniform-lookup, and composite-program branch, then repeat the
   GL lifecycle audit and complete release gates.

## Acceptance

- Failed allocation or resize leaves no stale cached entry or leaked partial
  texture/framebuffer.
- Every failed shader/program construction deletes all handles it created.
- A failed FFT composite initialization deletes every program linked earlier
  in the same attempt and retries from an empty cache.
- Failed quad setup never publishes a partial VAO and cleans both allocated
  handles before a retry.
- Focused tests, lint, TypeScript, complete unit coverage, and the full real
  Chromium WebGL registry gate pass.

## Verification

- `npx vitest run test/gl/resourceAllocationFailure.test.ts
test/filters/jpegArtifactGLResources.test.ts
test/gl/resourceDisposalNoContext.test.ts` — 54 tests passed.
- `npm run check` — 2,193 Vitest tests passed, 180 skipped; 34 Rust tests,
  generation, lint, TypeScript, package validation, packed/library/app builds,
  and the production chunk budget passed.
- `npm run typecheck` — passed.
- `npm run lint` and focused ESLint for the touched GL/test files — passed.
- `git diff --check` — passed.
- Real-Chromium library consumer contract — 1 passed.
- Complete Chromium WebGL registry — 2,706 passed, 35 skipped, 267 GL filters,
  158 required-GL filters, 732 shader compiles, 366 links, and 9,618 draws.
- Final repeated GL/FFT ownership review — no remaining findings in scope.
