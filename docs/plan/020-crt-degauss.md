# 020 - CRT degauss filter

## Goal

Extract the existing degauss behavior from `CRT emulation` into a standalone chainable filter so it can be used anywhere in the pipeline and combined with presets.

## Why

- The effect already exists and feels good, but it is trapped behind the CRT emulation action button.
- A dedicated filter makes degauss composable with other temporal and display filters.
- Presets can reference the filter even though the pulse itself is still user-triggered.

## Scope

- Add a new `CRT Degauss` main-thread filter with:
  - a `Degauss` action that runs a short burst
  - optional continuous preview via `Play / Stop`
  - controls for intensity, warp, misconvergence, hue shimmer, flash, duration, and animation speed
- Reuse the visual language of the existing CRT degauss effect:
  - raster warp
  - channel mislanding
  - rainbow hue skew
  - brightness pulse
- Register the filter in `src/filters/index.ts`
- Add at least one preset that showcases it with CRT-style companions
- Add focused tests for:
  - burst action wiring
  - rest state is effectively passthrough
  - animated state visibly changes the frame

## Non-goals

- Removing the existing degauss button from `CRT emulation`
- Perfect physical simulation of a real degauss coil
- Sharing a single implementation with `rgbstripe.ts` if that would make the extraction harder to maintain

## Notes

- The standalone filter should be a no-op when idle so it behaves well inside saved chains.
- `CRT emulation` keeps its current embedded degauss behavior for backwards compatibility.
