# 103 — Alpha and Malformed-State Hardening

## Status

Complete.

## Findings

- Ultrasound derives impedance-proxy luminance from straight RGB, allowing
  transparent or nearly transparent source colour to create visible echoes.
- Mavica auto white balance and JPEG-complexity statistics give low-coverage
  pixels the same influence as opaque pixels.
- Mavica's chroma delay, field synthesis, and JPEG stages mix straight RGB,
  allowing almost-transparent saturated pixels to bleed into opaque neighbours.
- JPEG Artifact silently returns its input unchanged when its required WebGL
  render path cannot initialize, disguising an unavailable backend as success.
- The first alpha hardening pass double-weights delayed red/blue at homogeneous
  partial coverage and returns the internal premultiplied signal as straight
  RGB, distorting hue and applying alpha twice during later compositing.
- Mavica's complete codec is WebGL-only even when its reference camera stages
  previously had a partial JavaScript branch; unsupported direct calls silently
  omitted JPEG, and FRAME jitter used biased GLSL floor rounding.
- JPEG Artifact's GL readout canvas is pooled, but a palette/temporal post-pass
  exception can strand it before ownership transfers to the caller.
- A composed JPEG failure is currently converted to a visible plate too early,
  so Mavica can post-process it and replace its alpha instead of propagating the
  failure unchanged. Failed RGBA32F replacement can also leave a deleted cache
  entry or leak one half of a texture/framebuffer allocation.
- JPEG's six RGBA32F codec targets live outside the shared GL texture pool, so
  the existing runtime/app disposal paths cannot release them.
- Main-realm disposal cannot release GPU resources owned by the filter worker;
  source reset, provider unmount, and removal of the final JPEG/Mavica user need
  to terminate that realm so the browser destroys its WebGL context.
- Generation checks before an async main-thread call do not protect its later
  resolution, allowing direct execution or a worker fallback to emit stale
  output after reset. Empty shared/FFT disposal also calls the creating GL
  accessor, allocating a context solely to discover there is nothing to free.
- Generation-bound main-thread execution still passes the live temporal maps
  into the runtime, so a stale async completion can repopulate previous-output,
  previous-input, and EMA state after reset even though its canvas is dropped.
- Final-generation guards do not stop later filters in an already-running chain,
  and pipeline-affecting chain/global mutations do not all invalidate the active
  generation synchronously. Stale stages can still run side effects and update
  temporal state before the final canvas is discarded.
- The chain cache is keyed only by entry identity/order. Replacing a filter or
  changing its audio modulation can therefore reuse a stale downstream canvas,
  while global source/backend/colour changes can reuse the deepest cached stage
  and skip the whole chain.
- Cache eviction currently returns the displayed output canvas to the pool,
  allowing the next filter to clear or redraw pixels still consumed by the UI
  or exporter. Main-thread step previews also enter the global cache before an
  async chain has completed, so invalidation can pool an in-flight input.
- Cache reuse does not include source-frame revision, allowing paused video
  seek/frame-step updates that redraw the same canvas to reuse an older frame.
- Non-preview runtime, export, grayscale preprocessing, and worker completion
  paths retain superseded canvases after their pixels have been copied.
- A reusable cached prefix can be evicted while an async suffix still consumes
  it, and global chain-audio modulation changes invalidate options without
  scheduling a new static-image render.
- Rejection from input/output snapshots or the step callback can escape the
  direct-main IIFE or async worker fallback, leaving filtering stuck and owned
  preprocessing/transaction canvases unreleased. Export failure likewise needs
  deterministic input cleanup and an explicit session-reset policy.
- Worker result reconstruction and synchronous request preparation can fail
  before their cleanup/commit boundary, while non-retaining standalone runtime
  callbacks can reject after acquiring an intermediate canvas.
- Imported chains can exceed the 16-stage limit, accept malformed labels,
  prototype-inherited filter names, invalid random-cycle values, and unstable
  IDs that break global audio-modulation targets after a round trip.
- Sparse-state merging restores omitted controls, but explicit malformed
  values such as null palettes, invalid enums, string booleans, and non-finite
  ranges still override defaults in the upgraded imaging/display wrappers.

