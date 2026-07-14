# 049 - Full application dogfood

## Goal

Exercise every user-visible Ditherer workflow in a real browser, including the
VJ/screensaver runtime rather than only its settings dialog. Convert failures
and unprotected critical paths into durable browser coverage.

## Feature matrix

### Source and processing

- First-run onboarding, file input, drag/drop and paste media loading.
- Bundled image/video examples, shared-media URL restoration, playback,
  seeking, stepping, rate, mute, input sizing, fit, and copy-output-to-input.
- Manual/automatic apply, grayscale/gamma preprocessing, output scaling, and
  WebGL/WASM capability toggles.

### Compose and adjust

- Filter and preset discovery, search, categories, favorites/recents,
  capability filters, thumbnails, related presets, add/replace, and details.
- Chain add, duplicate, reorder (pointer and keyboard), enable/disable,
  randomize, reset, remove, clear/undo, saved-chain persistence, and presets.
- Generated control families: range, boolean, enum, text, color, color array,
  palette, curve, preview, actions, conditional options, help, and reset.

### Preview, VJ, and audio

- Dock, float, drag, lock, reset, fit, output-only, compare hold/wipe, and
  output fullscreen modes.
- VJ/screensaver configuration, arming, idle activation, chain cycling,
  optional video cycling, fullscreen entry/exit, and restoration of media,
  scale, timing, and layout state.
- Per-filter, chain, and screensaver audio patch panels; metrics, BPM sync,
  Auto Viz mappings, clear/reset, and visible activity feedback.

### Save, share, and export

- Undo/redo, command palette and keyboard shortcuts, task navigation, theme,
  URL/JSON state sharing/import, save/load/delete chain, and test-media links.
- Image exports for supported formats and sizing paths, with real downloaded
  artifacts.
- Video export modes (realtime, browser-offline, WebCodecs where supported),
  loop/range, audio inclusion, GIF, sequence, contact sheet, cancellation, and
  result save/copy actions.
- WebMCP discovery/read/mutation/export contracts and badge states.

### Resilience and responsive behavior

- Desktop and mobile task layouts, modal focus/keyboard escape, touch target
  reachability, persistence across reload, invalid input, unsupported backend,
  missing media, and export failure messaging.
- No uncaught page errors, serious console errors, stuck overlays, offscreen
  dialogs, or unintended state loss during the workflows above.

## Verification strategy

1. Map each matrix item to authoritative existing unit or browser evidence.
2. Run the complete existing Playwright suite in Chrome as a baseline.
3. Dogfood uncovered runtime paths interactively and capture traces/screenshots
   or downloaded artifacts where visual or file output is the contract.
4. Add focused Playwright scenarios for critical uncovered paths, especially
   VJ activation/restoration and real export completion.
5. Fix discovered defects and rerun the affected tests, complete browser suite,
   typecheck, lint, and production build.
6. Keep this plan open until every item has direct evidence or a documented
   environment capability result; merely opening a panel does not count.

## Completed audit (2026-07-14)

### Browser evidence

- **Source and processing:** `source-ingestion.spec.ts`, `app.workflow.spec.ts`,
  `app.boundaries.spec.ts`, and `testMediaShare.spec.ts` cover onboarding,
  bundled/random/user media, file/drop/paste, URL restoration, video playback,
  stepping, seek/rate/mute, sizing, fit, copy-output-to-input, manual/automatic
  apply, preprocessing, and acceleration toggles.
- **Compose and adjust:** `library-discovery.spec.ts`,
  `project-state.spec.ts`, and `control-inputs.spec.ts` cover ranked discovery,
  categories/capabilities/favorites/recents, filter/preset cross-links and live
  previews, add/replace, chain keyboard and pointer actions, undo, saved chains,
  every generated control family, conditional controls, and the complete
  adaptive-palette add/remove/extract/import/export/save/delete workflow.
