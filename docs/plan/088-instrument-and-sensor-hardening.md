# 088 — Instrument and sensor hardening

**Status:** Complete

## Objective

Replace three visually plausible but technically weak simulations with behavior
that follows the signal path implied by their names:

- turn Oscilloscope into an image-derived waveform instrument rather than a
  thresholded copy of the source;
- make CCD Charge Smear accumulate excess full-well charge instead of
  normalizing that overload away; and
- make Laser Speckle Projector operate on linear irradiance, preserve alpha,
  and obey the contrast reduction expected from independent diversity modes.

## Audit findings

### Oscilloscope

The current filter converts every source pixel into phosphor brightness at the
same coordinate. It therefore reproduces source silhouettes and never constructs
a signal trace. Its edge multiplier is also labelled as beam dwell despite being
derived from horizontal image contrast. The replacement will offer:

- **Luma waveform** — horizontal source position maps to horizontal display
  position and every row contributes a luminance-voltage sample;
- **Column trace** — the mean luma of each source column produces one trace;
- **RGB parade** — red, green, and blue levels occupy three side-by-side bays.

All modes retain beam width, intensity, bloom, graticule, phosphor selection,
noise, and temporal persistence. Scan-line decoration and the misleading source
threshold are removed.

### CCD Charge Smear

The current shader divides its accumulated overload by the overload weight.
That makes several saturated wells produce nearly the same trail colour as one
well. Blooming is excess charge above full-well capacity, so the replacement
  sums decayed excess without normalization. It retains the overloaded sample's
  spectral ratio rather than adding an arbitrary red/blue tint and exposes
  anti-blooming drain efficiency.

### Laser Speckle Projector

The current shader multiplies gamma-encoded RGB and always emits opaque pixels.
The replacement modulates linear-light irradiance, returns to sRGB only at the
end, preserves source alpha, and keeps diversity as an average of independent
intensity realizations. Its expected speckle contrast therefore falls as
`1 / sqrt(M)` for `M` independent equal-power patterns.

## Research basis

- Tektronix's 1760-series waveform-monitor manual distinguishes waveform and
  RGB parade displays, describes a luminance-only response, and defines a
  voltage/amplitude graticule. That supports mapping horizontal source position
  to time and component value to vertical deflection.
- Andor's CCD blooming note says excess charge above saturation preferentially
  fills vertical neighbours; its anti-blooming structures drain that excess.
  Teledyne separately distinguishes neighbour blooming from readout-direction
  vertical smear.
- Völker et al. experimentally report the `1 / sqrt(N)` reduction associated
  with independent speckle averaging; projection-display measurements likewise
  show lower contrast from angle and wavelength diversity.

## Durable contracts

- voltage-to-screen mapping is bounded and monotonic;
- beam density is symmetric and decreases away from the trace;
- two equal CCD overload events contribute more trail charge than one;
- anti-blooming monotonically reduces spilled charge;
- speckle diversity has mean-preserving `1 / sqrt(M)` contrast scaling;
- browser contracts exercise every oscilloscope mode, CCD direction and drain,
  laser diversity and linear-light path, alpha preservation, temporal liveness,
  and zero-strength identities where applicable.

## Verification

- [x] focused Vitest contracts fail before implementation and pass after it
- [x] TypeScript diagnostics and ESLint are clean
- [x] Chromium before/after contact sheets reviewed at full resolution
- [x] `npm run test:gl` compiles and draws every modified shader path
- [x] full unit, catalog, package build, and application build gates pass
- [x] final diff review finds no stale controls, misleading descriptions, or
      temporary audit artifacts
