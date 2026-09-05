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

## Validation

All six fixes are implemented. The full unit run passed 2,379 tests (183 skipped).
A final compatibility refinement also passed the 24 focused history/runtime/worker
tests. Project typechecking, library declaration generation, lint, source
integrity, and generated catalog checks passed.

Production bundling crashes in native code after transforming 653 modules. The
same crash reproduces on the recovered pre-change snapshot, outside the sandbox,
and with both installed Node 26 and Node 24 runtimes. Production build validation
therefore remains blocked by this pre-existing tooling failure.
