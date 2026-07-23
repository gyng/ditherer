# Changelog

All notable changes to `@gyng/ditherer-filters` are documented here. The
package follows semantic versioning.

## [Unreleased]

### Changed

- Rebuilt Contour Map and Wake Turbulence around the named effect. Contour Map
  now draws anti-aliased iso-contour lines at each elevation level over the
  hypsometric fill (from a smoothed height field), with line colour/width
  controls, instead of only flat posterized bands. Wake Turbulence now refracts
  the image with a divergence-free curl-noise turbulence field advected along
  the motion-energy gradient, instead of a stationary axis-aligned sinusoid.
- Rebuilt Duotone, Wallpaper Tiling, and Frequency Filter around the named
  transform. Duotone now composites two ink density curves over paper (a
  monotonic shadow ink and a midtone-bump second ink) with a real overprint
  crossover, instead of a single luma lerp (a gradient map). Wallpaper Tiling's
  P2 is now a genuine 180° rotation group (no mirror lines — it was byte-identical
  to PMM) and P6M is a real hexagonal 6-fold + mirror kaleidoscope, backed by an
  invariance-tested fold reference. Frequency Filter now separates bands with a
  Gaussian low-pass and a difference-of-Gaussians band-pass instead of a box blur
  (whose sinc side-lobes rang rather than isolating frequency bands).
- Rebuilt Anamorphic Cylinder and Stamp around the process they name. Anamorphic
  Cylinder now uses the cylindrical-mirror reflection geometry — a LINEAR radial
  map (`r = R_c + z·cot α`) with angle preserved and a continuous polar
  mirror-preview disc — instead of an arbitrary log/exp remap that showed the
  raw source inside the mirror. Stamp is now a real relief die: a binary mask,
  morphologically opened/closed, with ink break-up concentrated at shape edges
  (distance-to-edge on the opened field) and low-frequency pressure noise,
  instead of a threshold plus spatially-uniform white noise.
- Rebuilt three photographic filters around the tonal/optical process they name.
  Solarize now applies a smooth Sabattier tone-reversal curve (the same curve on
  every channel) instead of a knife-edge, per-channel invert, so highlights fold
  toward black through a continuous hump rather than producing garish false
  colour. Dodge/Burn applies its exposure factor in linear light (the correct
  exposure change) instead of a gamma-space multiply. Atmospheric Haze uses the
  exponential Koschmieder transmission law and composites the airlight tint in
  linear light instead of a depth-linear gamma-space lerp.
- Stable Fluids now performs Stam's divergence projection (previously skipped):
  after advecting the velocity each step it computes the divergence, relaxes the
  pressure Poisson equation with Jacobi iterations, and subtracts the pressure
  gradient, so the field is genuinely incompressible and real rolling vortices
  form. A `pressureIterations` control exposes the incompressibility/speed
  trade-off (0 keeps the legacy divergent look). The projection math is backed
  by a unit-tested reference.
- Rebuilt three glitch filters around the codec/signal mechanism they name.
  Datamosh now applies real per-macro-block motion compensation — predicting
  each block from the previous output frame at the estimated
  motion-compensated position (P-frame prediction without I-frame refresh)
  instead of random block displacement. Data Bend now operates on the
  contiguous byte stream (channels bleed, rows shear) and mixes echo/reverb
  bipolar about a 128 midpoint so it can darken as well as brighten. Analog
  Static's bar disturbance is now banded elevated per-pixel noise and its
  ghosting is attenuated multipath full-RGB echoes at a controllable delay.
  The shared block-matcher now zero-biases tied/flat blocks so they no longer
  creep diagonally.
- Rebuilt four Blur & Edges filters around the optical operation they name.
  Despeckle is now an edge-preserving thresholded median (impulse removal that
  keeps edges) instead of a backwards variance-gated box mean. Sharpen builds
  its unsharp mask from a true separable Gaussian rather than a box blur. Bloom
  is a linear-light bright pass with a multi-scale Gaussian spread and additive
  composite in linear light, replacing a single-scale gamma-space box glow.
  Bokeh gathers and composites highlight energy in linear light and samples the
  circle of confusion densely enough to avoid lattice gaps. Malformed options
  are normalised and source alpha is preserved.
