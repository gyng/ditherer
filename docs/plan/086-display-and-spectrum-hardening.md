# 086 — Display and Spectrum Hardening

## Status

Complete.

## Findings

- Lenticular is a rainbow stripe overlay that largely replaces the source
  image. It conflates lenticular printing with holographic diffraction, has no
  interlaced views or viewing-angle phase, and discards alpha.
- LCD Display models PenTile as alternating two-channel stripes and Diamond as
  three angular sectors. Neither represents its named subpixel topology. Cell
  widths become biased when the pixel size is not divisible by three, the gap
  control changes only a near-black constant, and every layout discards alpha.
- Spectrogram labels `logScale` as logarithmic frequency but applies logarithmic
  magnitude compression instead. It normalizes each column independently,
  erasing relative energy over the horizontal axis; computes bins above
  Nyquist on short inputs; uses no window; places DC at the top; and discards
  alpha. A second review also found that the even-length Nyquist bin was
  doubled, one- and two-row inputs collapsed under an all-zero Hann window, and
  the bounded GL loop silently truncated signals taller than 4096 rows.

## Research basis

- Lenticular references describe a regular array of parallel cylindrical
  lenticules focusing an interlaced image on the rear surface, with different
  image portions selected by viewing angle. This pass therefore replaces the
  unrelated rainbow overlay with a clearly labeled, single-image synthetic
  view-interlacing proxy, cylindrical transmission, angle phase, and crosstalk.
- PenTile RGBG references describe green interleaved with alternating red and
  blue emitters. Samsung's Diamond Pixel material describes diamond-like
  emitter shapes with green smaller and more densely populated. The replacement
  layouts preserve those count and geometry invariants without claiming to
  reproduce a proprietary subpixel renderer.
- SciPy's ShortTimeFFT documentation treats each time slice as a consistently
  scaled magnitude or PSD spectrum and exposes explicit frequency-bin spacing.
  The replacement spatial spectrogram therefore uses a Hann window, one-sided
  magnitude scaling, a fixed dB range shared across columns, Nyquist-bounded
  bins, and a true linear/log frequency-axis mapping.

## Contracts

1. A neutral source remains neutral through the lenticular lens sheet; changing
   view angle changes selected synthetic views without adding rainbow color.
2. Lenticular view selection is periodic per lens, symmetric around the center
   view, and preserves source alpha.
3. RGB stripe divides each logical pixel evenly. PenTile shares alternating
   red/blue emitters with green, and Diamond uses diamond-shaped emitters with
   twice as many green positions as red or blue.
4. LCD black-matrix darkness is monotonic and all layouts preserve source alpha.
5. Spectrogram magnitudes retain relative amplitude across columns, remain
   bounded under a fixed dB range, use no bins above Nyquist, and put high
   frequencies above low frequencies on both linear and logarithmic axes. DC
   and the even-length Nyquist bin are not doubled, tiny signals remain finite,
   and inputs beyond the shader bound use the exact CPU path.
6. Every affected control and catalog row accurately describes the proxy being
   rendered.

## Verification

- Pure unit contracts for lenticular view selection, subpixel topology, and
  spectrogram frequency/magnitude mapping.
- Permanent Chromium contracts for neutral lenticular output, LCD layout
  topology, cross-column spectral energy, and exact source alpha.
- Before/after contact sheets covering meaningful controls and layouts.
- Generated catalog, lint, typecheck, full unit suite, library/app builds, and
  complete WebGL shader gate.

## Outcome

- Replaced Lenticular's rainbow overlay with a source-preserving synthetic
  interlaced-view lens sheet, bounded parallax, viewing-angle selection,
  crosstalk, cylindrical transmission, and alpha-safe output.
- Rebuilt LCD Display's three layouts around equal RGB stripes, shared-chroma
  PenTile RGBG, and denser green Diamond RGBG emitters with a meaningful black
  matrix and preserved alpha.
- Reworked Spectrogram into a Hann-windowed, one-sided spatial spectrum with a
  shared fixed dB reference, correct DC/Nyquist scaling, true frequency-axis
  mapping, tiny-input handling, exact oversized-input fallback, and preserved
  alpha.
- The post-change contact sheet and two subsequent static/edge-case reviews
  produced no remaining findings in this tranche.
- Final gates: 129 Vitest files passed (1,982 tests; 179 skipped), lint and
  TypeScript checks passed, generated catalog verification passed, library and
  app production builds passed, and Chromium WebGL validation passed with
  2,627 contracts, 722 shader compiles, 361 links, and 8,755 draws.
