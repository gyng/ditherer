# 046 - UX workbench overhaul

## Goal

Scale Ditherer’s retro desktop interface to its current filter library without
discarding the compact icon language. The result should be task-oriented,
keyboard-accessible, touch-safe, recoverable, and comfortable on both desktop
and mobile while retaining the Windows workstation character.

## Requirements

### Accessible window system

- Build one shared dialog/window primitive with dialog semantics, labelled
  titles, initial focus, focus trapping, Escape handling, focus restoration,
  viewport clamping, and reduced-motion support.
- Migrate Filter Library and Save As first, then reuse it for other blocking
  configuration windows where appropriate.
- Turn Filter Library into a full-screen mobile browser with explicit list and
  detail views plus a fixed Add/Load footer.

### Workbench information architecture

- Organize the product around Source, Compose, Adjust, Preview, and Export.
- Use a docked, collision-free preview workspace by default on desktop; keep an
  optional floating-window mode with reset, fit, output-only, side-by-side, and
  lock controls.
- Replace the mobile nested-scroll split with one primary pane at a time and a
  persistent task navigator.
- Consolidate Save Chain, share link, JSON, and file export into a global
  Save/Share/Export surface.
- Rename Test Media to Examples and progressively disclose raw fixture lists.

### Controls and feedback

- Keep the existing compact icons, but give them accessible names, clear focus
  states, and touch-safe hit areas.
- Associate every generated input with a real label and expose help through a
  keyboard/touch-accessible description.
- Humanize option names and group active-filter controls into Essentials,
  Advanced, Palette, and Animation sections.
- Replace oversized palette/theme native selects with searchable, grouped
  selection including favorites and recent choices.
- Rename Filter to Apply Chain and show automatic/stale/processing status near
  the preview with backend, resolution, and timing information.
- Improve typographic hierarchy, contrast, selected states, and reduced-motion
  behavior without flattening the retro visual design.

### Recovery and power-user enhancements

- Add bounded undo/redo for chain, preset, option, palette, and global pipeline
  mutations using serialized state snapshots.
- Add before/after hold and split-wipe comparison.
- Add favorites, recently used items, related presets, and capability filters
  to the library.
- Add a visible shortcut reference and command palette.
- Add first-run guidance through load example, choose preset, adjust, export.
- Surface slow-filter/performance guidance before costly operations.

## Delivery phases

1. Shared dialog semantics, control labels/help, contrast, and touch targets.
2. Library mobile flow and global Save/Share/Export surface.
3. Docked desktop workspace, mobile task navigation, layout commands, and
   preview comparison/status.
4. Inspector grouping, searchable palette selection, favorites/recents, and
   library capability filters.
5. Undo/redo, command palette, shortcuts, onboarding, and performance guidance.
6. Unit, integration, accessibility-contract, responsive, and real-browser
   verification at desktop and touch breakpoints.

## Input refinement pass

- Give every atomic setting the same scan order: label and help, primary input,
  then a local reset-to-default action.
- Keep exact range entry permanently visible beside the slider, constrain it to
  the declared range, and preserve cancel/commit keyboard behavior.
- Visually separate adjacent settings without turning the inspector into a
  stack of oversized cards; retain the compact workstation density.
- Make boolean rows and input targets comfortable to operate by touch while
  keeping labels, help, and reset actions distinct.

## Explicit non-goal

Do not replace the compact toolbar icons in this plan. Improve their semantics
and hit areas while preserving their current visual vocabulary.