## Contracts

1. Ultrasound impedance luminance is coverage weighted on CPU and WebGL.
2. Mavica global colour and complexity statistics scale source contribution by
   coverage, and its spatial pipeline switches to coverage-weighted RGB before
   the first neighbourhood operation, preventing nearly invisible regions from
   steering or bleeding into immediately adjacent opaque output.
   Delayed chroma uses overlapping source/destination coverage; every downstream
   spatial and post-JPEG stage preserves the premultiplied invariant; and the
   public result is converted once to straight RGB with alpha-zero RGB cleared.
3. LCD Display, Spectrogram, Night Vision, Ultrasound, and Mavica FD7 normalize
   malformed controls to their declared defaults without discarding valid
   overrides or runtime options.
4. Browser paired-source fixtures cover hidden and low-alpha influence, while
   exact malformed-state fixtures cover every available backend. The Mavica
   low-alpha fixtures include the immediate opaque boundary so low-coverage
   colour leakage cannot hide behind a global-statistics-only guard region.
   Alpha-zero hidden RGB is exact; alpha-32 versus alpha-255 chroma influence
   must attenuate in aggregate; and equal-RGB alpha 0/32/255 fixtures require a
   monotonic, bounded coverage response. These independent variables prevent
   coarse JPEG threshold crossings from being mistaken for hidden-colour leaks.
5. A failed JPEG WebGL render returns the standard visible WebGL-unavailable
   plate rather than a silent identity result; a mocked failure-path unit test
   protects the direct filter API as well as callers that compose the helper.
6. Homogeneous alpha 0/32/255 fixtures require cleared transparent RGB, stable
   partial-alpha hue and straight energy, and coverage-proportional composited
   energy on the GL camera path. Centred-jitter unit coverage protects symmetric
   FRAME offsets. Mavica now has one complete WebGL2 path, advertises that real
   requirement, and direct no-GL calls pass through instead of silently dropping
   the codec.
7. A real-path ownership fixture injects failure during Mavica's pre-JPEG
   complexity readback and requires both its work and readout canvases to return
   to the unified pool.
8. JPEG Artifact releases its rendered canvas if post-processing throws before
   ownership transfers; an injected readback failure verifies release and reuse.
9. Composed callers receive a nullable JPEG attempt result while the public
   filter maps null to the standard visible plate. Mavica propagates codec
   failure without running its post/alpha pass. JPEG float targets replace their
   cache transactionally, clean partial allocations, and retry with fresh handles.
10. Shared runtime and app processing resets delete and cache-clear all JPEG
    RGBA32F targets. Disposal is idempotent, and the next render allocates fresh
    handles rather than returning deleted resources.
11. App resets and unmounts dispose both processing realms. When the last
    enabled JPEG Artifact/Mavica entry leaves a chain, main JPEG targets are
    released and the worker is terminated; a surviving codec user prevents an
    unnecessary restart. Stale worker completions cannot commit after disposal.
12. Every awaited main-thread chain execution rechecks processing generation
    before emission, including worker fallback. Shared, FFT, and JPEG disposal
    use a non-creating context probe, so aggregate cleanup is side-effect free
    before the first GL render.
13. Generation-bound main-thread and fallback runs deep-clone their temporal
    maps and commit the isolated copies only after a current-generation await.
    Export sessions retain their explicit in-place temporal-state semantics.
14. The runtime accepts a cooperative abort predicate, checks it before every
    step and after every awaited filter, releases a newly produced stale canvas,
    and skips temporal writes, callbacks, later stages, and frame advance.
    FilterContext invalidates synchronously before every pipeline mutation and
    passes its generation predicate into main-thread execution. Mutation only
    terminates a worker when a request is actually in flight, retaining an idle
    warm worker; media reset, unmount, and final-codec removal still force realm
    disposal for resource lifetime.
15. Stage-local semantic edits evict the edited entry and every downstream
    dependency through one shared chain-index helper. Global source, colour,
    scale, and backend changes synchronously clear the complete step cache, and
    structural chain mutations cannot retain a deepest cache that was produced
    from different upstream semantics.
