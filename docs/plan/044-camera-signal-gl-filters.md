# 044 - Camera and signal GL filter pack

## Goal

Add seven distinct WebGL2 filters that fill camera-sensor, optical, temporal,
codec, and monitoring gaps in the existing registry, then compose them into
useful presets rather than leaving them as isolated demos.

## Filters

1. **Rolling Shutter** — blend current and previous frames along a configurable
   sensor readout axis, with skew and readout wobble.
2. **Bayer Sensor / Demosaic** — simulate four CFA layouts, three reconstruction
   methods, sensor noise, and hot pixels.
3. **CCD Charge Smear** — bleed overloaded highlights along sensor columns with
   controllable threshold, length, decay, and channel bias.
4. **Moiré / Aliasing** — resample through a rotated grid and add controllable
   luminance/chroma interference.
5. **Wavelet Codec** — quantize Haar-like local detail coefficients at a chosen
   transform scale, including soft reconstruction ringing.
6. **Refractive Glass** — derive a surface normal from luminance, edges, or
   procedural roughness and refract RGB channels with dispersion.
7. **Camera Monitor** — focus peaking, exposure zebras, false color, clipping
   warnings, and a combined monitoring view.

All seven use the shared worker-safe WebGL2 pipeline and declare
`requiresGL: true`. Rolling Shutter also declares temporal behavior and exposes
the standard animation action.

## Integration

- Register every filter with descriptions and categories.
- Add camera, codec, glass, and monitoring presets; improve relevant existing
  webcam, Mavica, surveillance, and underwater composites with the new tools.
- Rely on registry/preset contracts plus the real-browser GL gate for branch,
  shader compilation, output, and worker coverage.

## Verification

Run TypeScript, ESLint, unit/integration tests, preset reporting, production
build, and the Chromium WebGL shader suite before committing and pushing.

## Outcome

- Shipped all seven filters as registered `requiresGL` effects; Rolling Shutter
  also carries the temporal metadata needed by the frame pipeline.
- Added five new composite presets and upgraded six existing camera, codec,
  lenticular, surveillance, and underwater recipes.
- Confirmed 168 presets have no duplicate signatures.
- Verified every new filter both directly and through the real Web Worker path
  in Chromium with opaque, non-flat output. The broader auto-discovered shader
  sweep compiled and drew all seven; its remaining black-output failures are in
  pre-existing Line Art, Posterize Edges, ABA, and Poster Hold cases.
