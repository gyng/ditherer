# Restore deployment after selective history allocation

GitHub Pages publishes successful CI runs on `master`. The first review left the
worker browser contract expecting input and EMA snapshots from every filter,
contradicting the new per-filter history requirements. CI therefore skipped Pages.

1. Reproduce the stale browser-contract expectation with a mocked worker response
   that retains only declared history, while keeping step previews.
2. Make the contract verify declared input/EMA presence and buffer sizes, preserve
   output and second-frame checks, and reject missing required snapshots.
3. Run focused regression tests and static checks, commit, push to `master`, and
   follow GitHub CI and Pages through the exact commit deployed.
