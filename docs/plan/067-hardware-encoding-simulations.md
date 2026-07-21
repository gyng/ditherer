# 067 — Hardware encoding simulations

## Objective

Add four historically specific image/video simulations whose recognizable
artifacts follow the original storage or display hardware rather than a generic
retro grade:

1. Apple II high-resolution NTSC artifact color.
2. ZX Spectrum 48K bitmap and attribute cells.
3. Amiga OCS six-bit-plane Hold-And-Modify (HAM6).
4. Fisher-Price PXL-2000 cassette video.

The filters keep their hardware constraints visible in both their controls and
their output. Conversion from an arbitrary source image is deterministic, while
the decoded/displayed result obeys the relevant pixel, palette, scanline, and
temporal contracts.

## Specification basis

- Apple IIe Technical Reference Manual: 280×192 HGR dots; seven displayed bits
  per byte; bit 7 selects purple/green or blue/orange; an isolated set dot is an
  artifact color determined by column phase, while adjacent set dots are white;
  the 7 MHz dot stream is one half-cycle of the 3.58 MHz NTSC subcarrier.
- Sinclair ZX Spectrum user manual: a 256×192 one-bit bitmap plus one attribute
  byte per 8×8 character cell; each cell has one INK, PAPER, BRIGHT, and FLASH
  state and therefore no more than two colors in its 64 dots.
- Commodore Amiga Hardware Reference Manual: HAM uses six bitplanes; `00`
  selects one of sixteen 12-bit color registers, while `01`, `10`, and `11`
  retain the previous pixel and replace its blue, red, or green nibble.
- US Patent 4,875,107: PXL-2000 architecture with a 120×90 monochrome frame
  transfer CCD, 15 Hz acquisition, 90 kHz low-pass filter, 180 kHz pixel system,
  FM storage on an audio cassette running about eight times normal speed, and
  dual-frame ping-pong playback to standard television timing.

Primary documents:

- <https://manuals.plus/m/4843507d8de925f2d23dda507f319a943f2f8d39db89e52ef3dd76f1d2e1b305>
- <https://manualzz.com/doc/23592820/sinclair-zx-spectrum-user-manual>
- <https://oldcrap.org/wp-content/uploads/2023/04/amiga-all-hw-ref-manual.pdf>
- <https://patents.google.com/patent/US4875107A/en>

## Implementation

1. Add pure codec helpers for Apple HGR dot decoding, ZX attribute selection,
   HAM6 scanline encoding/decoding, and PXL capture timing.
2. Add Apple II HGR as a WebGL2-only gather filter. Convert to the 280×192 dot
   grid, choose one color-set bit per seven dots, apply the documented neighbor
   and column-phase color rules, and expose color/green/monochrome monitors.
3. Add ZX Spectrum as a two-pass WebGL2 filter. First choose one legal attribute
   and bitmap assignment per 8×8 cell; then reconstruct the 256×192 display,
   including deterministic hardware-rate FLASH swapping.
4. Add Amiga HAM6 as a sequential CPU filter. Build sixteen 12-bit base color
   registers, encode each low-resolution scanline with legal direct/modify
   opcodes, reset from COLOR00 at each line, and scale the decoded raster back to
   the input canvas.
5. Add PXL-2000 as a temporal WebGL2 filter with the 120×90 CCD grid, monochrome
   integration and clipping, bandwidth loss, FM/cassette noise and dropouts,
   and 15 Hz ping-pong frame holding.
6. Register all filters, regenerate selective exports/catalog metadata, and add
   focused browser signal-property checks in addition to the registry-wide GL
   compile/draw sweep.

## Acceptance gates

- Apple HGR emits black for clear dots, white for adjacent set dots, and the
  documented even/odd artifact color for isolated set dots and each byte phase.
- Every ZX 8×8 cell contains no more than two colors from a single brightness
  bank; FLASH swaps those colors without changing the bitmap.
- Every HAM6 opcode decodes according to the Commodore bitplane table, scanlines
  reset from COLOR00, and all output components lie on the OCS 4-bit ladder.
- PXL output uses a 120×90 sampling grid and holds intermediate preview frames
  according to the exact 15 Hz capture ratio.
- Legacy/malformed options remain finite and deterministic.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, generated
  catalog checks, and `npm run test:gl` pass without new warnings.
