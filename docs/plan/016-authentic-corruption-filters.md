# 016 — Authentic Corruption Filters

## Goal
Strengthen authenticity-oriented corruption simulation by:
1. Upgrading `JPEG artifact` from simple block quantization to a codec-like pipeline.
2. Adding four new corruption filters representing real-world failure modes:
   - Bitplane Dropout
   - CRC Stripe Reject
   - Palette Index Drift
   - Metadata Mismatch Decode
3. Adding presets that compose these effects into plausible failure chains.

## Scope
- Rewrite `src/filters/jpegArtifact.ts` with:
  - YCbCr conversion
  - 8x8 DCT/IDCT quantization path
  - 4:4:4 / 4:2:2 / 4:2:0 chroma handling
  - separate luma/chroma quality controls
  - optional ringing/mosquito artifacts
  - optional deblocking
  - temporal hold/keyframe behavior for video corruption
- Add new filter modules in `src/filters/`:
  - `bitplaneDropout.ts`
  - `crcStripeReject.ts`
  - `paletteIndexDrift.ts`
  - `metadataMismatchDecode.ts`
- Register new filters in `src/filters/index.ts`.
- Add chain presets in `src/components/ChainList/presets.ts`.

## Validation
- Typecheck/build via `npm run build`.
- Smoke-check filter registration and preset naming consistency.

## Risks
- DCT path can be CPU-heavy on large frames.
- Temporal corruption modes need `mainThread: true` where prior-frame state is used.
- New controls must remain understandable in existing control UI.
