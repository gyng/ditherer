# Ditherer UI/UX evaluation framework

## Research basis

- [Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/):
  status visibility, familiar language, control/recovery, consistency, error
  prevention, recognition, efficiency, visual economy, recovery and help.
- [Heuristic evaluation method](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/):
  inspect task flows and record specific problems; iterate after fixes.
- [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/): keyboard access, visible
  focus, labels, contrast, reflow and target sizing.
- [98.css component reference](https://jdan.github.io/98.css/): visual reference
  for bevels, native-looking controls, title bars, tabs and status fields.

## Repeatable protocol

Use a clean browser profile at 1440×1000, 1024×768 and 390×844. Record state,
viewport, screenshot, observed issue, reproduction, severity, proposed fix and
verification. Also inspect keyboard-only navigation and 200% zoom. Separate
expert inspection from real participant testing; do not invent task times or
satisfaction scores.

Tasks: load local/sample image; find and add an effect; adjust parameters;
disable/reorder/delete stages; compare source/output; undo/redo; save image;
export/import project; load and play video; recover from invalid media. Audit
first-use, populated, processing, error, empty, disabled and modal states.

## Assessment dimensions

| Dimension         | Observable evidence                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Task clarity      | Next action and current workflow step visible; labels describe actions                         |
| Feedback          | Loading, selected stage, completion and failure visible                                        |
| Efficiency        | Common actions reachable; search and keyboard routes work                                      |
| Recovery          | Undo, cancel, safe dismissal and actionable errors                                             |
| Accessibility     | Keyboard completion, focus retention, names, contrast, no clipping                             |
| Fidelity          | Gray faces, two-step bevels, navy title gradients, sunken inputs/status, restrained typography |
| Responsive layout | Usable preview and controls, no page overflow, touch targets                                   |
| Consistency       | Shared primitives across every window and dialog                                               |

Severity: 4 = task blocked/data loss; 3 = major difficulty or accessibility
barrier; 2 = recoverable friction or prominent inconsistency; 1 = cosmetic;
0 = no observed issue. Prioritise severity, task frequency and reach. Record
before/after evidence per finding and run relevant existing tests.

## Iteration and diminishing returns

Each pass fixes the highest severity reproducible findings, then repeats tasks.
Stop broad UX iteration only after two consecutive full passes show no open
severity 3/4 findings and remaining changes have low practical impact. This is
an engineering stopping rule, not proof of user satisfaction. Then perform the
requested full design-system audit and broader app review. Reopen any pass when
new evidence exposes a significant issue.

## Modern interaction system

Use [Radix Primitives](https://www.radix-ui.com/primitives/docs/overview/accessibility)
as the interaction foundation: it is unstyled, works with the existing React
stack and provides focus management, keyboard navigation and ARIA patterns.
Adopt/adapt it incrementally across custom dialogs and popovers. Keep cmdk for
search/command discovery. This complements 98.css without imposing a modern
visual skin. GOV.UK patterns offer useful task clarity and error-message guidance,
but its service/form architecture is a weaker fit for an interactive media editor.
Do not reproduce historic Windows constraints such as pointer-only controls,
tiny mobile targets or compulsory nested menus. Audit each migrated surface;
a library alone does not prove accessibility.

## Capture command

Run `UI_SCREENSHOT_PREFIX=03 node scripts/ui-evaluate.mjs` with the local Vite
server running at port 4173. Set `UI_BASE_URL` for another server. Inspect each
image as part of the rubric; the emitted JSON covers overflow and runtime errors
only. Record additional task and keyboard evidence in each pass report.

## Accessibility gate and manual follow-up

Run `UI_AUDIT_PREFIX=03 node scripts/ui-accessibility-audit.mjs` with Vite running.
It records violations and incomplete/manual-review targets for five surfaces on
desktop and phone. `test/e2e/ui-accessibility.spec.ts` gates automated WCAG A/AA
checks and protects collapsed-content access, native button activation, export
tabs and zoom-equivalent reflow. Review incomplete targets explicitly, including
contrast on gradients/images and modal focus guards. Zero automated violations
alone does not prove conformance or usability.

The capture runner includes a 720×500 CSS viewport at device scale 2 to represent
1440×1000 at 200% zoom. This tests equivalent reflow; it does not simulate every
browser/OS zoom behavior.
