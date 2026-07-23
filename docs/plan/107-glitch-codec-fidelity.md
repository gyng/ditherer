# 107 — Glitch Signal and Codec Fidelity

Status: Complete

## Objective

Repair three glitch filters whose output contradicts the codec/signal
mechanism they are named after: Datamosh, Data Bend, and Analog Static. Each
advertises a specific real process but implements an unrelated approximation.
(Stable Fluids — which skips Stam's projection step — is a fluid-simulation
accuracy fix and is deferred to a following tranche.)

## Evidence

- **Datamosh** advertises macro-block motion compensation (`blockSize`,
  `motionThreshold`) but never estimates a motion vector: the "motion" branch
  displaces a block by a purely random offset and the "corrupt" branch copies a
  random neighbour block. Real datamoshing applies each macro-block's stored
  motion vectors to the previous decoded frame when I-frames are dropped,
  producing the signature directional smear and bloom. The repo already ships a
  full block-matching estimator (`estimateMotionVector`, SAD search).
- **Data Bend** steps the pixel buffer `i += 4` and applies echo/reverb to R,
  G, B independently, so channel alignment and row structure are preserved —
  the opposite of a raw byte-stream audio effect, whose glitch character comes
  from operating on the flat interleaved stream. Its echo/reverb are also
  additive-only (`min(255, …)`), so samples can only brighten; audio samples are
  bipolar about a midpoint and can darken as well.
- **Analog Static** models untuned-TV bar disturbance as a flat per-band
  luminance offset and ghosting as a fixed 3-pixel copy of a single channel
  reused for all three. Real bar disturbance is a band of elevated per-pixel
  noise energy, and real ghosting is multipath: attenuated, delay-shifted
  full-colour echoes.

## References

- MPEG/H.264 motion-compensated prediction; datamoshing practice (I-frame
  removal / P-frame duplication drags the reference frame along the motion
  field).
- Raw-PCM databending workflow: interpreting the interleaved pixel byte stream
  as audio and applying bipolar DSP about a midpoint.
- Analog VHF reception: thermal noise floor with banded disturbance, and
  multipath propagation producing delayed attenuated ghost images.

## Implementation

1. Rebuild **Datamosh** around real motion compensation: estimate each
   macro-block's motion vector between the current and previous input frame
   with `estimateMotionVector`, then predict the block from the previous
   *output* frame sampled at the motion-compensated position (P-frame
   prediction without I-frame refresh), so held content is dragged along the
   motion field. Periodic keyframe refresh and a corrupt-vector path preserve
   the glitch character. Normalise options; preserve alpha and palette.
2. Rebuild **Data Bend** to operate on the contiguous byte stream (ignoring the
   RGBA stride so channels bleed and rows desync) and mix echo/reverb about a
   128 midpoint so samples can darken as well as brighten; keep bitcrush and
   reverse as byte-stream operations. Preserve alpha and palette; normalise
   options.
3. Rebuild **Analog Static**'s bar disturbance as banded elevated per-pixel
   noise and its ghosting as attenuated multipath full-RGB echoes at a
   user-controllable delay. Preserve alpha, palette, temporal determinism;
   normalise options.
4. Add unit tests for each filter's defining behaviour and real-browser
   GL-smoke contracts where a GL path exists; register them.
5. Run the full unit, Chromium/WebGL, lint, type, catalog, package, and app
   gates.

## Outcome

- Datamosh now performs real motion compensation: it estimates each
  macro-block's vector between the current and previous input frame with
  `estimateMotionVector` and predicts the block from the previous output frame
  at the motion-compensated position, so held content is dragged along the
  motion field. A keyframe interval refreshes to the clean current frame, and a
  corrupt-vector path preserves the bloom/tearing. Options are normalised and
  alpha/palette preserved.
- Data Bend now treats the buffer as a contiguous byte stream (delays unaligned
  to the 4-byte stride, so channels bleed and rows shear) and mixes echo/reverb
  bipolar about a 128 midpoint so samples can darken; bitcrush and reverse are
  byte-stream operations. Alpha restored, options normalised.
- Analog Static's bar disturbance is now banded elevated per-pixel snow (not a
  DC luminance offset) and its ghosting is attenuated multipath full-RGB echoes
  at a controllable `ghostDelay`. Alpha is preserved and options normalised.
- Adversarial review then fixed three issues: the shared block-matcher
  (`estimateMotionVector`) now zero-biases tied/flat blocks so they resolve to
  no motion instead of creeping diagonally by the search radius (improving CRT
  Degauss and the Motion Vectors filter too); new tests pin the motion
  direction/magnitude and the flat-block zero bias; and Analog Static's CPU
  persistence now blends before quantization to stay on a reduced palette,
  matching the GL path.
- Verified with unit tests for each filter's defining behaviour (+ the motion
  and persistence regression tests; 2,236 total), a real-browser GL-smoke
  contract for Analog Static's multipath ghost and alpha (2,715 checks, new
  glitch-codec suite), the motion-vector consumer tests, lint, typecheck,
  catalog verification, and the production build.

Status: Complete