- Rebuilt the pen-and-ink and relief printmaking stylizers (Crosshatch,
  Engraving, Woodcut, Stipple) so tone is reproduced by continuous mark
  density instead of hard luminance thresholds over a fixed device-space
  lattice. Crosshatch stacks four fixed-angle hatch layers with strokes that
  thicken by tone; Engraving swells its burin lines and adds a crossing set
  and dot-and-lozenge shadow texture that follow the subject's form; Woodcut
  carries mid-tones with structure-tensor-oriented gouges whose carved area
  equals the local lightness; Stipple places constant-radius dots whose
  density (not size) tracks darkness. Marks are anti-aliased, source alpha is
  preserved, and sparse/malformed options are normalised.

## [0.4.0] - 2026-07-23

### Added

- Four WebGL2 simulation/art crossovers: Schlieren Optics, Laser Speckle
  Projector, Suminagashi Marbling, and Quasicrystal Mosaic.
- Anime Rim Light plus clear-day, blue-hour, ink, environment-paint, luminous
  sky, arcade CRT, aperture-grille, and broadcast-monitor preset recipes.
- Profiled CRT contracts for 240p arcade, 525/60 and 625/50 consumer tubes,
  aperture-grille monitors, broadcast monitors, and custom rasters.

### Changed

- Rebuilt Infrared Photography, Mezzotint, Nokia LCD, and Daguerreotype around
  documented spectral, printmaking, display, and plate characteristics while
  preserving their saved-state option keys.
- Replaced Film Burn's additive circles with irregular heat-front, emulsion,
  blister, crack, and base-distortion damage, and replaced Ink Bleed's square
  minimum with fiber-aware capillary deposition on paper.
- Reworked Cyanotype as washed Prussian-blue image density over paper and
  Thermal Camera as an explicitly labeled, low-resolution visible-luminance
  proxy with level/span and sensor noise controls.
- Rebuilt Anime Color Grade, Tone Bands, Ink Lines, and Sky around scene color
  scripts, structure-aware value grouping, XDoG extraction, coherent clouds,
  conservative masks, and production-oriented controls.
- Reworked CRT emulation in linear light with a 2.4 voltage-to-light transfer,
  current-dependent Gaussian beams, source-line raster density, physical mask
  families, profile geometry, overscan, stabilizing wires, and corrected
  interlace composition.
- Upgraded Scanline to a resolution-independent integrated beam profile while
  retaining the legacy dark-row and artistic RGB modes.
- Reworked Newspaper around a locally averaged 45° screen, Thermal Printer
  around coherent line-head cells, and Polaroid around a detail-preserving,
  neutral-capable instant-film grade with fixed developed grain.
- Replaced Watercolor Bleed's four-neighbor, red-channel approximation with
  bounded eight-neighbor pigment diffusion, luminance-based deposition, and
  smooth multiscale paper fibers; its copy now states the model's limits.
- Rebuilt Film Grain as density-aware correlated silver/dye-cloud variation,
  Light Leak as spectrally faithful linear-light exposure, and Projection Film
  with area/width-scaled debris, mixed film-layer scratches, and density grain.
- Reworked Photocopier around continuous repeated-copy density transfer and
  fixed asymmetric toner defects; rebuilt Paper Texture with resolution-safe
  irregular fibre/weave models and Sumi-e with correlated washi formation.
- Rebuilt the layered-print family around fixed Risograph masters and
  registration, correlated stencil variation, true zero-bleed behavior,
  clustered-dot screen plates with subtractive overprint and dot gain, and
  bounded sequential duplex ink coverage.
- Rebuilt Oscilloscope as an image-derived luma waveform, mean-column trace,
  and RGB parade with Gaussian beam density, instrument graticule, bloom, and
  phosphor persistence instead of a thresholded copy of the source.
- Reworked CCD Charge Smear around additive full-well overflow and an
  anti-blooming drain, and moved Laser Speckle Projector's coherent irradiance,
  diversity averaging, scan modulation, and bloom into linear light.
- Rebuilt E-ink around 16 optical states, 16³-color coarse Kaleido cells,
  fixed reflective texture, clearing waveforms, and changed-pixel partial
  residuals; rebuilt Vintage TV around a luma/chroma receiver path and
  resolution-normalized raster; and moved Digicam Flash exposure and sensor
  saturation into linear light with flash-only white balance.
- Reworked Voronoi, K-means, and Pixelsort around explicit deterministic seeds;
  K-means now defaults to alpha-weighted perceptual Lab clustering and applies
  its selected output palette instead of silently ignoring it.
