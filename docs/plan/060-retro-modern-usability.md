# 060 - Retro-modern usability pass

## Goal

Make the shipped workbench feel deliberate and immediately operable without
discarding its Windows 98 identity. Preserve square geometry, bevelled chrome,
navy title bars, Tahoma typography, compact workstation controls, and the
desktop/window metaphor while bringing hierarchy, legibility, focus treatment,
and responsive behavior up to modern expectations.

## Evidence from the current UI

Desktop and 390px browser captures show that the task-focused information
architecture works, but several presentation choices still make the app feel
like an internal tool:

- the native file input is the main Source action even when media is loaded;
- every toolbar action has equal visual weight, so Export, workflow navigation,
  layout utilities, and history compete with each other;
- the sidebar identity, task card, and onboarding card use unrelated visual
  treatments rather than reading as one application shell;
- focus styling is drawn inside controls and can be hard to see against bevels;
- status data is a single terminal-like sentence rather than scan-friendly
  groups;
- the gray workspace has little contrast with the silver application chrome;
- terse random-example labels (`Img?` and `Vid?`) require interpretation;
- desktop density is useful, but the 320px sidebar and small supporting text
  make primary decisions harder to scan than they need to be.

## Design direction

Treat Ditherer as a late-1990s creative workstation upgraded by a careful
modern product team:

- classic teal desktop with a subtle drafting grid;
- cool silver panels and hard one-pixel/two-pixel bevels;
- navy-to-cyan title bars for identity and active context;
- Tahoma for interface copy and Courier for machine/status readouts;
- blue selection, warm yellow guidance, green ready lamps;
- no rounded-card dashboard language, glass effects, or generic SaaS styling.

## Requirements

### Application shell and hierarchy

- Turn the sidebar identity into recognizable application chrome with a title,
  workstation descriptor, and consistent title-bar treatment.
- Give the desktop sidebar an adaptive, readable width without crowding the
  two-canvas workbench.
- Make the active workflow task unmistakable in both the top navigator and
  sidebar context panel.
- Establish primary, secondary, and utility action treatments. Each task pane
  should have one obvious forward action.
- Keep all existing commands, labels used by automation, and keyboard behavior.

### Source workflow

- Replace the visible native file control with an explicit media action and a
  drop/paste surface; retain the real file input for browser and accessibility
  behavior.
- Show the current source name when available.
- Make example image/video selection flexible at narrow widths and give random
  actions unambiguous accessible names.

### Workbench and feedback

- Separate application chrome from the canvas desktop with a recognizable teal
  workspace while retaining the grid.
- Strengthen canvas-window edges and elevation without soft shadows or rounded
  modern cards.
- Group live status metrics visually while retaining their terse machine-readout
  language.
- Improve visible hover, focus, active, and disabled states across controls.

### Responsive behavior

- Keep the five-task navigator persistent and touch-safe on mobile.
- Keep Source, Compose, and Adjust as single scrollable panes and Preview as the
  canvas-first pane.
- Avoid horizontal document overflow at 390px and preserve safe-area behavior.
- Keep dense desktop behavior at 1440px while making the primary workflow
  readable without zooming.

## Verification

- TypeScript and ESLint pass.
- Focused Vitest component/control tests pass.
- Existing Source and UX Playwright workflows pass in real Chromium.
- Desktop Source/Compose/Adjust/Preview captures at 1440x900 show no overlap,
  clipped primary actions, or unintended document-width overflow.
- Mobile Source and Preview captures at 390x844 show reachable task navigation,
  media actions, and canvas controls without horizontal overflow.

## Follow-up audit

After this foundation lands, dogfood the filter library, Save As, command
palette, screensaver, and audio patch windows against the same hierarchy and
interaction rules. Do not declare the broader usability objective complete
until those secondary surfaces are visually and behaviorally consistent too.

## Implementation and completion audit (2026-07-21)

### Shipped changes

- Added a cohesive application identity window, adaptive desktop sidebar, teal
  drafting-grid desktop, stronger canvas-window elevation, and shared semantic
  color tokens for the default and Rainy Day themes.
- Added distinct primary actions for onboarding, media choice, Apply Chain,
  workflow progression, and Export while keeping all secondary and utility
  commands in place.
- Replaced the visible native file field with a labelled choose/drop/paste
  surface that reports the current media name. The native input remains in the
  accessibility tree and retains file-picker, keyboard, drop, paste, and test
  behavior.
- Made example selectors flexible and replaced ambiguous `Img?` / `Vid?`
  controls with compact repeat controls carrying explicit accessible names.
- Strengthened active workflow, pressed layout, hover, focus, disabled, and
  status-metric presentation without rounding or flattening the Win98 chrome.
- Made Save As an opaque, elevated application window with a bounded content
  surface and primary-action treatment.

### Browser defects found and fixed

1. Entering mobile Preview focused the output window with normal browser scroll
   behavior. The workspace moved 55px and hid the title bar under the sticky
   task navigator. Output focus now uses `preventScroll`, and a browser test
   asserts that the title starts below the navigator.
2. Save As inherited only a bevelled border and no background, making its body
   transparent over the canvas desktop. The dialog and tab body now render an
   opaque silver surface, protected by a computed-style browser assertion.

### Completion evidence

- Desktop Source, Compose, Adjust, Preview, Filter Library, Save As, command
  palette, screensaver, and audio patch surfaces were inspected at 1440x900.
- Mobile Source, Preview, and Filter Library were inspected at 390x844. Source
  and Preview both reported `scrollWidth === clientWidth`; Preview remained at
  `workspace.scrollTop === 0` after navigation.
- Focused Chromium UX suite: 7 passed, covering onboarding, source ingestion,
  task hierarchy, library reachability, layout/compare/fullscreen, Save As,
  theme persistence, and the core combined workflow.
- Vitest: 1,775 passed and 156 skipped across 120 files.
- TypeScript, ESLint, production Vite build, and `git diff --check`: passed.

The secondary-surface audit found the Filter Library, command palette,
screensaver, and audio patch windows consistent with the updated shell. Save As
was the sole visual contradiction and was fixed above. The original usability
goal is therefore satisfied without replacing the established workstation
visual language.
