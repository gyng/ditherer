# 041 - CRT worker WebGL repair

## Goal

Restore `CRT emulation` after filter dispatch moved entirely into the browser
worker. The CRT renderer must use WebGL2 from either an `HTMLCanvasElement` on
the main thread or an `OffscreenCanvas` in the worker.

## Plan

1. Add a real-browser smoke assertion that sends `rgbStripe` through the same
   worker RPC used by the app and verifies that the output is transformed.
2. Make the CRT renderer allocate both its WebGL surface and readback surface
   with the canvas implementation available in the current execution scope.
3. Run the focused Playwright GL smoke suite, TypeScript diagnostics, and the
   production build.
