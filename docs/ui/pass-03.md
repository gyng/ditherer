# Pass 03 — keyboard, recovery, export and accessibility

## Findings and fixes

| Finding                                                                                            | Severity | Result                                                                                          |
| -------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Collapsed Settings children remained focusable and exposed to assistive technology                 | 3        | Collapsed content uses hidden; open controls remain available                                   |
| Still-image export defaulted to Video because a temporal-capability badge was treated as animation | 2        | Image is default for still sources; video and actively running animation still default to Video |
| Export tabs lacked arrow navigation and panel relationships                                        | 3        | Radix Tabs owns roving focus, selection and tab-panel semantics                                 |
| Chain shortcuts consumed Space on nested action buttons                                            | 3        | Shortcuts run only when the chain itself has focus; native actions work                         |
| Listbox options contained interactive controls and an invalid add row                              | 3        | Chain uses list/listitem and current-stage semantics; add controls are a separate group         |
| Low-contrast metadata and selected library hover text                                              | 3        | Darker metadata; selected hover retains navy background and white text                          |
| Small/closely spaced desktop chain, palette and checkbox targets                                   | 2        | Increased target spacing and minimum sizes without enlarging the checkbox graphic               |
| Phone status strip could scroll but lacked keyboard access                                         | 3        | Focusable strip with visible focus                                                              |
| A few labels on generic elements were unsupported                                                  | 2        | Number badge, add/action groups and WebMCP status use appropriate roles                         |
| Export format wrapper shrank to its text width and lacked arrow clearance                          | 2        | Form field fills available space; shared dropdowns reserve arrow padding                        |

Regression tests reproduced collapsed content, incorrect export default,
missing tab navigation and consumed Space before fixes. Existing chain tests
were updated for corrected list semantics; editing, reorder, toggle, delete and
state round-trip behaviors remain covered.

## Evidence

- Full Vitest suite: 2,412 passed, 183 skipped (176 files passed, 3 skipped).
- 14 UX/accessibility Chromium tests passed, including two automated WCAG scans
  spanning Source, Compose, Preview, Export and Library on desktop and phone.
- Eight export/accessibility browser tests passed, including real PNG, JPEG,
  WebP, contact-sheet PNG, GIF, video and ZIP artifacts and cancellation/retry.
- Four recovery/accessibility tests passed, including missing media, invalid
  project JSON, invalid screensaver settings and unavailable WebGL.
- Production build and JavaScript chunk budget, lint and typecheck passed.
- `screenshots/03-*` capture desktop, laptop, phone and 200% equivalent reflow
  (720×500 CSS pixels rendered at device scale 2). All four workflow steps had
  no runtime errors and no page-level horizontal overflow.
- `03-accessibility.json` contains the automated scan and manual-review targets.
  `scripts/ui-accessibility-audit.mjs` repeats the scan. The browser test is
  included in the repository's browser-coverage command.

## Manual-review limits

Axe does not resolve gradient/image backgrounds or icon-only contrast. In the
captured classic theme, short title labels occupy the navy portion; black
control text is on light faces and selected library text on navy. Partially
obscured content in a scroll panel must be inspected after scrolling. Modal
backgrounds and Radix focus guards are flagged for review because they are
aria-hidden while focusable in the DOM; browser tests verify focus containment
and restoration. Automated zero violations is not WCAG certification.

## Next pass

Continue the rubric with explicit keyboard task completion, manual contrast
checks across long titles and state variants, and recovery/empty/processing
states. This pass removed several substantial problems, so diminishing returns
has not been established. After two stable full passes, perform the requested
app-wide design-system audit, then the broader app review.

The additional media/audio/VJ workflow sweep passed those paths. The library
state assertion was updated to close the modal before querying background
controls, because Radix correctly hides background controls from the accessible
tree while the modal is open.
