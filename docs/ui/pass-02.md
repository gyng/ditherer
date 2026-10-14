# Pass 02 — modern interaction and control fidelity

## Evidence and changes

Windows 98 appearance now comes from pinned 98.css primitives plus app token
adaptations. Native checkbox label support was adapted to wrapped labels, with
classic sunken boxes and black checks. Dropdown faces use background-color so
the system arrow survives local colors. Default buttons retain raised chrome;
primary actions regain visible borders. Mobile prose and controls use Tahoma
rather than scaling the 11px desktop pixel font.

Fresh and invalid saved layouts now open docked, keeping both images visible.
Saved floating/output preferences still work. A browser regression test failed
on the previous implementation and passes on the new one.

The shared WindowDialog now uses Radix Dialog for layered Escape dismissal,
focus containment and assistive-technology isolation. Explicit preferred focus
and restoration preserve existing flows. The topmost-dialog Escape regression
failed with the previous global listener and passes with Radix. Dialogs retain
their retro visual chrome and draggable placement.

## Build stack upgrade requested by the user

Updated compatible dependency ranges: Vite 8.3.4, React/ReactDOM 19.3.0,
React plugin 6.1.2, Playwright 1.64.0, Vitest/coverage 4.1.11 and transitive
patches. Updated Oxfmt to 0.73.0. npm audit reports zero vulnerabilities.
Lightning CSS still crashes on a one-rule stylesheet and on the upgraded Vite
build. Vite's supported esbuild CSS minification passes; minification and the
JavaScript chunk budget remain enabled. This is a compiler backend change,
not a move away from Vite. (Later traced to a corrupted local
binary and reverted; see plan 123.)

## Verification

- Typecheck, lint and production build/chunk budget passed after migration.
- Full Vitest suite: 2,409 passed, 183 skipped; 176 files passed, 3 skipped.
- 12 targeted Chromium tests passed: controls, workflow UX, floating/docked
  layout, phone targets, library keyboard navigation and modal restoration.
- Three additional Chromium workflows passed: main workflow, boundary recovery,
  project keyboard editing/state/JSON/share round-trips.
- Source, Compose, Preview and Export captures at 1440×1000, 1024×768 and
  390×844 reported zero runtime errors and no page-level horizontal overflow.
  See `screenshots/02-*.png` and the repeatable screenshot runner below.

## Repeatable visual inspection

With `npm run dev -- --host 127.0.0.1 --port 4173` running:

```sh
UI_SCREENSHOT_PREFIX=03 node scripts/ui-evaluate.mjs
```

The script uses clean contexts, loads a known sample image, waits for rendered
output, captures four workflow steps and the library at three viewports, and
writes overflow/runtime measurements. Screenshots require human/agent visual
inspection; measurements alone do not prove task usability or accessibility.

## Remaining evaluation work

This is meaningful improvement, not diminishing returns. Next inspect keyboard
completion, 200% zoom, first-use discovery, error/empty/processing states and
all export paths. Audit main action hierarchy and avoid exposing engine detail
in ordinary choices. Then repeat the full rubric. Only after measured gains
taper off perform the queued app-wide design-system audit and general review.
