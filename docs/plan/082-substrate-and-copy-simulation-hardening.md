# 082 — Substrate and Copy Simulation Hardening

## Status

Complete for the audited tranche.

## Scope

Harden three upgraded-looking but visibly weak filters found by the continuing
catalog review:

- **Photocopier** — replace animated salt-and-pepper noise and destructive
  posterization with fixed toner scatter, transfer voids, and progressive
  copy-generation detail loss.
- **Paper Texture** — replace ideal sinusoidal screens with irregular,
  antialiased paper, canvas, linen, and cardboard structures.
- **Sumi-e** — replace pixel hash static with multiscale, directionally fibrous
  washi variation while retaining controllable ink-wash bands.

## Evidence

- Xerox describes xerography as charged toner particles transferred to paper,
  notes that transfer is not perfectly efficient, and documents background
  toner scatter, random deletion/voids, mottling, and loss of light/dark detail
  as real output defects.
- CottonWorks describes plain weave as alternating warp-over/weft-under on a
  two-by-two repeat. The shader should preserve that topology without rendering
  perfectly uniform mathematical ruling.
- Japan's National Diet Library describes washi as dispersed long bast fibres
  formed into a sheet. Paper texture should therefore be spatially correlated
  and fibrous rather than independent per-pixel noise.

## Contracts

1. Photocopier output is invariant to `_frameIndex` for identical source and
   controls.
2. Generation loss reduces local detail while retaining continuous tonal
   transitions instead of quantizing a smooth ramp into flat bands.
3. Toner artifacts are asymmetric: deposits occur mainly in light areas and
   transfer voids mainly in dense toner.
4. Woven textures use derivative-aware coverage and remain bounded at the
   highest scale.
5. Sumi-e paper variation is correlated across neighboring pixels and retains
   source alpha.
6. All controls and catalog entries have accurate descriptions; saved partial
   option objects fall back to defaults.
7. All changed WebGL paths compile, draw nontrivial output, and pass real
   Chromium review.

## Verification

- Focused Vitest contracts and option-surface checks.
- Permanent Chromium/WebGL contracts for fixed-copy stability, alpha, tonal
  continuity, and correlated substrate variation.
- Before/after contact sheets covering defaults and extreme controls.
- Full lint, typecheck, unit, build, generated-catalog, and WebGL release gates.

## Outcome

- Completed three Chromium comparison rounds and removed the temporary audit
  harness after the output converged.
- Photocopier is fixed-sheet stable, its generation-loss ramp remains monotonic
  with more than 128 displayed levels, and deposits/voids are controlled
  independently from repeated-copy softening.
- Paper Texture now has alternating 1/1 woven crossings, irregular yarn
  profiles, visible kraft-liner formation, and a per-resolution Nyquist guard.
- Sumi-e now uses bounded multiscale bast-fibre formation instead of pixel hash
  static, including at the maximum grain setting.
- Source alpha is preserved in all audited modes and sparse saved options use
  current defaults.
- Final verification: 1,955 unit tests passed (179 skipped); lint, typecheck,
  generated-source verification, package build, and app build passed; the app
  bundle limit passed at 554.09 kB; WebGL smoke passed 2,616 cases with 35
  intentional skips across 267 GL filters, 724 compiles, 362 links, and 8,594
  draws.

## References

- Xerox, _Chester Carlson and Xerography_:
  https://www.xerox.com/da-dk/innovation/indsigt/chester-carlson-xerography
- Xerox, _White Spots, Stripes or Random Deletions on Prints and Copies_:
  https://www.support.xerox.com/en-us/article/KB0227266
- Xerox, _Colour Materials Usage Guide_:
  https://download.support.xerox.com/pub/docs/DocuColor_12CP/userdocs/any-os/en_GB/UK_DC12CP_MUG.pdf
- CottonWorks, _Basic Woven Fabric Designs_:
  https://cottonworks.com/learning-hub/weaving/basic-woven-fabric-designs/
- National Diet Library, _Paper conservation by using Japanese paper, washi_:
  https://www.ndl.go.jp/file/preservation/iflapac/pac_faq_wasi_shuhuku_202603.pdf
