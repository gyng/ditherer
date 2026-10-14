# Pass 09 — control sizing and spacing system

## Problem

A measurement pass over the Source, Compose and Preview sidebars found 10
different control heights (21–54px) and 5 font sizes (9, 11, 12, 13.3 and
16px):

- 98.css hard-codes `height: 21px` on text fields and selects. Any component
  without its own height was squashed. The filter settings search was 21px
  tall with 7px padding.
- Fields and selects never inherited the UI type size. They used the
  browser's 13.3px default, while buttons used 98.css's 11px.
- Components set their own sizes: enum selects 32px, number fields 22px, the
  Examples ↻ buttons 22px, the toolbar 28px, the media picker 38px and Apply
  Chain 54px. Several fields also added a 2px inset border on top of 98.css's
  sunken shadow, so they had a double bevel.
- The stage number badge was 34px wide in a 30px column, so it touched the
  filter name.
- The filter finder's detail pane changed height with the hovered filter,
  which resized the whole popover.

## System

`global.css` defines the scale:

| Token                 | Desktop | Phone (≤960px) |
| --------------------- | ------- | -------------- |
| `--control-height`    | 24px    | 44px           |
| `--control-height-lg` | 30px    | 44px           |
| `--control-font-size` | 12px    | 14px           |
| `--space-1/2/3`       | 4/8/12  | 4/8/12         |

Zero-specificity defaults (`:where(...)`) give every field, select and button
the control height and type size. Selects reserve 24px for the arrow.
Components opt out only for a deliberate reason, such as the finder's large
search field, patch jacks or the workflow step tabs.

Shared and sidebar controls now use the tokens. That covers enum selects,
number fields, palette search, the settings search, the Examples pickers and
↻ buttons, chain toolbar buttons, Preset, the Add filter trigger, stage rows,
canvas menu bars, comparison controls, audio patch buttons and the reset
controls. Step navigation, the media picker and Apply Chain use the large
height. Fields rely on 98.css's sunken shadow alone.

Button-styled selects (Preset, Examples) use the same raised bevel as
buttons. Chain toolbar rows fill their width, and checkbox settings put "?"
next to the label like other settings. Group labels (File, Examples, Palette)
use the shared group-header type. The finder's results area has a fixed
height, and its preview no longer shrinks.

After the change, sidebar controls measure 24px, primary actions 30px and
step tabs 28px. The tour at 1440 and 390px shows no overflow, clipping,
off-screen controls or undersized phone targets.

## Follow-up audit

A second audit covered all ten surfaces at 1440 and 390px. It checked control
height and font outliers, truncated labels, mixed heights within a row, layout
shifts on hover, keyboard focus rings and six theme families. It found and
fixed:

- **Sizes:** Dock/Float/Output only were 26px because of vertical padding.
  The audio patch "Tap" and "Reset" BPM buttons were 15px tall with 10px
  text, because a more specific rule reset their minimum height.
- **Fields that missed the system:** the screensaver's microphone selects
  were 32px. The command palette search has no `type` attribute, so the field
  rule now covers `input:not([type])`.
- **Leftover 11px text:** canvas menu items, inspector actions, Library chips,
  the mic permission button and the Auto Viz select now use the control size.
- **Save As:** buttons were 25px with a hand-drawn bevel, and pressing one
  added a border, so it shifted. They now use the shared button face, and the
  default action uses the app's primary frame.
- **Phone text:** phone buttons were 13px from a shared phone rule. They now
  use the 14px control size. Phone fields and selects use `--field-font-size`
  (16px) so iOS does not zoom in on focus.
- **Theme colors:** in dark themes, the chain list's hard-coded light colors
  made the active stage name unreadable in Arcade, hid the `⋯` button and left
  a white Add filter strip. Row, hover, active, badge, timing and matched-preset
  colors now come from theme tokens.
- **Focus:** 98.css removes the outline on fields and some selects. Fields and
  selects now share a 2px `--focus-ring` outline on keyboard focus. Tabbing
  through Compose in Win98 and Modern Dark reaches 66 controls, and all of
  them show a focus ring.

Intentional exceptions remain: title-bar close buttons, the filter finder's
large search field and category cards, Library list rows, command palette
rows, step tabs and the patch jacks. A jack's hover `scale()` does not move
the layout.
