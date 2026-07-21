# 061 - UI review and fix loops

## Goal

Run evidence-led review → fix iterations over the complete Ditherer interface
until a fresh audit produces no actionable findings in UI quality, usability,
information architecture, accessibility, or cognitive ergonomics. Preserve the
retro-modern Windows workstation direction established in plan 060.

## Review rubric

Every surface and state is evaluated against the following questions:

1. **Orientation and information architecture** — Can a user tell where they
   are, what belongs here, what the next meaningful action is, and how to move
   backward without remembering hidden state?
2. **Visibility of system status** — Are loading, ready, stale, automatic,
   manual, processing, disabled, error, and completion states timely and
   understandable?
3. **Recognition over recall** — Are labels self-explanatory, important choices
   visible, terminology consistent, and expert shortcuts supplementary rather
   than required?
4. **Action hierarchy and cognitive load** — Is the primary action visually
   dominant? Are utilities and destructive actions separated? Is density
   useful rather than indiscriminate?
5. **User control, recovery, and error prevention** — Can users cancel, undo,
   close, reset, escape, and recover without accidental state loss? Are
   unavailable actions explained rather than merely disabled?
6. **Consistency and mapping** — Do repeated controls, window chrome, section
   headers, selected states, and input/output concepts behave and look alike?
7. **Accessibility and input modality** — Are semantics, names, focus order,
   visible focus, contrast, keyboard operation, target sizes, and touch/scroll
   behavior sound?
8. **Responsive fit and legibility** — Do 1440×900, 1024×768, 768×1024, and
   390×844 layouts avoid clipped primary actions, obscured context, accidental
   document overflow, and nested-scroll traps?
9. **Aesthetic coherence** — Does each surface belong to the same Win98
   creative-workstation system without becoming ornamental, generic, or less
   readable?

## Surface and state inventory

### Core workflow

- First-run quick start and default sample.
- Source: file/drop/paste, examples, image/video tweaks, loading and errors.
- Compose: chain toolbar, stages, add/replace typeahead, presets, library,
  reorder, overflow actions, disabled stages, max-chain state, Apply Chain.
- Adjust: option search, all generated control families, palette/curve/actions,
  pipeline toggles, long filter names, no-match state.
- Preview: output settings, copy-to-input, dock/float/output-only, compare,
  fullscreen, empty/loading/pending/stale/ready states.
- Export: image/video tabs, format-dependent sections, progress, cancellation,
  results, unavailable actions, errors, and close/restore behavior.

### Secondary and expert surfaces

- Global toolbar, live status strip, undo/redo, saved chains, share, Settings,
  command palette, shortcuts, Rainy Day theme, and WebMCP status.
- Filter Library desktop/mobile list/detail paths, filters/presets, categories,
  search, favorites/recents, capability filters, related items, previews.
- Screensaver/VJ configuration and activation.
- Per-filter, chain, and screensaver audio patch dialogs.
- Modal overlays, focus trapping/restoration, scrolling, resizing, and escape.

## Iteration protocol

For each cycle:

1. Inspect rendered screenshots and DOM geometry at all target breakpoints.
2. Walk representative flows with keyboard and pointer/touch-equivalent input.
3. Record only observable findings with severity, rubric category, and evidence.
4. Add a regression test first for behavioral defects or durable layout
   invariants; avoid tests that only pin decorative literals.
5. Fix every actionable finding in scope, then rerun focused verification.
6. Start the next cycle from the rendered product, not from the previous list.

Completion requires a final fresh cycle with no actionable findings, followed
by TypeScript, ESLint, Vitest, focused/full Playwright coverage as appropriate,
production build, and `git diff --check`.

## Review log

Findings and evidence are appended here after each cycle so “no findings” is an
auditable result rather than an impression.

### Cycle 1 — core workflow and responsive frame

- **High · responsive fit / orientation:** widths just above the old 768px
  breakpoint retained the two-canvas desktop workspace while the toolbar grew
  to four rows. At 769px the toolbar was 214px tall and the document was
  1,082px tall. The compact, task-focused layout now applies through 960px.
- **Medium · responsive fit:** the 1024×768 desktop document was 829px tall,
  forcing page scroll around an already scrollable workspace. Desktop chrome
  now occupies a fixed 100vh frame and only the canvas deck scrolls.
- **Medium · recognition / cognitive load:** Compose exposed icon-only
  utilities (`▤`, `★`, `⚭`, `↻`, `×`). The toolbar now names Library, both
  random modes, Cycle, and Clear while retaining the retro glyphs as accents.
- **Medium · accessibility / input modality:** essential compact controls,
  disclosure headers, and output scaling used 20–25px targets. Compact
  navigation, media, section, and preview targets now provide 44px hit areas;
  desktop disclosures, overflow actions, palette swatches, and footer links
  meet the 24px minimum.
