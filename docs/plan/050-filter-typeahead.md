# 050 — Filter search typeahead

## Goal

Make the inline add/replace-filter combobox feel immediate and legible across a
300+ filter registry without abandoning Ditherer’s compact workstation UI.

## Problems

- Every filter is rendered whenever the popover opens, even before the user
  searches.
- Generic substring filtering gives weak ordering for partial, multi-word, and
  description-based queries.
- Name-only rows make similarly named filters hard to distinguish.
- The popup provides no result count, recent choices, keyboard guidance, or
  clear empty/loading state.
- The narrow fixed popup does not use available desktop space and is cramped on
  touch screens.

## Implementation

1. Build a normalized search index once at module load. Score name, word-prefix,
   category, description, and capability matches, then render only the best
   bounded result set.
2. Keep typing synchronous against the precomputed index and bound result
   rendering so the list never shows stale rows under a newer query.
3. Show recent filters on an empty query and persist selections using the same
   localStorage key as the full Filter Library.
4. Give each result a strong name, category, short description, and concise
   capability markers. Add result-count and keyboard-hint status rows.
5. Preserve cmdk keyboard selection and Radix collision/focus behavior. Ensure
   Escape, arrows, Enter, pointer selection, and trigger refocus remain intact.
6. Use a wider desktop popover and a viewport-safe mobile layout with touch-safe
   rows. Reuse the Filter Library’s hard-edged list rows, selected state,
   capability colors, and workstation chrome so the compact picker feels like
   the same surface at a smaller scale.

## Verification

- Unit-test ranking, token matching, result caps, and recent ordering through
  exported pure search helpers.
- Browser-test add-filter typeahead search, result metadata, keyboard selection,
  and mobile viewport containment.
- Run typecheck, lint, focused tests, production build, and real-browser visual
  inspection at desktop and mobile breakpoints.
