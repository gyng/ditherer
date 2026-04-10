# Plan 014 — Filter Family Consolidation

**Goal:** Reduce picker clutter by merging clearly overlapping filters into a smaller set of more capable filters, while keeping scanline-style effects chain-friendly as a separate family.

## Families to consolidate

1. **Temporal Exposure**
- absorb `Frame Blend`
- absorb `Shutter Drag`
- keep long-exposure accumulation modes

2. **Scene Separation**
- absorb `Background Subtraction`
- absorb `Background Reconstruction`
- absorb `Cinemagraph`

3. **Motion Analysis**
- absorb `Motion Detect`
- absorb `Frame Difference Highlight`
- absorb `Motion Heatmap`

4. **Scanline**
- keep scanline as its own chainable family
- absorb `Scanline RGB`

## Approach

- Keep one surviving implementation file per family and expand its option surface
- Remove the deprecated siblings from the registry and picker
- Retarget presets to the surviving filters with explicit option overrides
- Keep behavior data-driven through `optionTypes`

## Surviving filters

### 1. `Temporal Exposure`
Likely based on `src/filters/longExposure.ts`

Modes:
- `Blend`
- `Shutter Average`
- `Long Exposure Max`
- `Long Exposure Additive`
- `Running Average`

### 2. `Scene Separation`
Likely based on `src/filters/backgroundSubtraction.ts`

Modes:
- `Foreground`
- `Background`
- `Freeze Still Areas`

### 3. `Motion Analysis`
Likely based on `src/filters/motionDetect.ts`

Detection sources:
- `EMA`
- `Previous Frame`

Visual outputs:
- `Mask`
- `Heatmap`
- `Source`
- `Difference Highlight`
- `Accumulated Heat`

### 4. `Scanline`
Likely based on `src/filters/scanline.ts`

Modes:
- `Darken Lines`
- `RGB Sub-lines`

## Files likely touched

- `docs/plan/014-filter-family-consolidation.md`
- `src/filters/longExposure.ts`
- `src/filters/backgroundSubtraction.ts`
- `src/filters/motionDetect.ts`
- `src/filters/scanline.ts`
- `src/filters/index.ts`
- `src/components/ChainList/index.tsx`
- `test/filters/`
- possibly delete deprecated siblings once registry references are gone

## Acceptance criteria

1. The picker exposes one filter per consolidated family
2. Existing presets are retargeted to the surviving filters
3. Smoke tests still pass
4. Consolidated filters preserve the key visual behaviors of the removed siblings
