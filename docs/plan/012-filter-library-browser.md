# 012 — Filter Library Browser

## Goal
Replace the cramped add-flow with a large, searchable browser where users can quickly:
- browse all filters
- browse all presets
- add a filter to the active chain
- load a full preset chain

## Scope
- Add a new `LibraryBrowser` modal in `src/components/ChainList/`.
- Wire launch buttons into `ChainList` toolbar and add row.
- Reuse existing chain actions (`chainAdd`, preset load logic) to avoid behavior drift.
- Preserve existing combobox flow for quick single-add use.

## UX
- Two tabs: `Filters` and `Presets`.
- Search input in both tabs.
- Category list + item list + detail panel layout.
- Desktop and mobile responsive behavior.
- Keyboard close via `Esc`.

## Notes
- Keep visual language aligned with current retro window styling.
- This is additive; no filter/preset data model changes required.
