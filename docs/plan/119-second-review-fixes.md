# Second repository review

The first review's six commits have been pushed. This pass covers allocation
limits, asynchronous session lifecycle, and remaining export failure paths.

Implement each confirmed issue in a separate commit, beginning with regression
tests:

1. Bound idle canvas retention across dimensions, release evicted bitmaps, and
   include the canvas cache in shared-resource disposal.
2. Prevent overlapping session frames from corrupting temporal state, and
   invalidate in-flight processing when reset, disposal, or chain replacement
   changes the session lifecycle.
3. Count actual encoded frames during cancellation and avoid restarting exports
   that the user cancelled.
4. Always probe video codec support independently of optional audio APIs.
5. Bound video-encoder queues and propagate asynchronous encoder failures through
   the export promise, with cleanup for failed setup and finalization.

Use focused unit tests for each change, followed by the complete unit suite,
project typechecking, lint, source integrity, and library declaration generation.
Production bundling already crashes in native code on the pre-change snapshot;
record that limitation separately from application regressions.

## Validation

All five fixes are implemented with regression coverage. The final unit run
passed 2,405 tests across 175 files, with 183 tests skipped by the existing suite.
Typechecking, lint, source integrity, generated registry checks, library
TypeScript declarations, and formatting of changed files passed.

The video encoder retains at most four pending native encode requests, wakes
blocked producers on dequeue or disposal, and checks callback-based cancellation
while waiting. Codec and muxer output failures reject the caller's next operation;
setup and finalization failures close the encoder and release its staging bitmap.

The existing Chromium video-download check could not reach its local server:
Playwright's localhost probes stalled on both ports 4173 and 4187, and a direct
three-second curl probe also timed out. Those checks were stopped without running
the browser assertions. Production bundling remains unverified because the native
bundler crashes on the pre-change snapshot as well (see the first review).
