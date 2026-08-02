# 115 — Instrument Imaging: Radiograph, SEM, Radar PPI

Status: Complete

## Objective

Add three new "instrument imaging" simulations to the Simulate family, each
grounded in the real physics of the instrument it names:

1. **X-ray / Radiograph** — Beer–Lambert attenuation.
2. **Scanning Electron Micrograph** — secant-law secondary-electron yield.
3. **Radar PPI** — radar equation range falloff + rotating sweep with phosphor
   persistence.

None of these exist in the 269-filter registry; they fill an instrument-imaging
gap (Oscilloscope / Spectrogram / Ultrasound / Thermal / Schlieren are present,
but nothing covers transmission radiography, electron imaging, or a rotating
plan-position display).

## Physics / references

### X-ray (Radiograph)

- **Beer–Lambert law**: `I = I₀ · exp(−μ·t)` — transmitted intensity falls
  exponentially with the path integral of the linear attenuation coefficient.
- **Display convention**: film records _transmitted_ intensity, so dense material
  (bone) exposes less film and reads WHITE on a lightbox; offer both the
  positive (bone-white) and film-negative conventions.
- **Scatter / veiling glare**: Compton scatter adds a broad low-frequency
  pedestal that lowers contrast — a blurred component added to the image.
- **Quantum mottle**: photon arrival is Poisson. With `N ~ Poisson(dose·T)` and
  `T̂ = N/dose`, `Var(T̂) = T/dose`, so the ABSOLUTE deviation is `σ = √(T/dose)`
  — largest at HIGH transmission. What collapses behind dense material is the
  signal-to-noise ratio, `σ/T = 1/√(dose·T) = 1/√N`, which is why dense regions
  read mottliest. (Do not conflate the two: using the relative form `1/√N` as an
  absolute offset over-drives dark regions by a factor of `1/T`.)
- Attenuation is a linear-light process: compute in linear, re-encode at output.
- **Honest framing (required)**: the filter has no real radiodensity data, so it
  uses image luminance as a stand-in for path-integrated density. The
  description must say so plainly (same convention as Refractive Glass).

### Scanning Electron Micrograph (SEM)

- **Secant law**: secondary-electron yield `δ(θ) = δ₀ · sec θ = δ₀ / cos θ`,
  where θ is the angle between the surface normal and the incident beam. Steeply
  tilted surfaces emit more escaping secondaries — this is the origin of SEM's
  characteristic bright edges.
- **Everhart–Thornley detector** sits off to one side, so the signal also carries
  a directional (topographic, "lit from one side") component.
- **Scan artifacts**: raster line-to-line gain jitter, shot noise, and localized
  charging bloom on steep features.
- Output is monochrome — SEM detects electrons, not colour.
- **Honest framing (required)**: surface normals are derived from image luminance
  treated as a heightfield; say so in the description.

### Radar PPI (Plan Position Indicator)

- **Radar equation**: received power `Pr ∝ 1/r⁴` — return strength falls with the
  fourth power of range.
- **Rotating sweep**: a bearing line sweeps at ω; a cell lights when the sweep
  crosses it.
- **Phosphor persistence**: after the sweep passes, brightness decays
  exponentially with the angle elapsed since illumination — the classic trailing
  afterglow.
- **Sea/rain clutter**: noise concentrated at short range.
- Classic P-phosphor green display with range rings and bearing graticule.
- Temporal (`_frameIndex` drives the sweep).
- **Honest framing**: image luminance stands in for target reflectivity/RCS.

## Implementation

1. Author each as a GL-only filter (`requiresGL: true`, `glUnavailableStub`
   fallback), matching recent simulation filters (Schlieren Optics, Laser
   Speckle Projector). Normalise every option via `../utils/filterOptions`;
   preserve source alpha; use `SRGB_GLSL` for the linear-light work.
2. Register each in `filters/index.ts` (import + list entry, category
   `"Simulate"`) and regenerate the tracked catalog (`npm run generate`).
   Registration + catalog done by the orchestrator to avoid parallel conflicts.
3. Framework-free unit tests for the physics kernels (Beer–Lambert transmission,
   secant-law yield, 1/r⁴ falloff + persistence decay) and real-browser GL-smoke
   contracts asserting the defining behaviour of each.
