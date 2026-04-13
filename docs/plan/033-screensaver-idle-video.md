## Goal

Extend the output screensaver flow so it becomes an armed idle mode with configurable swap timing and optional random test-video rotation.

## Scope

- Reuse the same seconds/BPM swap configuration pattern for the screensaver button.
- Add screensaver options:
  - chain swap timing
  - random test video toggle
  - video swap interval when enabled
- Arm the screensaver and only start it after 10 seconds of no user input.
- When random test video is enabled during screensaver:
  - rotate random test videos on the configured interval
  - clamp input scale to a max width of 150px for performance
- Restore previous fullscreen/cycle/video-related settings when the screensaver exits.

## Implementation Notes

- Keep swap timing in the shared random-cycle state so URL/export continues to work.
- Add a screensaver config dialog in `App` rather than introducing another global prompt path.
- Track idle arming and active screensaver separately.
- Preserve previous random-cycle interval, fullscreen mode, input source/scale, and screensaver timers so the mode remains temporary.
