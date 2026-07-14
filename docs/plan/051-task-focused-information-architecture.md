# 051 - Task-focused information architecture

## Problem

Ditherer exposes five workflow steps in the workbench toolbar, but on desktop
those controls only change their selected styling. Source selection, chain
composition, parameter tuning, output configuration, global settings, and
performance feedback remain in one long sidebar. The visual sequence and the
interaction model therefore disagree, increasing choice overload and forcing
users to remember where each control lives.

Mobile already presents one task at a time, but the underlying state is named
and styled as a mobile-only concern. It also lacks a strong orientation cue or
a guided route to the next task.

## Cognitive design principles

- **Progressive disclosure:** show controls for the current decision, while
  keeping expert navigation one click away.
- **Recognition over recall:** pair every task with a step number, goal, and
  short description instead of relying on terse tab labels alone.
- **Stable spatial context:** change the sidebar contents without moving or
  scrolling the canvas workbench. Make the sidebar its own scroll container.
- **Clear closure:** give each task a Back/Next affordance and return from the
  export dialog to Preview, where users can verify the result.
- **Match the user's mental model:** Compose owns chain structure, Adjust owns
  parameters and pipeline toggles, and Preview owns output configuration.
- **Layered expertise:** keep global Settings available as a collapsed,
  secondary section rather than mixing it into the primary workflow.

## Implementation

1. Promote the task state from a mobile-only mode to a workbench-wide state.
2. Add shared task metadata for numbered navigation, pane headings, concise
   descriptions, and previous/next actions.
3. Apply task visibility rules on desktop and mobile while retaining the
   existing mobile preview canvas behavior.
4. Separate chain composition from parameter/pipeline adjustment and place
   output scale/configuration in Preview.
5. Make the desktop sidebar viewport-bound and independently scrollable so
   switching tasks cannot push docked canvases out of view.
6. Route every export entry point through one action and restore Preview when
   the dialog closes.

## Verification

- Desktop browser coverage asserts that Source, Compose, Adjust, and Preview
  expose only their relevant primary surfaces while both canvases stay put.
- Mobile coverage continues to assert one-pane-at-a-time behavior.
- Export coverage asserts consistent entry and return behavior.
- Run TypeScript diagnostics, focused Vitest/Playwright tests, lint, and the
  production build.

## Non-goals

- Redesigning the established workstation visual language.
- Reorganizing filter option declarations or changing processing behavior.
- Hiding global Settings from experienced users.