- Reworked Delaunay to cover the complete raster and use alpha-weighted triangle
  colors, implemented Stained Glass's advertised average, median, and dominant
  pane statistics across CPU/WebGL, and made Median Cut honor arbitrary color
  budgets instead of rounding them up to a power of two.
- Rebuilt Color Halftone Separate and Halftone Line around area-calibrated tone
  coverage, real plate registration, filtered cell sampling, antialiasing, and
  source-alpha preservation.
- Implemented JPEG Artifact's 4:4:4, 4:2:2, and 4:2:0 controls, padded partial
  blocks to complete 8×8 transforms, and retained its legacy master-quality key
  as saved-state input without exposing a dead duplicate control.
- Rebuilt Contour Lines around endpoint-preserving flat luminance bands and
  antialiased scalar-field boundaries, and rebuilt Dot Matrix around fixed
  circular printer-pin strikes whose ordered firing density represents tone.
- Rebuilt Pencil Sketch around alpha-aware contour-following hatching, Mosaic
  Tile around exact shared visible-color tile statistics, and Oil Painting
  around circular alpha-weighted modal neighborhoods with unbiased ties.
- Moved Anisotropic Diffusion to half-float iteration storage with shared RGB
  edge guidance and alpha-gated flux, eliminating byte-rounding limit cycles.
- Rebuilt Posterize Dither around cell-centered Bayer stochastic rounding and
  CMYK Halftone around area-calibrated dot/complementary-hole AM screens.
- Atlas-packed CLAHE tile CDFs within device texture limits, spread clipped
  residuals across the histogram, excluded transparent samples, and made
  palette-level controls consistent across CPU and WebGL.
- Rebuilt Lens Flare in linear light with resolution-aware bloom, smooth
  chromatic optical-axis ghosts, and controllable streaking; rebuilt Pop Art
  around area-correct dot/hole tone coverage, antialiasing, screen rotation,
  and configurable paper; and exposed Facet's deterministic layout seed and
  honestly labeled local-mean sampling.
- Rebuilt Bilateral Blur as one bounded, alpha-aware guided separable pipeline
  across CPU and WebGL, with explicit full/half/quarter working resolutions,
  linear-light support, source-guided reconstruction, and shared palette
  behavior.
- Made Mavica FD7 an honest WebGL2-required pipeline, aligned its interlace,
  alpha, JPEG, smear, noise, and clipping stages, and exposed codec failures
  with the standard visible capability plate instead of a partial CPU result.

### Fixed

- Preserved source alpha and excluded invisible RGB from Delaunay, Stained
  Glass, and Median Cut statistics; kept custom Stained Glass palettes scoped
  to pane colors so they no longer recolor the lead network on WebGL.
- Corrected JPEG ringing's reversed Laplacian sign, sanitized malformed numeric
  state, and kept current-frame alpha when temporally holding damaged RGB blocks.
- Preserved alpha and ignored hidden transparent RGB in Contour Lines,
  Anisotropic Diffusion, Dot Matrix, and Pixel Outline; made Pixel Outline's
  fractional width continuous and aligned its CPU/WebGL edge metric.
- Corrected Edge Trace's 90-degree-rotated non-maximum suppression axes, made
  its width coverage continuous, and preserved alpha through Edge Trace,
  Posterize Dither, CMYK Halftone, and CLAHE.

- Preserved neutral reflectance in the visible-RGB infrared estimate, marked
  Thermal Camera's frame-varying noise as temporal, and made Ink Bleed's fiber
  axis invariant under equivalent 0°/180° directions.
- Preserved source alpha through Nokia LCD sampling, Daguerreotype soft focus,
  and Film Burn distortion; made Film Burn's zero-vector angle math defined.
- Kept Nokia LCD output in its two physical optical states and suppressed
  inter-pixel gaps until the output scale can resolve them without obscuring
  active cells.
- Corrected Cyanotype's 255× grain-unit error, preserved source alpha across
  the upgraded physical-imaging effects, and removed the misleading claim
  that visible RGB input can provide measured thermal temperature.
- Replaced frame-relative phosphor trails with refresh-aware P22
  decay-to-10% timing and explicit custom, long-persistence, and legacy modes.
- Prevented retained interlace fields from accumulating repeated bloom and
  horizontal softening, removed CRT black lift and unintended 32-level output
  quantization, and aligned CPU/GL raster luminance calculations.
- Removed frame-to-frame shimmer from fixed newspaper ink, thermal dropout,
  and developed-film grain; preserved source alpha through all four static
  media effects and normalized watercolor edge deposition across timesteps.
