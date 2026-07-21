# 068 — Filter finder redesign

## Problem

The compact filter typeahead exposes more than 300 filters as a mostly flat,
bounded list. Its empty state mixes recents with arbitrary category examples,
capability labels are terse, and arrow keys on a closed replacement control can
mutate the active chain before the user opens or confirms a choice. The result
requires recall, creates accidental-action risk, and makes browsing difficult.

## Design direction

Treat the control as a compact **filter finder** that fits Ditherer's desktop
workbench aesthetic. Preserve fast type-to-search behavior while adding
progressive disclosure and an explicit information scent:

1. State whether the action will add a stage or replace a named stage.
2. Keep global search first and focused on open.
3. Make the no-query state a browse landing page with recent filters and
   category cards showing catalog counts and representative examples.
4. Once searching or browsing a category, use a stable two-pane layout: a
   scannable result list and a selected-result explanation with full
   description, category, control count, and plain-language capabilities.
5. Commit only on click or Enter. Arrow keys may navigate inside the open list,
   but must never replace a filter while the chooser is closed.
6. Retain a compact single-column mobile layout with 44 px minimum targets,
   bounded height, readable type, and no viewport overflow.

## Cognitive and interaction principles

- Prefer recognition over recall through named categories and examples.
- Use progressive disclosure: category overview first, detailed list second.
- Keep selection and activation distinct so exploration is reversible.
- Reduce visual competition in result rows; move explanations into a stable
  detail pane rather than repeating tiny truncated descriptions.
- Preserve spatial stability while keyboarding so focus and explanatory text
  change without moving the list or applying side effects.
- Expose system status continuously: result count, active scope, total catalog
  size, current filter, and available keyboard actions.

## Implementation

1. Refactor `FilterCombobox.tsx` around explicit landing, category, search, and
   empty states.
2. Remove preview-on-arrow replacement behavior from the closed trigger and its
   ChainList integration.
3. Rework the CSS module into a responsive two-pane finder that remains native
   to the existing Ditherer chrome.
4. Expand component and Playwright coverage for safe keyboard behavior,
   category browsing, search ranking, recents, viewport bounds, and selection.
5. Validate visually at desktop and compact widths, then run lint, typecheck,
   focused tests, the production build, and the repository check command.

## Acceptance criteria

- Opening without a query explains the add/replace action and exposes every
  filter category with a count.
- Users can reach a category's filters without inventing a search term.
- Search remains global, ranked, bounded, highlighted, and keyboard operable.
- Arrow keys on a closed trigger do not mutate the chain.
- Click and Enter commit exactly one filter and update recents.
- The selected result has a readable, stable explanation before commitment.
- Desktop and compact layouts remain inside the viewport with accessible
  labels, focus, status announcements, and touch targets.
