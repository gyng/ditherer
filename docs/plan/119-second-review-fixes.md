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