- Preserved alpha through projection weave and bloom, changed gate dust from
  emitted white specks to occlusion, kept nonzero default scratches live, and
  added missing temporal, control-description, and sparse-state metadata across
  the analog-film effects.
- Removed frame shimmer and destructive posterization from Photocopier, capped
  substrate frequencies below pixel Nyquist, and preserved source alpha across
  the hardened copy, material, and ink-wash paths.
- Removed frame shimmer and forced zero-setting blur from the Risograph paths,
  preserved source alpha through all layered-print effects, corrected Screen
  Print's misleading random-angle copy, and eliminated Duplex Print's negative
  paper contribution and inked-white highlights.
- Marked every filter with a live animation control as temporal, restoring
  accurate catalog badges, search metadata, and consumer-side classification
  for 19 previously unmarked animated effects; removed Data Bend's inert
  animation controls and temporal classification.
- Reworked Night Vision around bounded intensifier gain, a finite background
  floor, signal-dependent shot noise, and alpha-safe phosphor compositing.
- Reworked Ultrasound as an honest source-derived impedance proxy with
  boundary-driven echoes, depth attenuation, correlated Rayleigh speckle,
  logarithmic B-mode compression, and optional measurement overlays.
- Corrected E-ink's former 125-color quantizer, removed its redundant default
  palette re-quantization, stopped full refreshes from retaining partial-update
  ghosting, preserved source alpha through E-ink, Vintage TV, and Digicam
  Flash, and bounded malformed saved-state values for all three simulations.
- Preserved source alpha through the Mavica FD7 GPU pipeline and classified its
  frame-varying field, lighting, and sensor behavior as temporal.
- Replaced Lenticular's unrelated rainbow overlay with a source-preserving
  cylindrical lens sheet, synthetic interlaced views, viewing-angle selection,
  parallax, and crosstalk.
- Corrected LCD Display's RGB stripe, PenTile RGBG, and Diamond RGBG emitter
  topology, black-matrix control, and alpha handling.
- Rebuilt Spectrogram around Hann-windowed one-sided spatial magnitudes, a
  shared fixed dB reference, Nyquist-bounded bins, and real linear/log frequency
  axes instead of per-column self-normalization; tiny signals now remain
  finite, the even-length Nyquist bin is not doubled, and inputs beyond the
  bounded shader loop use the exact CPU path.
- Rebuilt Anaglyph around convergence-centered synthetic disparity and a
  linear-light Dubois red/cyan projection, fixing the CPU path's 255× depth
  normalization error and restoring CPU/WebGL parity across every mode.
- Replaced Bayer Sensor's generic interpolation and output desaturation with
  true nearest/bilinear baselines, complete 5×5 gradient-corrected demosaicing,
  linear-light CFA capture, shot/read noise, pre-demosaic crosstalk, optical
  low-pass filtering, stable defects, and preserved alpha.
- Replaced Moiré / Aliasing's decorative sine overlays with actual rotated
  sampling, RGB emitter, and conventional CMYK screen lattices whose pitch,
  angle, aperture, and motion generate the visible aliases; source alpha and a
  true zero-strength identity are preserved.
- Corrected CCD direction labels and removed charge normalization and arbitrary
  red/blue trail bias; multiple overloaded wells now accumulate more spill.
- Preserved source alpha in Laser Speckle Projector and made independent
  diversity reduce contrast without systematically dimming projected light.
- Made Voronoi's spatial-grid search return the true nearest site, prevented
  transparent RGB from tinting cell averages and K-means centroids, stopped
  collapsed K-means inputs from accumulating duplicate dead clusters, and made
  Pixelsort honor its declared maximum interval size exactly without silently
  binary-quantizing direct-module output.
- Preserved source alpha through Lens Flare and Pop Art, made zero-intensity
  flare an exact opaque-input identity, premultiplied Facet's local-mean blur,
  retained transparent Facet coverage, and antialiased Facet seams.
- Restored sparse saved-state defaults for Lenticular, Spectrogram, Anaglyph,
  Bayer Sensor, and Moiré / Aliasing; associated ACTION and palette help text
  with their controls, keyed built-in palette choices by their runtime IDs so
  selected values display correctly, and corrected misleading screen-pitch
  and brightness-variation labels.
