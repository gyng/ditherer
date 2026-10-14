# Pass 12 — filter finder category tabs

Categories in the filter finder used to be a separate page. With an empty
search, it showed a grid of category cards. Picking one replaced the grid with
that category's list, and "← Categories" returned to the grid. Switching from
Dithering to Glitch took two clicks and a page change, and typing a search
hid the categories entirely.

Categories are now a tab strip under the search field: Recent (when there are
recent filters), All, then each category, each with a count. The results list
and preview pane are always visible.

- **Opening:** replacing a filter opens on its category. Otherwise the finder
  opens on Recent, or on All when there are no recent filters.
- **Search:** typing ranks matches across all filters on the All tab. Each tab
  shows its match count, greyed when zero. Picking a tab narrows the matches,
  for example "3 matches in Simulate · 5 in all". An empty narrowed result
  offers "Search all categories".
- **Keyboard:** the tabs follow the ARIA tabs pattern, with roving tabindex
  and Left/Right/Home/End. The results area is the tab panel. The list keeps
  ↑↓ and Enter.

The category-card page, the back button and 167 lines of their CSS are gone.
The always-visible status label is darker to meet contrast. Unit and e2e
tests cover tab selection, search narrowing, arrow keys and Recent.

Screenshot: `screenshots/15-finder-tabs.png`.
