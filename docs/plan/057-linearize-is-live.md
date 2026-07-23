# 057 — Is the gamma-correct pipeline actually on?

Plan [002](002-gamma-correct-pipeline.md) argued that sRGB maths is biased dark —
`avg(0, 255)` is 128 where the perceptual midpoint is 188 — and wired
`_linearize` into 13 filters covering its whole CRITICAL/HIGH list.

Nothing checked the flag had any effect. `gl-smoke` renders every filter with
`_linearize: true`, but only asserts alpha and peak luma, so a filter that
accepts the option and ignores it is indistinguishable from one that honours it.

## Result

12 of 13 honour it. Changed pixels out of 1024, `_linearize` off vs on:

| filter | changed | filter | changed |
|---|---:|---|---:|
| Binarize | 864 | Levels | 1024 |
| Brightness/Contrast | 864 | N-Candidate | 248 |
| Convolve | 1024 | Ordered | 512 |
| Floyd-Steinberg | 840 | Pixelate | 1024 |
| Grayscale | 1024 | Quantize | 1024 |
| **Halftone** | **0** | Random | 879 |
| | | Riemersma | 636 |

`runLinearizeIsLive` in `src/gl-smoke/contracts/core.ts` keeps this honest.

## The one gap: Halftone

Halftone reads `_linearize` in its JS path — it averages each cell's block in
linear space and delinearises to draw, which is precisely plan 002's argument.
But `renderHalftoneGL()` takes **no linearize argument**. With WebGL2 available —
the normal case — the toggle silently does nothing, and the filter renders
differently depending on whether WebGL2 exists. Plan 002 lists Halftone as
CRITICAL.

**Left unfixed on purpose.** It isn't a missing uniform. The JS path averages a
block; the GL shader point-samples the cell centre (`texture(u_source, cellUV)`),
so there is no averaging for linearisation to correct. Making it gamma-correct
means deciding what that means in GL — dot area proportional to linear intensity,
presumably — which changes the look and still leaves the backends structurally
different. That's a design call, not a defect to guess at in a shader.

Pinned via `knownDead` in the sweep, which asserts it is *still* dead: fixing it
trips the check and prompts removing the pin, rather than leaving a stale
exclusion that quietly shrinks coverage.

## Four false positives, and why they matter

The first run reported five dead filters. Four were the test, not the code —
worth recording, because anyone extending this sweep will hit the same walls:

1. **Identity defaults.** Brightness/Contrast defaults to brightness 0 /
   contrast 0 / gamma 1; Levels to 0..255 / gamma 1. An identity transform is
   unaffected by the space it runs in, so testing at defaults measures nothing.
   Both need non-identity options.
2. **Pixelate only linearises its palette pass**, and its default palette is
   levels 256 — identity — so the pass is skipped entirely. Needs a real palette.
3. **The fixture kept answering the wrong question.** `makeGradientCanvas` is
   flat bands plus a 245/10 checker: convolutions are identity on flat regions
   and clamp at the extremes in *both* spaces. A linear ramp is worse — a sharpen
   kernel is a discrete Laplacian, exactly zero on a linear gradient. A smooth
   low-frequency sinusoid is worse again for the default kernel (which is
   `GAUSSIAN_3X3`, not Sharpen — that's just the ENUM's first listed option): a
   3×3 blur barely moves a 32px wave, so the spaces agree below 1 LSB. And a
   70/185 checker made contrast saturate both ends identically. What works is
   high-frequency detail in a *narrow* mid band (110/150): wide enough that a 3×3
   kernel's averaging differs measurably between spaces, narrow enough that tone
   adjustments don't hit the clamps.
4. **Wrong filter entirely.** `filterIndex["Sharpen"]` is `sharpen.ts` (an
   unsharp mask), not `convolve.ts` — which registers as `"Convolve"`. Testing
   the wrong module produced a convincing `Sharpen=0` that meant nothing.
   Registry keys are `filter.name`, not the module filename or displayName.

Had the first run been taken at face value it would have filed five bugs, at most
one of them real. When a measurement says something surprising here, suspect the
measurement first.
