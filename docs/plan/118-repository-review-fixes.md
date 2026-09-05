# Repository review fixes

Implement the six review findings as separate commits:

1. Restore the 50 NUL-filled working files from intact HEAD blobs and add a
   standalone source-integrity check. Restoration matches Git's existing content;
   the tracked change is the check and this recovery record.
2. Select decoded range frames using absolute source time while preserving
   relative output timestamps.
3. Pass the selected range's start offset through to audio sample extraction.
4. Discard partial encoders before retrying export with browser seeking.
5. Close decoded frames and decoders on success, cancellation, and failure.
6. Declare filter history requirements and avoid unused snapshots/EMA work in
   both runtime and worker execution, preserving worker previews and compatibility
   for custom filters without declarations.

Add regression tests before each behavior fix. Validate with focused Vitest
suites, project typechecking, formatting/lint, and the production build. History
changes also require registry coverage and worker/runtime tests so conditional
history consumers cannot silently lose their state.