4. Full gate (typecheck, lint, generate:check, unit, test:e2e:gl, build) and
   adversarial hardening until no new findings.

## Outcome

Three new GL-only Simulate filters, registered and catalogued (305 lazy filters,
331 rows). Each exports its physics kernels with a GLSL mirror, and each carries
an explicit statement that image luminance is a declared stand-in.

- **X-Ray** (`xray.ts`) — Beer–Lambert `T = exp(−k·d)` in linear light, Compton
  veiling glare as a low-frequency pedestal mixed into the transmission, Poisson
  quantum mottle, and POSITIVE/NEGATIVE display conventions.
- **Scanning Electron Micrograph** (`scanningElectronMicrograph.ts`) — secant-law
  yield `δ = δ₀·sec θ` over a luminance heightfield, Everhart–Thornley off-axis
  detector shading, raster gain jitter, shot noise, charging streaks, monochrome.
- **Radar PPI** (`radarPpi.ts`) — `1/r⁴` radar equation with STC, rotating sweep
  on `_frameIndex`, exponential phosphor persistence on the CCW-wrapped elapsed
  bearing, short-range sea/rain clutter, range rings and bearing graticule.

### What hardening caught (two adversarial rounds per filter)

- **X-Ray, round 1 — real physics bug.** `1/√N` is the _relative_ noise; it was
  being added as an _absolute_ ΔT, missing a factor of `T`, so absolute noise
  scaled as `1/√T` instead of `√T` — a 13× overdrive at stock defaults that
  flipped ~30% of the densest region to pure white. Corrected to
  `σ = √(T/dose)`. The unit test had _codified_ the bug, so it passed throughout.
- **X-Ray, round 2.** The corrected physics had not propagated to the `mottle`
  tooltip, the CHANGELOG, or **this plan doc, whose original wording seeded the
  bug** (it conflated relative and absolute in one sentence — now rewritten with
  the derivation and an explicit warning). Also: a perf regression introduced by
  the round-1 fix (a statically 161-iteration loop at every radius) was resolved
  by remapping sigma so 3σ = r, restoring the original 81-iteration cost while
  making the full slider faithful; one-sided clipping at T→1 was removed and
  `mottle` retuned 0.35→0.1 (air noise ±38.8 → ±8.6 codes).
- **SEM, round 1 — the defining effect was inert at defaults.** The luminance
  gradient was never scaled to a magnitude where normals meaningfully tilt, so
  the secant law contributed a 2.2% mean brightening; `relief` is now the
  heightScale directly (default 4→24). Also `baseYield` was _inverted_ (raising
  δ₀ darkened the image), `gain` sat mid-chain rather than last, and `charging`
  and `scanJitter` were dead at their defaults. A claim that `hU`/`hD` were
  swapped was **refuted by measurement** and independently re-verified against
  `UNPACK_FLIP_Y_WEBGL`/`readClamped` — the code was right.
- **SEM, round 2.** `tint` blew out at saturated hues (luminance normalisation
  scaled pure blue 13.85×, collapsing the image to a two-tone silhouette — 22
  distinct colours); peak-channel normalisation restores full tonality (171
  colours, matching untinted). The GL-smoke contract's own guard claim was
  **false** — its `+20` bar still passed at the inert `relief: 4`; now `+45`.
- **Radar, round 1.** `atan(0,0)` was undefined at the exact scope centre on
  odd-sized inputs (3× brightness anomaly, or a NaN black dot on a stricter
  driver); the spoke width metric lit a permanent hub at the origin; the
  outermost range ring was drawn on the rim; `sweepElapsedAngle` could return
  exactly `2π`. The origin fix blends into the **all-bearing mean** persistence
  (`meanPersistence(τ) = (τ/2π)(1−e^(−2π/τ))`, derived and verified) because the
  beam's angular resolution genuinely collapses there.
- **Radar, round 2.** Two exported-kernel contract guards; three limits at
  extreme settings documented as pixel-space geometry rather than silently left.

### Verification

Framework-free unit tests (X-Ray 18, SEM 16, Radar 16) plus three real-browser
GL-smoke contracts under a new `instrument-imaging` suite. The SEM contract
deliberately exercises **shipped defaults**, so it fails if the tuning ever goes
inert again. Full gate green: typecheck, lint, catalog, 2365 unit, 2775
GL-smoke, build.

Status: Complete
