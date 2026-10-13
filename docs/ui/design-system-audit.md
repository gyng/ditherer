# App-wide design-system audit

## Adoption contract

98.css 0.1.21 supplies the classic control geometry, pixel font and assets.
App tokens adapt those primitives; Radix provides modern modal, popover and tab
interaction. Desktop remains a Windows 98 workbench, with larger touch targets
and Tahoma on compact layouts. Classic title gradient's bright endpoint is
slightly darker for 4.62:1 white-text contrast. The default is the classic theme;
other existing opt-in themes continue to use the same structural primitives.

## Inventory and findings before fixes

| Surface                   | Inventory                                                        | Finding/action                                                                  |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| App identity/workflow     | Title, modes, task navigation                                    | Centralize title treatment; retain actual task actions                          |
| Source/output windows     | Frame, title, menu, compare, loading/errors                      | Single-line titles with accessible full name; share frame/bevel tokens          |
| Controls                  | Range, checkbox, select, text, palette, color, curve, help/reset | Reuse upstream assets and central bevels; shared option/section header tokens   |
| Chain editor              | Actions, editable list, preview, confirmation/cycle dialogs      | Normalize title chrome, selected/hover states and headers                       |
| Full library              | Tabs, categories, search, rows, preview/options, footer          | Replace hard-coded title colors; compose shared section headers                 |
| Typeahead/commands        | Search results, details, shortcuts                               | Keep modern search; normalize chrome and group-header typography                |
| Export/JSON/input dialogs | Frame, title, tabs, form, actions, progress                      | Same system chrome; preserve accessible Radix behavior                          |
| Screensaver/VJ            | Draggable dialog, presets, start/stop, readout                   | Replace independent modal keyboard contract with shared primitive               |
| Audio mapping/Auto Viz    | Draggable dialog, meters, devices, patch panel                   | Same modal primitive, title/header tokens; instrument graphics remain domain UI |
| Settings/themes           | Disclosure, checkbox, theme select, metadata                     | Shared section typography; validate selected states and theme consistency       |

Audit must inspect normal, hovered, focused, selected, disabled, error and
processing states, at desktop and phone sizes. Run relevant real-browser
contracts and automated accessibility scans after fixes; screenshot the broader
windows as the major milestone. The queued general review follows this audit.

## Fixes and verification

- Added shared raised, pressed and sunken bevel tokens and a canonical window
  frame. All custom window/dialog frames now compose the shared primitive.
- Reconciled title gradients through theme tokens, normalized title text, and
  made canvas titles single-line with full filenames in their tooltip.
- Section/option headers now compose the canonical controls typography in
  disclosures, library options, chain labels, audio input and filter discovery.
- Removed inactive window-control decorations from the app banner.
- Audio and screensaver dialogs now use the shared Radix modal contract,
  retaining draggable placement, native background isolation and focus return.
- Added inert background isolation for modal sibling regions, including live
  region containers, and validated background access resumes after dismissal.
- Fixed the finder landing input's missing ARIA-controlled result list. The
  collapsed landing combobox becomes the cmdk suggestion input when results
  exist; keyboard search/add and focus restoration remain covered.
- Fixed selected category/capability/list hover contrast, low-contrast hints,
  clipped audio fields and BPM controls, and compact audio checkbox spacing.
- Replaced hard-coded metadata colors with theme-aware tokens where needed;
  representative Rainy Day and modern-dark compose scans report no violations.

The expanded browser gate checks audio, screensaver, commands, typeahead and
confirmation on desktop and phone, in addition to the five main surfaces.
`07-surfaces.json` and `screenshots/07-*` record this milestone. Audio, typeahead,
confirmation, screensaver and command captures were visually inspected. Final
inspection caught a command palette behind the output canvas: the overlay now
has the modal stacking level and shared chrome. `08-surfaces.json` and
`screenshots/08-*` show the corrected milestone with zero violations on all ten
advanced surface/viewport combinations. A browser hit-test protects pointer
access above the canvas.
The classic theme is the fidelity reference. Optional existing skins retain
their own colors and control shapes; zero scans are not a universal WCAG claim.

The queued broader app review follows. Low-impact metadata and clipboard
findings from pass 05 remain explicit review items rather than being dropped.
