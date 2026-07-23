# 102 — Unified GL readout canvas ownership

## Status

Complete.

## Objective

Unify WebGL readback canvases with the chain's existing canvas pool so released
outputs are actually reused, canvas state cannot leak across owners, and nested
Mavica readbacks do not become abandoned allocations.

## Findings

- `readoutToCanvas` acquires from a private GL pool, but no production caller
  invokes `releaseReadoutCanvas`; dispatchers return superseded outputs to the
  separate generic pool instead. The GL pool therefore records allocations but
  cannot record reuse.
- The generic pool does not reject duplicate releases and hands reused canvases
  back with prior pixels and drawing state intact.
- Mavica creates pre-JPEG, JPEG, and final GL readouts. Its intermediate
  readouts are consumed synchronously but never released, and the final readout
  is copied into another canvas without being returned.

## Implementation

1. Make `readoutToCanvas` acquire from the generic pool and leave one explicit
   owner: the chain dispatcher for returned output, or the filter for an
   intermediate readout.
2. Reset canvases when acquired, reject duplicate releases, and expose generic
   allocation/reuse/release diagnostics. Preserve GL-specific readout counters
   by observing whether the unified acquisition allocated or reused.
3. Release Mavica's pre-JPEG and JPEG readouts immediately after texture upload,
   and release its final GL readout after copying to the owned output canvas.
4. Add unit contracts for clearing, duplicate-release safety, and allocation
   plateau, plus a Chromium contract proving repeated GL/Mavica renders reuse
   canvases without further readout allocation.
5. Scope Mavica's nested readouts and copied final output with `try/finally`
   cleanup, deduplicating identity aliases so context-loss and copy failures
   cannot strand or double-release canvases.

## Acceptance

- One release function and one pool own all 2D filter/readout canvases.
- Reused canvases are blank with reset drawing state and cannot be checked out
  twice because of a duplicate release.
- After warm-up, repeated same-size GL and Mavica renders do not increase the
  readout allocation counter and do increase reuse counters.
- Focused tests, TypeScript, lint, and the complete Chromium WebGL gate pass.

## Outcome

- WebGL readouts and ordinary filter canvases now share one reset-on-checkout,
  duplicate-safe pool with allocation, reuse, and release diagnostics.
- Mavica and JPEG transfer or release every intermediate through identity-safe
  exception scopes; browser contracts prove allocation plateaus and recovery
  after injected failures.
- Exact-tree release gates passed: 2,193 Vitest tests (180 skipped), 34 Rust
  tests, lint, TypeScript, package validation, packed/library/application
  builds, and the library consumer's real-Chromium import/render contract.
- The complete Chromium WebGL registry gate passed 2,706 cases (35 skipped)
  across 267 GL filters and 158 required-GL filters, with 732 compiles, 366
  links, and 9,618 draws.
