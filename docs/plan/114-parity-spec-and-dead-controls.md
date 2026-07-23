# 114 — Anaglyph Spec, Halftone Parity, Convolve Edge, Dead Control

Status: Complete

## Objective

Fix four verified correctness issues from four fresh survey angles
(spec-accuracy, GL↔CPU parity, dead-control; normalization came back clean).

## Evidence

1. **Anaglyph — Dubois matrix applied transposed + a sign flip** (spec-grade).
   `anaglyph.ts` GL shader :151-153 and `captureSamplingQualityContracts.ts`
   `duboisRedCyanLinear` :28-33 both cite the "Dubois least-squares projection"
   (Sanders & McAllister) but apply the LEFT matrix transposed — `0.500484`
   (correct `[R,lg]`) is misplaced to `[G,lr]`, `0.176381` (`[R,lb]`) to `[B,lr]`
   — so the left eye leaks ~0.5 into green and ~0.18 into blue (severe ghosting).
   The right matrix `[G,rr]` term is also sign-flipped (`−0.378476` should be
   `+`). No test locks the coefficients.
2. **Halftone — GL/CPU cell-sampling divergence** (material parity). CPU averages
   every pixel in the grid cell (`halftone.ts:101-109`/`:155-163`); GL
   point-samples only the cell CENTRE (`halftoneGL.ts:39-44`). Dot sizes/colours
   differ visibly on detailed images when `_webglAcceleration` toggles. BONUS:
   the exposed `levels` option is dead in both paths — line 58 reads
   `palette.options.levels`, never `options.levels`.
3. **Convolve — one-sided CPU edge clamp** (minor parity). The non-separable CPU
   path clamps only the low edge (`convolve.ts:350`/`:376`), so right/bottom rows
   overflow-wrap into a 1-2px seam; GL clamps both sides (`convolveGL.ts:53-54`).
4. **program.ts — dead `mode` control**. Single-value enum (`program.ts:10-15`),
   never read (`programFilter` destructures only `{program, palette}`).

## Implementation

1. **Anaglyph**: correct the Dubois matrix in BOTH paths (per the survey's
   verified matrix, matching Dolphin/three.js); add a unit test locking the
   correct coefficients for a known input; keep CPU↔GL parity. Add a GL-smoke
   contract asserting a pure-left-eye input does not leak into the cyan channels.
2. **Halftone**: GL must average the full cell (match CPU), not point-sample the
   centre; wire the exposed `levels` option so it actually controls dot-size
   quantization in both paths (preserving palette behaviour); add a GL↔CPU cell
   parity contract on a detailed fixture and a unit test that `levels` changes
   output.
3. **Convolve**: add the two-sided `Math.min(W-1, …)`/`Math.min(H-1, …)` clamp to
   the non-separable CPU path; unit test that right/bottom edges replicate (no
   wrap) and match GL.
4. **program.ts**: remove the dead `mode` option from `optionTypes`/`defaults`
   (and the unused `ALL` export if nothing else consumes it); regenerate the
   catalog. (An ALL/whole-buffer scope is left as possible future work, not
   invented here.)
5. Full gate (typecheck, lint, generate:check, unit, test:e2e:gl, build) +
   adversarial hardening until no new findings.

## Outcome

- **Anaglyph**: corrected the Dubois red/cyan matrix (was transposed on the left
  block + one sign flip) in both the JS reference (`duboisRedCyanLinear`) and the
  GL shader, byte-identical, linear-in/linear-out. Added a coefficient-locking
  test; also corrected `legacyFilterQualityPass.test.ts`, which had been pinning
  the transposed values. Hardening confirmed all 18 coefficients and operand
  mapping exact.
- **Halftone**: GL now block-averages each cell (striding across the full,
  in-bounds cell with a 32-sample cap — no top-left bias for large grids, no
  edge replication) to match the CPU; the dead `levels` control is wired via
  `effectiveLevels = isNearest && rawLevels>1 ? rawLevels : 256`, applied
  identically to both backends (slider live and in-agreement for the nearest
  palette, consistently inert for custom palettes). A first hardening pass caught
  three divergences from an initial over-eager fix (large-cell truncation,
  custom-palette `levels` disagreement, edge replication); all three were fixed
  and re-reviewed clean (div-by-zero impossible, GLSL loop statically bounded).
- **Convolve**: non-separable CPU path now clamps both edges (was low-edge only →
  right/bottom wrap seam), matching GL clamp-to-edge.
- **program.ts**: removed the dead single-value `mode` enum (+ unused
  `ALL`/`PIXEL`/`ENUM`); catalog regenerated.
- **Tests**: 4 new unit tests + updated 2; 4 new GL-smoke contracts under a new
  `parity-and-spec` suite (Anaglyph no-left-leak, Halftone cell-average parity,
  Halftone large-cell full-mean, Convolve edge-clamp parity). Full gate green:
  typecheck, lint, catalog, 2312 unit, 2747 GL-smoke, build. Four adversarial
  hardening reviews (Anaglyph, Halftone, Convolve+program, Halftone re-review).
- **Pre-existing, documented, NOT fixed here** (out of the four identified
  issues; surfaced during hardening): Halftone's GL fast path ignores
  `_linearize` (averages in sRGB even when the CPU takes its linear branch) and
  hardcodes output alpha `1.0` while CPU fades dot strength by cell alpha — the
  latter entangled with a deeper CPU-source-over vs GL-screen compositing
  difference. Both are part of a broader "GL fast paths diverge from CPU on
  linearize/alpha/compositing" pattern spanning multiple filters; logged in the
  weak-filter backlog for a dedicated future survey+tranche.

Status: Complete
