# 094 — Codec and Screen Tone Hardening

**Status:** Complete

## Findings

- JPEG Artifact exposes 4:4:4, 4:2:2, and 4:2:0 but always processes full
  resolution chroma. ITU reference software defines 4:2:2 as 2×1 and 4:2:0 as
  2×2 chroma reduction; JFIF recommends filtered rather than skipped samples.
- Color Halftone Separate caps a full primary near 12% mean intensity, encodes
  tone approximately cubically, and moves source lookup instead of the plate
  lattice when registration changes.
- Halftone Line draws ink on white, cannot fill black, and makes black lighter
  as pitch increases. It center-samples large cells, hard-aliases, and forces
  opaque output.

Research: <https://www.itu.int/epublications/publication/itu-t-t-873-v3-2023-09-information-technology-digital-compression-and-coding-of-continuous-tone-still-images-reference-software>,
<https://www.w3.org/Graphics/JPEG/jfif.pdf>, and
<https://www.jstage.jst.go.jp/article/photogrst1964/68/4/68_4_309/_article>.

## Work

1. Add real-browser contracts for JPEG subsampling liveness, halftone endpoint
   and mean-tone response, registration liveness, and exact source alpha.
2. Average Cb/Cr over 2×1 or 2×2 sample groups before JPEG's DCT while retaining
   full-resolution luma and deterministic upsampling.
3. Replace RGB halftone's cubic/dim response with full-primary, area-calibrated
   complementary dot/hole coverage; shift actual plate coordinates.
4. Replace short uncalibrated line marks with a periodic line screen whose
   phase is uniformly distributed, so darkness equals ink coverage. Use bounded
   cell-area sampling, derivative antialiasing, and gradient fallback.
5. Normalize sparse options, preserve alpha, update copy/changelog, visually
   review, and run complete gates.

## Acceptance

- JPEG 4:4:4, 4:2:2, and 4:2:0 are visibly/numerically distinct on chroma
  fixtures while preserving luma structure.
- Halftone white/black endpoints are paper/ink; intermediate means are monotonic
  and pitch-independent within raster tolerance.
- Registration moves the relevant plate geometry and every filter preserves
  source alpha.

## Verification

- Chromium/WebGL: 2,660 contracts passed; 726 shader compiles, 363 links, and
  8,993 draws. New contracts cover tone endpoints/means at three pitches,
  primary isolation, plate registration, source alpha, all JPEG subsampling
  modes, and a constant 13×11 partial-block fixture.
- Vitest: 2,042 passed, 179 skipped.
- Lint, TypeScript, generated catalog check, library build/declarations, and
  production build all passed. Largest JavaScript chunk: 564.76 kB.
