# 022 - CRT degauss auto trigger

## Goal

Let `CRT Degauss` react to the source image instead of only relying on the manual button.

## Approach

- Add explicit trigger modes so the filter does not interpret any animation as an active degauss pulse.
- Support source-driven triggering from temporal pipeline inputs:
  - motion energy from `_prevInput`
  - scene-cut / luminance jump energy from `_ema`
- Add cooldown control so live video does not retrigger every frame.
- Keep the existing manual `Degauss` button and `Play / Stop` preview.

## Notes

- `_isAnimating` is also true while video is playing, so the filter must track its own burst lifecycle.
- Auto-triggering should be lightweight and use sampled motion metrics rather than full optical flow.