- **Medium · consistency / mapping:** static desktop section headings were
  announced as buttons even though they could not collapse. Button semantics
  and keyboard handlers are now conditional on an actually collapsible
  viewport; switching back to desktop also restores static sections.
- **Medium · responsive fit:** the desktop output action row wrapped
  Screensaver below the other canvas commands at 1024px. The compact menu
  sizing keeps all four actions on one row at that width.

Regression evidence: the new Playwright checks first failed at 900px for the
wrong workspace mode, at 1024px for excess document height, and at 390px for a
25px source target. After the fixes, those checks pass. Fresh screenshots and
DOM measurements show exact viewport fit at 1024×768, 900×900, and 390×844.

### Cycle 2 — dialogs, expert tools, and recovery paths

- **High · responsive fit:** Filter Library opened at x=560 with a 984px frame
  on a 1440px viewport, leaving 104px unreachable. Its first position is now
  centered from the live viewport; the measured frame is x=228…1208.
- **High · responsive fit / user control:** the 872px-tall Screensaver editor
  opened at y=124 on a 900px display, hiding its lower content. Its post-mount
  clamp now uses the measured frame; it opens at y=16…888.
- **High · visibility / task completion:** compact Save As and chain-audio
  dialogs were mounted inside the task-hidden canvas deck. Save As now lives
  outside that deck, while hidden canvas tasks preserve overlay descendants;
  both dialogs are visible, focusable, and bounded at 390×844 and 900×900.
- **High · action hierarchy / system status:** a temporal filter on a still
  image selected Video export while retaining an unavailable offline mode,
  producing disabled Save/Copy buttons with no way to generate a result.
  Still-image animation export now begins in realtime mode with an enabled
  Record action.
- **Medium · responsive fit:** mobile Filter Library used content-box 100vw,
  producing a 394px frame in a 390px viewport. Border-box sizing now yields an
  exact 390×844 full-screen dialog.
- **Medium · recognition / responsive fit:** Preview relied on invisible
  horizontal scrolling and clipped “Screensaver.” Its four actions now share
  the available row and remain fully named and visible.
- **Medium · accessibility:** compact clear/cycle modal close buttons lacked
  useful accessible names, and modal actions/number fields used 13–24px hit
  areas. They now have explicit names and 44px controls.
- **Medium · input modality:** ordinary compact workflow, file, section,
  filter-picker, generated option, palette, footer, and dialog controls used a
  mixture of 28–42px targets. Primary and repeated actions now use 44px target
  boxes while inline help retains compact visual chrome.

Regression evidence: dialog-fit, overlay visibility, Record availability,
confirmation semantics, and compact target checks all failed before their
respective fixes and pass afterward. Final cycle-two captures show coherent
desktop Library/Screensaver windows and full-screen mobile Library, Save As,
and audio editors without document overflow.

### Cycle 3 — fresh audit and second-order fixes

- **Medium · accessibility / recovery:** selecting a Library item on mobile
  removed the focused list row when switching to detail view, leaving focus on
  the document. Detail view now focuses “Back to filters/presets,” and Back
  restores focus to the selected row.
- **Medium · responsive fit:** enlarging the stage enable and overflow targets
  exposed the old narrow subgrid columns, visually colliding enable, number,
  and overflow controls. Compact track sizes and control boxes now reserve the
  full targets without overlap or escaping the chain list.

Both defects received browser regressions that failed before their final
fixes and pass afterward.

### Cycle 4 — clean fresh audit

No actionable findings. A new rendered audit traversed Source, Compose,
Adjust, and Preview at 1440×900, 1024×768, 900×900, and 390×844. Every document
matched its viewport, active-task controls stayed inside the viewport, and the
compact target scan found no undersized ordinary controls. Adjust's below-fold
options remained inside the intentional sidebar/task scroller rather than
creating page overflow.

The same pass reopened desktop Library and Screensaver plus mobile Library
list/detail, Save As, chain audio, random-cycle, confirmation, and command
surfaces. Dialog bounds, primary actions, focus transfer/restoration, and
keyboard paths were intact. The complete nine-test UX workbench browser suite
passed after the audit.

## Final verification

- `npm run typecheck` — passed.
- `npm run lint -- --quiet` — passed.
- `npm run test` — 117 files passed, 3 skipped; 1,775 tests passed, 156
  skipped.
- `npm run build` — passed. Vite retained its existing advisory that the main
  and worker chunks exceed the configured size warning threshold.
- App UI Playwright set — 28/28 passed with four workers, covering workflow,
  boundaries, source ingestion, state recovery, exports, UX, VJ/screensaver,
  generated controls, Library, resilience, layouts, audio, and shared media.
- `npm run test:lib` — passed, including generated entries, packed consumer,
  selective-bundle assertion, and its dedicated Chromium smoke test.
- `git diff --check` — passed.
