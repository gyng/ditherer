# Pass 07 — post-98.css surface review

A scripted tour captured Source, Compose, Preview, the filter typeahead, Filter
Library, command palette, Screensaver, Save As, the stage actions menu and a
loaded preset at 1440×900 and 390×844. Each capture was inspected visually. The
page was also checked for overflow, clipped text, off-screen controls,
interactive overlap, phone targets under 24px and selects without a dropdown
arrow.

## Findings and fixes

| Sev | Finding                                                                                                                                                                         | Fix                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | The stage `⋯` menu was a 4-column grid of nine unlabeled glyphs (`~`, `◉`, `x`). The toggle moved into the popover, and the menu stayed open after an action or outside click.  | Labeled vertical menu with icons. The toggle stays in the row. The menu closes after actions, on Escape (focus returns to `⋯`) and on outside clicks. |
| 2   | Each dialog styled its own close button. Glyphs were `x` or `✕`, desktop sizes varied, and phone sizes were 15×15, 16×44 and 22×24.                                             | Shared `controls.titleClose`: 18×16 on desktop and 44×44 on phone, used by all seven title bars. Library close gains an accessible name.              |
| 2   | Phone mode tabs (Media / Visualisation / Slideshow) were 21px tall.                                                                                                             | 44px on phone, matching the other phone controls.                                                                                                     |
| 2   | 98.css pins the select arrow to the top. On taller selects (Preset, Examples, phone) it floated. The output scaling and Auto Viz selects reset `background` and lost the arrow. | Arrow is vertically centered globally, and those two selects keep the image.                                                                          |
| 1   | Fixed-width step tabs clipped "Compose", and its number badge was squashed.                                                                                                     | Tabs size to their content, and the badge no longer shrinks.                                                                                          |
| 1   | Source showed "Input Tweaks" twice (section header and legend). The "Input" heading sat flush against the step tabs.                                                            | Removed the duplicate legend (fieldset keeps the name). Heading spacing matches Compose.                                                              |
| 1   | The typeahead said "331 total" while All listed 330. The total counted the None filter.                                                                                         | Total excludes None.                                                                                                                                  |
| 1   | Library search was 21px tall on phone.                                                                                                                                          | 44px on phone.                                                                                                                                        |

Opening the menu also closes that stage's replace finder. Previously both
popovers could be open at once, and the finder covered the menu.

The menu items' visible text names the action. Each item's accessible name
still includes the stage, for example "Reset Floyd-Steinberg to defaults".

## Remaining observations

- The phone status strip clips its last field ("fps") at 390px.
- Patch group toggles in the audio panel are 24px tall on phone. That meets
  WCAG 2.5.8 but is smaller than the other phone controls.
- Library thumbnails render lazily, so the first rows of a fresh library show
  placeholders briefly.

After the fixes, the tour reports no page overflow, clipping, off-screen
controls or arrowless selects. The only remaining audit items are the
visually hidden file input and the library's horizontally scrolling category
chips.

Screenshots: `screenshots/11-*`.
