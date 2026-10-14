# Pass 10 — CSS correctness lint and remaining UI items

## Biome CSS lint

Biome 2.5.15 now lints `src/**/*.css` as `npm run lint:css`, which is part of
`npm run lint`. Only the `correctness` and `suspicious` rule groups run.
Formatting stays with oxfmt, and style rules such as `!important` and
selector ordering are off. It found:

- The busy-cursor `timer` keyframes repeated `33.333%`, so one clock face
  never showed and `83.333%` was missing. All twelve faces now run in order.
- `.PIXELATED` set `image-rendering: crisp-edges` after `pixelated`, which
  overrode it in Firefox. Only `pixelated` remains.
- The desktop grid's first `linear-gradient` began with a `var()` color
  stop. It now names `to bottom` explicitly.
- `src/styles/style.module.css` contained only a comment and nothing imported
  it. It was removed.

## UI items left open by earlier passes

- **Apply Chain:** with auto apply on, the button only re-runs a chain the
  output already follows. In that mode it is a secondary button and is no
  longer pinned to the bottom of the phone screen. In manual mode it stays the
  primary, pinned action.
- **Library thumbnails:** rows waiting in the render queue showed dark
  shimmer boxes. They now show the unfiltered source, greyed and dimmed, until
  the real thumbnail renders. The placeholder is computed once per source.
- **Audio patch section headers:** longer names such as "Loudness &
  transient" wrapped to 40px in narrow columns. Headers stay on one line with
  an ellipsis, and the full name is in the tooltip.
- **Arcade theme view toggles:** these now measure 24px. The toolbar padding
  fix in pass 09 covered them.
