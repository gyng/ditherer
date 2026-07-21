# 069 — Uncommitted Batch Hardening

## Scope

Review and harden the uncommitted hardware-simulation filters and filter-finder
redesign. Preserve unrelated existing work and stop only after a complete review
pass produces no actionable findings.

## Review loops

1. **Simulation contracts and backends**
   - Audit filter metadata, registry/loader generation, temporal declarations,
     WebGL availability behavior, option sanitization, and resource lifetimes.
   - Compare shader behavior with the pure codec contracts and add focused
     regressions for any uncovered invariant.
2. **Algorithm and edge-case correctness**
   - Exercise invalid options, tiny and extreme aspect-ratio canvases, temporal
     warm-up/hold behavior, palette degeneracy, and deterministic output.
   - Run the real-browser GL release gate and the focused codec suite.
3. **Finder interaction, IA, and accessibility**
   - Review add versus replace semantics, keyboard-only use, focus return,
     category/search transitions, empty states, recent-item handling, and mobile
     layout.
   - Convert any reproduced issue into a durable component or browser test.
4. **Independent clean pass**
   - Re-read the final diff without relying on the earlier findings, run static
     and full-project gates, and record a clean pass only when no new issue is
     found.

## Verification gates

- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`
- `npm run build`
- `npm run test:gl`
- affected Playwright workbench suite
- `git diff --check`

## Outcome

Round one found and resolved:

- ZX Spectrum FLASH was running at half the ULA cadence. It now swaps every
  16 hardware frames (a 32-frame / approximately 0.64-second full cycle), with
  a pure timing contract.
- Inline filter replacement was mouse-only. Stage names are now real buttons,
  expose a replacement label, and restore focus after Escape or selection.
- Arrow-key opening skipped the normal shared-recents refresh and did not
  expose a stable popup relationship. Keyboard and pointer opening now share
  one initialization path and `aria-controls` targets the finder dialog.
- Category browsing was incorrectly labelled as globally ranked search. Its
  A–Z ordering is now explicit.

Round two found no additional simulation, registry, shader, temporal-history,
finder, mobile-layout, or accessibility issues. The independent final diff and
verification pass also produced no new findings.