- Restored sparse direct-call defaults for LCD Display, Ultrasound, Night
  Vision, and Mavica FD7; corrected Mavica's native-output control to describe
  its 640×480 working-size ceiling; made Night Vision bloom, LCD logical-cell
  sampling, and Spectrogram DFTs alpha aware so hidden RGB cannot contaminate
  visible output.
- Bounded Mavica's intermediate allocation to its working resolution and
  cleared pooled staging pixels before translucent draws, preventing repeated
  renders from accumulating source-over alpha.
- Split installed filter-package modules in the packed-application build,
  bringing the largest JavaScript artifact back below the enforced 2 MB
  release ceiling without raising or suppressing the warning.
- Unified WebGL readouts with the shared canvas pool, reset reused drawing
  state, rejected duplicate releases, and made nested JPEG/Mavica ownership,
  float-target replacement, realm disposal, and exception cleanup explicit.
- Made shared texture/framebuffer allocation, shader/program linking, FFT
  program-cache initialization, and fullscreen-quad setup transactional, so
  failed creation, setup, resize, compile, link, or uniform lookup cannot leak
  partial GL handles or leave deleted resources published in caches.
- Coverage-weighted Ultrasound and Mavica statistics and spatial processing;
  normalized malformed LCD, Spectrogram, Night Vision, Ultrasound, and Mavica
  options while preserving valid custom palettes and runtime overrides.
- Hardened chain execution, worker fallback, previews, export, grayscale, and
  cache reuse as generation-scoped ownership transactions; stale async work
  can no longer emit, restore temporal state, reuse displayed or pinned
  canvases, or retain GPU resources after reset.
- Hardened imported and duplicated chains to the 16-stage limit, rejected
  malformed/prototype filter records and scalar state, preserved logical
  selection, and made v2 IDs plus per-entry/global audio modulation round-trip
  without dead targets or single-entry format loss.

## [0.3.0] - 2026-07-22

### Added

- Specification-grade and unusual display simulations covering PAL/SECAM,
  teletext, fax, Apollo slow-scan television, PXL-2000, Apple II HGR, ZX
  Spectrum, Game Boy Camera, Amiga HAM6, Baird mechanical television, CGA
  composite artifact color, PLATO plasma panels, and DLP sequential color.
- N-candidate ordered dithering, OKLab palette matching, and whole-buffer
  WASM-accelerated palette quantization paths.
- A reusable boundary-seeded RGBA16F jump-flood distance field plus SDF Boolean
  Sculpt, SDF Medial Axis, and animated SDF Flow Warp filters.
- Expanded shader, worker, backend-parity, malformed-state, temporal, and
  output-contract validation across the public filter registry.

### Changed

- SDF Stylize now uses a true signed boundary distance instead of an unsigned
  foreground seed approximation.
- Oversized palettes are reduced intelligently instead of being truncated, and
  the complete generated catalog remains available through selective imports.

### Fixed

- Corrected serpentine error-diffusion direction, pixel-sort iterator
  duplication, low-color octree hangs, and missing palette-mode fallbacks.
- Brought JavaScript and WASM Lab/OKLab conversion behavior into parity for
  fractional channels and linearized palette matching.
- Hardened signal decoders, filter workers, temporal state, and WebGL paths
  against malformed saved options and silent passthrough or black output.

## [0.2.0] - 2026-07-16

### Added

- Stable per-filter subpath imports under `filters/*`.
- An implementation-free metadata catalog and lazy canonical loader.
- Deterministic registry-derived generation and bundle-size contracts.
- A standalone packed-package example covering direct imports, lazy loading,
  sessions, workers, WASM readiness, and explicit cleanup.

### Fixed

- Ordered dithering now applies Nearest palette levels independently of the
  threshold map's quantization levels.

## [0.1.1] - 2026-07-16

### Changed

- Declared the filter package as an npm workspace and an explicit Ditherer
  application dependency.
- Added a release gate that builds the real Ditherer app against the packed
  tarball and verifies its module worker and RGB-to-Lab WASM payload.
- Restricted legacy engine implementation aliases to Vitest so production
  application builds consume only the public package entries.
- Added a documented, reproducible GitHub Packages release procedure.

## [0.1.0] - 2026-07-16

### Added

- Initial React-independent filter catalog and session runtime.
- Canvas2D, WebGL2, worker, temporal-state, palette, and optional WASM support.
- Root, client, worker, and WASM-bindings public entries with generated types.
- Packed consumer, browser, application, and complete shader-registry gates.
