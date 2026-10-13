# Patch-panel layout repair

Reproduce the cramped phone patch panel and stretched jack controls. Restore
square socket geometry with explicit minimum dimensions, decouple compact metric
labels/readouts from the desktop four-column grid, and reserve a clear cable
channel. Keep the existing routing and parameter behavior. Verify card content
containment and jack geometry in Chromium on desktop and phone, run audio and
accessibility contracts, and capture both layouts.

## Result

Both socket geometry regressions failed before the fix and pass afterward.
Desktop and compact metric cards now separate names, values, meters and
normalization; sockets have explicit square minimum geometry. Compact cards
reserve a 24px cable channel. Desktop checkbox labels retain sufficient spacing.
Five targeted Chromium contracts pass, including both advanced accessibility
scans and real Auto Viz routing. Lint, typecheck and production build/chunk
budget pass. Routed desktop/phone captures are `docs/ui/screenshots/09-*`.
