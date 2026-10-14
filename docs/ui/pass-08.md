# Pass 08 — workbench toolbar and perf warning

## Toolbar

A "Layout" label covered Undo/Redo and Commands…, which are not layout
controls. Dock, Float and Output only looked like three separate toggles,
though they are one view choice. Lock and Reset only work on floating
canvases, but they stayed visible in Dock view. "Reset" and "Fit" did not say
what they act on.

The toolbar now has four groups, separated by etched dividers:

- History: Undo and Redo.
- View: Dock, Float and Output only form one segmented control. Compare and
  "Fit input" follow it. Fit is disabled without an image.
- Floating windows: Lock and "Reset positions" appear only in Float view.
- Right side: Commands… shows its `/` shortcut, then Save chain, Share and
  Export…. The duplicate "/ commands · Ctrl/⌘ Z undo" hint is gone from the
  status row.

Groups wrap whole onto a second row when space runs out. Previously the
layout group scrolled and clipped its buttons at laptop widths.

## Perf warning

The sidebar's slow-frame styling and ⚠ icon followed each raw frame time, so
frames jittering around 50ms made them flash. `useSlowFrameWarning` follows a
running average. It warns above 50ms and clears below 40ms. The warning shows
after 1.5s of sustained slow frames and clears after 3s of recovery. One slow
frame or jitter around the threshold no longer toggles it.