16. Displayed canvases are deferred rather than pooled until output identity
    advances. Main-thread previews stage in a run-local transaction and commit
    atomically only after the complete generation succeeds; stale transactions
    release unique owned canvases without touching caller input.
17. Cache identity includes source canvas identity and input frame token, so a
    same-canvas video revision reruns every stage. Realtime scheduling observes
    WebGL-backend and scaling-algorithm changes.
18. The public runtime retains step canvases by default; internal non-preview
    execution explicitly opts into ephemeral steps and releases superseded
    intermediates. Grayscale preprocessing is created only when no cached suffix
    is reusable and is explicitly retired, export sessions retire consumed
    outputs, and worker requests release their grayscale replacement and final
    canvas after copying result buffers.
19. Cached starting prefixes are reference-count pinned through direct and
    worker/fallback completion; eviction quarantines pinned canvases until the
    last consumer settles. Chain-audio modulation set/clear invalidates and
    schedules static realtime processing, while screensaver-only changes do not.
20. Main-thread ownership transactions discard staged outputs before rethrowing.
    Direct and fallback callers contain rejection, retire preprocessing, unpin,
    and reset current-generation scheduling state without an unhandled promise.
    Export uses a finally-owned input set and deletes partial temporal sessions
    on failure so the same session ID can restart cleanly.
21. Imported chains and duplicate actions enforce the same 16-stage boundary
    as direct additions. Unknown serialized filters do not consume capacity,
    and a non-empty import still selects its first recognized entry.
22. Share-state guards reject null and primitive roots, v2 imports skip malformed
    entries, and malformed or omitted persisted booleans preserve live values.
    Removing a stage before the active one keeps the same logical filter active;
    removing the active or last stage clamps selection to a surviving neighbor.
23. Worker request preparation and result reconstruction stage all canvases,
    temporal maps, previews, and timing data privately, then publish atomically;
    synchronous setup or reconstruction failure rolls back before fallback.
24. Standalone runtime rejection releases ephemeral intermediates when option
    resolution, snapshots, or callbacks fail, while public step canvases remain
    retained by default and explicit non-preview calls opt into ephemerality.
25. Imported/duplicated chains enforce 16 stages, own-property filter lookup,
    bounded string labels and IDs, finite positive cycle timing, and safe
    selection semantics for removal and malformed state.
26. Optional stable v2 entry IDs preserve ID-qualified global audio targets;
    compact v1 is used only for an enabled, unmodulated single entry so v2-only
    entry/global audio and disabled state cannot be silently discarded.

## Verification

- `npx tsc --noEmit`
- Focused ESLint over the option normalizer, five wrappers, and imaging smoke
  contracts
- Focused JPEG/Mavica failure and resource tests plus the legacy-quality,
  shared runtime/app/worker lifecycle tests, FilterContext integration,
  async-generation, non-creating disposal, canvas-pool, option-conformance,
  runtime-abort, transactional cache ownership, source-revision, worker/export
  pooling, cached-prefix pinning, audio-modulation scheduling, and registry
  suites (334 tests)
- `npx vitest run test/filters/filterOptionConformance.test.ts test/filters/filterRegistry.test.ts test/gl/glSmokeHarness.test.ts` (152 tests)
- Targeted real-Chromium `runLowAlphaStatisticsIsolation` contract (exact hidden
  RGB plus aggregate and homogeneous alpha 0/32/255 checks)
- Targeted real-Chromium `runCanvasOwnershipReuse` contract, including injected
  pre-JPEG readback failure after both Mavica canvases are acquired
- Complete exact-tree release check: 2,193 Vitest tests passed (180 skipped),
  34 Rust tests passed, and lint, TypeScript, packed-package validation,
  selective-consumer build, library build/import smoke, and application builds
  passed.
- Real-Chromium library consumer: 1/1 import-and-render contract passed.
- Complete real-Chromium WebGL registry: 2,706 passed, 35 skipped, 267 GL
  filters, 158 required-GL filters, 732 shader compiles, 366 links, and 9,618
  draws.
