# 066 — Specification-grade signal and codec simulations

## Objective

Turn the six researched candidates into usable, hardened filters whose controls
and failure modes follow published device, transmission, or codec behavior:

1. Group 3/Group 4 facsimile (upgrade `Fax Machine`).
2. PAL/SECAM composite television (new filter).
3. Mitsubishi M64282FP/Game Boy Camera sensor (upgrade existing filter).
4. Apollo slow-scan television and ground scan conversion (new filter).
5. System B Teletext packet/channel decoding (upgrade existing filter).
6. JPEG 2000-inspired 5/3- and 9/7-derived wavelet damage (upgrade `Wavelet Codec`).

Saved chains keep resolving because upgraded filters retain their display names
and legacy Fax sampling/compression options are translated at dispatch time.

## Specification basis

- ITU-T T.4, T.6, and E.453: Group 3/Group 4 line coding, EOL loss, dependent-line damage,
  and damaged-line concealment.
- ITU-R BT.1700 and BT.470: 625-line PAL and SECAM composite encoding and
  decoding characteristics.
- Mitsubishi M64282FP datasheet revision 1.1E: 128 x 128 sensor, exposure,
  gain, offset, inversion, and programmable edge-processing registers.
- NASA/SMPTE Apollo scan-converter paper: 320-line/10 fps and
  1280-line/0.625 fps slow scan, 0.5 MHz bandwidth, persistent kinescope,
  vidicon recapture, magnetic-disc hold, and 525/60 interlaced output.
- ETSI EN 300 706: 24 x 40 System B Teletext display, 45-byte packets,
  odd-parity data, Hamming 8/4 addresses, and packet loss behavior.
- JPEG 2000/OpenJPEG transform contract: reversible 5/3 and irreversible 9/7
  analysis filters, used as the basis for exact pure 5/3 primitives and the
  renderer's explicitly approximate undecimated kernel profiles.

Primary/reference documents:

- <https://www.itu.int/ITU-T/recommendations/rec.aspx?rec=6476>
- <https://www.itu.int/rec/T-REC-T.6/en>
- <https://www.itu.int/rec/R-REC-BT.1700-0-200502-I/en>
- <https://www.itu.int/rec/R-REC-BT.470-7-200502-I/en>
- <https://www.etsi.org/deliver/etsi_en/300700_300799/300706/01.02.01_40/en_300706v010201o.pdf>
- <https://www.nasa.gov/wp-content/uploads/static/history/alsj/SMPTE-79-7-1970.pdf>
- <https://www.openjpeg.org/doxygen/dwt_8h.html>
- Mitsubishi M64282FP datasheet transcription:
  <https://gbdev.gg8.se/wiki/articles/Mitsubishi_M64282FP>

## Implementation

1. Extract deterministic, testable channel primitives for fax line runs,
   concealment, Teletext Hamming/parity, and wavelet coefficient quantization.
2. Upgrade Fax Machine to process bilevel scan rows through a deterministic
   T.4 channel model before the thermal-paper stage. Include MH/MR behavior,
   EOL/code damage, dependent-row failures, and selectable concealment.
3. Port the M64282FP register model into the Game Boy shader: exposure time,
   reference voltage, gain/bias, inversion, VH/N edge selection, E ratio, and
   the P/M/X one-dimensional kernel before four-level cartridge quantization.
4. Add PAL/SECAM as a WebGL2 signal filter with YUV conversion, system-specific
   chroma carriage, bandwidth, delay-line decoding, phase/tuning faults, and
   luma/chroma crosstalk.
5. Add Apollo SSTV as a temporal WebGL2 filter with slow raster sample/hold,
   bandwidth loss, phosphor persistence, vidicon lag/bloom, disc-frame hold,
   interlace, and deterministic RF/tape faults.
6. Upgrade Teletext with System B geometry and a deterministic packet channel
   driven by parity/Hamming outcomes, including row loss and concealment.
7. Upgrade Wavelet Codec with selectable 5/3- and 9/7-derived undecimated
   kernel profiles, multilevel detail, quantization and simulated bit-plane
   truncation. Keep the exact reversible 5/3 primitive separately tested;
   don't present the one-pass visual renderer as a conforming JPEG 2000 codec.
8. Register the new filters, regenerate selective loaders/catalog data, and
   add behavior tests for all pure contracts and registry metadata.

## Hardening and acceptance gates

- Every option has a description and finite, bounded legacy fallback.
- Seeded channel damage is repeatable; changing the seed changes failures.
- Zero-error fax and Teletext channels preserve their encoded content.
- Hamming 8/4 corrects every single-bit error and flags every tested double-bit
  error; odd-parity failures are detected.
- 5/3 lossless analysis/reconstruction round-trips integer signals exactly.
- New shaders compile and produce a real, opaque, non-black draw in Chromium.
- Generated catalog/loaders are current.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
  `npm run test:gl` pass without warnings attributable to this work.
