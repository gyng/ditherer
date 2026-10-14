# Pass 11 — spacing scale, Biome style rules, remaining elements, build speed

## Spacing

The CSS used 23 distinct spacing values. 4, 8, 6, 2, 3, 5 and 10px were all
common, plus one-offs such as 7, 9, 11, 13, 17 and 25px. Every `padding`,
`margin`, `gap`, `row-gap` and `column-gap` value now uses the token scale in
`global.css`:

| Token       | Value |
| ----------- | ----- |
| `--space-0` | 2px   |
| `--space-1` | 4px   |
| `--space-2` | 8px   |
| `--space-3` | 12px  |
| `--space-4` | 16px  |
| `--space-5` | 24px  |

Values snap to the nearest step, with ties going to the smaller step to keep
the UI dense (3 and 5 become 4; 6, 7, 9 and 10 become 8). About 560 values
changed across 15 files. Unchanged: 1px hairlines, negative alignment offsets,
`calc()` expressions and large layout values over 25px. Use the tokens for
new spacing.

## Biome style rules

The recommended preset is on alongside the correctness and suspicious
groups, and lint reports no diagnostics.

- **Inline transforms:** most `!important`s existed to beat inline `transform`
  styles that `useDraggable` wrote even when a window was docked or on a
  phone. The hook now writes `--drag-x`/`--drag-y`, and only floating window
  classes apply `translate(var(--drag-x), var(--drag-y))`. The overrides are
  gone. The hook's computed-matrix fallback was dead code and is removed.
- **Save As:** its host was wired to the drag hook, but CSS forced
  `transform: none`, so it could never move. The dead wiring is removed.
- **Thumbnails:** their size moved from an inline style to CSS, so the
  finder's preview resizes them without `!important`.
- **Kept with a justified `biome-ignore`:** the reduced-motion overrides
  (previously duplicated in two files, now one), the busy `wait` cursor and
  the hidden fullscreen cursor all have to beat every component.
- **Rule order:** 20 `noDescendingSpecificity` cases were reordered so general
  rules come before the specific rules that refine them. In the phone block,
  per-step `.app[data-active-task]` rules moved to the end of the block as a
  group. A computed-style diff of 14 surfaces showed no visual change apart
  from nondeterministic rows.

## Elements brought into the system

- Step tabs, command palette rows, and the filter finder's search field and
  clear button use `--control-height-lg`. The finder search no longer has a
  double bevel.
- Title-bar close buttons use `--titlebar-button-size`: 20px square on
  desktop and 44px on phones. The glyph scales with the button.
- Group headers, legends, subsection headers and control labels use the 12px
  `--control-font-size`. Control labels were 10px.
- Library tabs and detail actions use the shared button face. Pressed states
  for the mode switch, toolbar toggles, Compare, Library tabs and chips use
  `--chrome-pressed` instead of inset borders, so toggling does not shift
  layout. Audio patch section headers sit at the control height.

Library list rows (40px thumbnail plus padding) and the finder's category
cards are content cards, not controls, and keep their own height. The audit
reports no other outliers at 1440 or 390px.

## Build speed

`vite build` already takes about 1.2s, and no config change beat the noise.
`npm run check` was faster to improve:

- `typecheck` is incremental (`node_modules/.cache/tsc`). A warm run takes
  about 1.8s instead of 5–7s.
- `check` no longer regenerates the filter library a second time. It runs
  `build:dist` plus the new `build:packed-app:consumer`, after
  `generate:check` has confirmed the generated sources are current.
  `build:packed-app` itself is unchanged for publishing.
- The packed-library consumer install skips npm audit and fund requests.
- Unit tests (`test:coverage`, about 75% of `check`): the 45s option
  conformance sweep is split into six round-robin shard files, so it no longer
  sets the wall time. 74 DOM-free files run in the `node` environment and skip
  jsdom setup. Vitest uses the threads pool. At similar load the run went from
  45s wall and about 520s CPU to 28–31s wall and about 410s CPU, with every
  test passing and coverage within 0.02 points. Sharing modules
  (`isolate: false`) saved only about 10% CPU on pure files, so isolation stays on.

## E2E timeouts

Three `ux-workbench` tests timed out locally at 30s. They opened plain `/`,
which loads and plays the default video with realtime filtering. That kept
the main thread busy, at about 20 long tasks per 2s and roughly 10 fps, so
clicks stalled. The typeahead test also added Black Hole Lens, a temporal GL
filter that animates every frame.

Every test in the file now loads the still `pepper.png` image, and the
recents check uses Posterize. The two monolithic tests are split into
focused ones: desktop docking/compare, desktop modal focus and shortcuts,
mobile task and typeahead, and mobile library. Each test now takes 2.5–4.6s,
down from 22–31s. Two removed steps are covered elsewhere: grayscale undo in
`app.advanced`, and the "Hold before" press in `workspace-layout`. A step
that repeated earlier in-view checks was also dropped. The coverage merge
list includes the two new coverage files.

The spacing snap widened the output window's menu items, so the Screensaver
button wrapped at 1024px. Menu bar items now use 4px side padding.
`library-package.spec.ts` targets the example library server, so the main
Playwright config ignores it; `npm run test:lib` still runs it. The full
Chromium suite passes with 47 tests.
