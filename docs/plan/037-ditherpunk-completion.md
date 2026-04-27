# 037 - Ditherpunk Completion

## Goal

Cover the remaining practical ideas from Surma's Ditherpunk article in the current filter system, then move the expensive new path to acceleration-only execution.

## Scope

- Add a deterministic white-noise ordered threshold map.
- Add threshold-map polarity controls so Ordered can choose shadow-preserving or classic bright Bayer behavior.
- Add a compact threshold-map preview control for Ordered.
- Add Ditherpunk-oriented Ordered variants and chain presets.
- Add Riemersma dithering as a dedicated Hilbert-curve error-memory filter.
- Implement Riemersma in Rust/WASM and remove the JavaScript dithering fallback after parity testing.

## Notes

- Ordered remains WebGL2-only because threshold-map dithering is gather-parallel and already shader-friendly.
- Riemersma is not fragment-shader friendly because the error memory depends on previous pixels along the Hilbert traversal, so the accelerated path is WASM.
- When WASM is disabled, unavailable, or the palette mode is unsupported, Riemersma returns the input canvas unchanged and logs the backend reason instead of maintaining a slow fallback.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run test -- test/filters/ditherpunk.test.ts`
- `npm run test`
- `npm run build`
- `npm run test:e2e:wasm`
- `npm run report:presets`
- `cargo check` in `src/wasm/rgba2laba`