- **Preview, VJ, and audio:** `workspace-layout.spec.ts`,
  `ux-workbench.spec.ts`, `vj-mode.spec.ts`, `audio-inputs.spec.ts`, and
  `app.advanced.spec.ts` cover dock/float/drag/lock/reset/fit/output-only,
  compare hold/wipe, contain/cover fullscreen, live VJ activation and exit,
  content/video cycling and restoration, screensaver debug, and per-filter,
  chain, and screensaver Auto Viz mapping controls.
- **Save, share, and export:** `project-state.spec.ts`,
  `export-artifacts.spec.ts`, and `workspace-layout.spec.ts` cover undo/redo,
  commands, theme persistence, JSON and URL round-trips, saved chains,
  byte-verified PNG/JPEG/WebP/GIF/WebM-or-MP4/ZIP artifacts, quality and custom
  resolution, contact sheets, sequence cancellation/retry, range capture,
  browser-offline rendering, and realtime recording.
- **Resilience and responsive behavior:** `resilience.spec.ts`,
  `app.boundaries.spec.ts`, and `ux-workbench.spec.ts` cover malformed JSON,
  failed media recovery, invalid VJ values, unsupported WebGL2, modal focus and
  Escape, focused mobile tasks, reachable dialogs/actions, and no page errors.
- **Shader/WASM runtime:** `gl.smoke.spec.ts` passed 830 cases (250 GL filters,
  133 GL-required filters, 678 compiles, 339 links, and 3,112 draws), while
  `wasm.smoke.spec.ts` loaded the WASM path without fallback noise.

### Capability results

- **Microphone and tab/system capture:** the idle/source/device and mapping UI
  was exercised without granting capture. Native permission/source pickers
  require interactive host devices; bridge behavior is covered by the audio
  unit suite.
- **Clipboard image writes:** this headless Chrome build does not expose the
  async image Clipboard API, so the product correctly hides the conditional
  action. Copy routing and success state are covered in SaveAs component tests.
- **WebMCP:** Chrome 150 with `PLAYWRIGHT_WEBMCP=1` registered all eight tools.
  Live discovery, chain inspection/mutation, preset application, media loading,
  and image/video export workflows passed through `document.modelContext`.
  The unsupported badge/help path and tool error contracts are also covered.

### Defects fixed during dogfooding

1. VJ debug draft was stale and random-video exit lost the original media.
2. VJ video swaps could race and restart after exit.
3. Source-canvas click-to-load targeted a missing file-input id.
4. Structural chain edits were swallowed by slider history debounce.
5. Library live-preview options were discarded on add.
6. Library overlays sat below the canvas workspace and preset-to-filter links
   retained an incompatible query.
7. Audio Auto Viz/BPM controls lacked labels and tall dialogs placed their
   footer offscreen.
8. Floating windows opened underneath the two-row workbench toolbar.
9. SaveAs export ranges lacked accessible labels.
10. Failed media loads and malformed project JSON had no recoverable user
    feedback.
11. Adaptive-palette extraction was mouse-only; swatches did not support Space.
12. WebMCP media loading resolved before the new filtered canvas was ready;
    queued frames from the previous video could also resurrect the old source.
13. WebMCP short static-canvas video exports could report success with a
    zero-byte WebM; explicit opening/closing frames now guarantee real output.

### Follow-up enhancements surfaced

- Add WebMCP chain-editing tools for add/replace/remove/reorder/toggle instead
  of limiting agents to presets and option mutation.
- Return current media/output metadata and expose global input/output settings
  so agents can verify intent without inferring from export results.
- Add cancellable/progress-aware long-running WebMCP exports and preserve
  structured tool errors; Chrome's current experimental host reduces failures
  to a generic `UnknownError`.
- Make the WebMCP npm browser-test shortcut discover a local Chrome 150+ binary
  or document the executable-path requirement alongside the command.

### Final verification

- Playwright Chromium: **25 passed, 2 WebMCP-gated skips** in the default suite;
  those **2 live WebMCP workflows passed** separately in Chrome 150. Media/VJ
  regression tests also passed after source-generation hardening.
- Vitest: **1,330 passed, 155 skipped** across 96 files.
- Shader sweep: **830 passed, 33 intentionally skipped**.
- TypeScript, ESLint, and production Vite build: passed.
