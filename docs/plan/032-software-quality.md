# 032 - Software quality

## Summary

Improve Ditherer's software quality by strengthening the safety net, typing the highest-risk runtime boundaries, decomposing a small set of oversized modules, and burning down known regression debt. The goal is not "maximum purity." The goal is to make future changes safer, easier to review, and easier to ship.

This is a staff-level quality plan, not a single patch plan. It is intentionally staged so that each tranche improves the repo on its own and also reduces risk for the tranche that follows.

## Status

Status as of 2026-04-13:

- Workstream 1 is complete
- Workstream 2 is materially complete at the core-boundary level, but the full strictness ratchet is not
- Workstream 3 is complete for source-of-truth cleanup and registry enforcement, with only non-essential decomposition left on the table
- Workstream 4 is substantially complete, with skip debt reduced and targeted orchestration coverage added
- Workstream 5 is only partially complete because the repo still does not compile under `noImplicitAny` / full `strict`

The quality initiative succeeded in its highest-leverage goals:

- one enforced local/CI quality bar now exists via `npm run check`
- coverage is enforced rather than observed
- filter-export metadata is the source of truth for runtime capability decisions
- the core runtime seams are typed instead of relying on broad `any`
- the filter authoring contract is standardized through `defineFilter(...)`
- the browser WASM path now has a real end-to-end smoke test

The remaining work is now concentrated rather than diffuse:

- complete the TypeScript strictness ratchet
- retire the remaining justified skips in `test/smoke/filters.test.ts`
- add a small amount of higher-level parity coverage where it buys real confidence

## Context

Ditherer is already in a solid operating state, and this initiative materially improved the safety of future change:

- `npm run lint` passes
- `npm run typecheck` passes
- `npm run test` passes
- `npm run test:e2e:wasm` passes
- `npm run check` passes
- CI now runs the same primary quality bar used locally

The quality problem is not that the repo is obviously unhealthy. The quality problem is that several behavior-critical seams are still weakly typed, partially enforced, or concentrated in very large modules. That means the current snapshot is healthy, but the *cost and risk of future change* are higher than they need to be.

## Problem statement

The project currently pays quality tax in four places:

1. core boundaries are weakly typed
2. enforced automation is narrower than the real code surface
3. a few hotspot files carry too much behavior
4. some known regression debt is documented but not yet retired

These issues compound. Weak typing makes monoliths harder to split. Narrow CI makes refactors less trustworthy. Duplicated behavior metadata makes correctness depend on memory instead of structure. Skipped tests quietly normalize exceptions.

## Evidence

### Weak typing in core boundaries

- [`tsconfig.json`](/home/g/p/ditherer/tsconfig.json:7) has `"strict": false`
- [`eslint.config.js`](/home/g/p/ditherer/eslint.config.js:17) disables `@typescript-eslint/no-explicit-any`
- [`src/context/filterContextValue.ts`](/home/g/p/ditherer/src/context/filterContextValue.ts:3) exports `createContext<any>(null)`
- [`src/context/useFilter.ts`](/home/g/p/ditherer/src/context/useFilter.ts:4) returns `state`, `actions`, `filterList`, and `grayscale` as `any`
- [`src/workers/workerRPC.ts`](/home/g/p/ditherer/src/workers/workerRPC.ts:3) uses `any` for worker request/response handling
- [`src/context/FilterContext.tsx`](/home/g/p/ditherer/src/context/FilterContext.tsx:355) runs the central execution path with loose typing

### Incomplete enforcement of the intended quality bar

- [`package.json`](/home/g/p/ditherer/package.json:10) lints only `src/`
- CI in [`ci.yml`](/home/g/p/ditherer/.github/workflows/ci.yml:18) does not run `npm run typecheck`

### Oversized hotspots

Largest files at audit time:

- `src/components/SaveAs/index.tsx` at ~2.8k LOC
- `src/components/App/index.tsx` at ~1.1k LOC
- `src/context/FilterContext.tsx` at ~1.0k LOC
- `src/filters/index.ts` at ~0.9k LOC

### Duplicated source of truth

- [`src/context/FilterContext.tsx`](/home/g/p/ditherer/src/context/FilterContext.tsx:350) uses `filter.mainThread` as the runtime source of truth
- [`src/components/SaveAs/index.tsx`](/home/g/p/ditherer/src/components/SaveAs/index.tsx:130) keeps a separate hard-coded `TEMPORAL_FILTERS` set

### Explicit known regression debt

- [`test/smoke/filters.test.ts`](/home/g/p/ditherer/test/smoke/filters.test.ts:48) skips some special-case filters
- [`test/smoke/filters.test.ts`](/home/g/p/ditherer/test/smoke/filters.test.ts:178) keeps a linearize skip list
- [`test/smoke/filters.test.ts`](/home/g/p/ditherer/test/smoke/filters.test.ts:205) notes known deferred linearize bugs

## Goals

- Make behavior-critical paths more compiler-assisted
- Make the enforced quality bar match the team's intended bar
- Reduce review and regression risk in the highest-change modules
- Replace duplicated capability logic with shared metadata
- Convert known skipped debt into either enforced behavior or explicit tracked debt

## Non-goals

- Do not attempt a repo-wide rewrite
- Do not require full TypeScript strictness in one step
- Do not fully type every filter before improving the core runtime
- Do not replace broad smoke coverage with brittle snapshot-heavy tests
- Do not add process that does not materially improve correctness or velocity

## Decision

We will improve quality in five ordered workstreams:

1. strengthen the safety net
2. type the core boundaries
3. decompose hotspots and remove duplicate logic
4. burn down targeted regression debt
5. ratchet standards upward

This order is deliberate.

- Detection comes first because it lowers risk for every later change.
- Boundary typing comes before decomposition because typed seams make extractions safer.
- Decomposition comes before stricter standards because structure should improve before we tighten the screws.
- Debt burn-down becomes more valuable once the surrounding architecture is easier to test.

## Guiding principles

- Prefer staged ratchets over all-at-once cleanup
- Bias toward high-leverage infrastructure over low-leverage polish
- Keep one source of truth for filter capability metadata
- Pair refactors with stronger automation
- Make each phase independently shippable

## Proposed architecture direction

### 1. Treat quality gates as product infrastructure

The repo should have one canonical "this must pass" command. CI should run that same bar or a clearly defined subset with no surprises. Quality rules should cover the code people actually modify, including tests and scripts.

### 2. Treat type boundaries as first-class interfaces

The core state/context/worker/export seams should have explicit types that are designed, shared, and reused. We should stop relying on ad hoc `any` across the most important runtime boundaries.

### 3. Treat metadata as the system of record

Filter capability decisions should flow from filter metadata, not hand-maintained name lists. Runtime execution, export decisions, and validation should all derive from the same facts.

### 4. Treat large modules as decomposable systems, not personal style issues

The goal is not to make files small for aesthetics. The goal is to separate concerns so behavior can be changed, typed, and tested in tighter units with clearer ownership.

## Workstreams

## Workstream 1 - Safety net

### Objective

Make repository-enforced checks match the actual quality expectations for day-to-day development.

### Scope

- add a canonical `npm run check`
- expand lint coverage to `test/` and `scripts/`
- add `npm run typecheck` to CI
- enforce coverage as part of this initiative

### Deliverables

- updated `package.json` scripts
- updated CI workflow
- coverage configuration

### Success criteria

- local and CI validation are aligned
- typecheck becomes an enforced gate
- non-`src` code no longer sits outside the lint bar
- coverage is enforced rather than merely observed

### Status

Complete.

Landed:

- canonical `npm run check`
- lint coverage for `src`, `test`, `scripts`, and `vite.config.js`
- CI execution of `npm run check`
- enforced Vitest coverage thresholds

### Why now

This is the lowest-risk, highest-leverage first move. It improves trust in every later change.

## Workstream 2 - Core boundary typing

### Objective

Make the runtime seams that carry the most behavior also carry the strongest compiler guarantees.

### Scope

- define shared types for:
  filter definitions, chain entries, reducer actions, serialized share state, worker RPC payloads, and the context value
- type `FilterContext`, `useFilter`, reducer actions, and worker request/response handling end to end
- replace `any` first in:
  `src/context/*`, `src/reducers/filters.ts`, `src/workers/*`, `src/components/SaveAs/*`
- move the repo to a materially stricter TypeScript baseline as part of this initiative, including `noImplicitAny` and the strictness changes needed to support it

### Deliverables

- shared type definitions
- reduced `any` usage in core runtime modules
- stricter TypeScript configuration enabled

### Success criteria

- context and reducer APIs are strongly typed
- worker payloads have explicit contracts
- new core code does not add fresh implicit `any`
- orchestration refactors produce useful compiler guidance
- the repo no longer depends on relaxed TypeScript settings to keep core code compiling

### Status

Mostly complete, with the strictness ratchet still open.

Landed:

- shared types for filter definitions, registry entries, reducer state, reducer actions, worker RPC payloads, share-state payloads, and public context actions
- typed `FilterContext`, `useFilter`, reducer actions, worker boundaries, and WebMCP bindings
- typed filter authoring through generic `FilterDefinition` and `defineFilter(...)`
- full rollout of `defineFilter(...)` across actual filter exports
- broad replacement of `options: any = defaults` and other core-boundary `any` usage

Still open:

- `tsconfig.json` still has `"strict": false`
- the repo still has enough remaining explicit and implicit `any` that `noImplicitAny` and full `strict` are not yet safe one-step flips

### Why now

This work pays for itself repeatedly. It makes later refactors safer and shortens the feedback loop on mistakes in the most important code.

## Workstream 3 - Hotspot decomposition and source-of-truth cleanup

### Objective

Remove correctness drift caused by duplicated behavior logic and reduce hotspot complexity only where it materially improves safety.

### Scope

- replace hard-coded capability lists with metadata taken from filter exports
- enforce registry correctness in code and typecheck, so runtime/export/worker drift is caught automatically
- split `FilterContext` into focused helpers only where it materially improves correctness, typing, or testability
- avoid decomposition work whose main benefit is cosmetic file-size reduction

### Deliverables

- shared capability helpers driven by filter-export metadata
- stronger registry validation at code/typecheck level
- targeted helper extraction where it improves correctness or testability

### Success criteria

- export/runtime capability checks come from filter-export metadata
- registry drift is caught automatically in development
- adding a new temporal filter requires minimal hidden bookkeeping
- any decomposition that lands improves correctness or testability, not just file size

### Status

Complete for the main quality goals.

Landed:

- filter exports are now the source of truth for capability metadata
- duplicated temporal capability logic was removed from `SaveAs`
- registry invariants are enforced in tests and type-level contracts
- targeted helper extraction and shared typing reduced drift across context, controls, registry, and export paths

Deferred by design:

- broad cosmetic decomposition of `SaveAs`
- large-scale file splitting whose primary benefit would be line count reduction

### Why now

Typed seams make metadata cleanup and targeted extraction safer. The emphasis here is correctness and enforceability, not broad module surgery.

## Workstream 4 - Regression debt burn-down

### Objective

Turn currently documented weak spots into enforced, verified behavior.

### Scope

- remove the known linearize skip list by fixing the listed filters and making the tests required
- add integration tests for:
  share-state round-trips through `FilterContext`
  worker/main-thread parity on representative chains
  `SaveAs` behavior for temporal filters, video input, and export fallback logic
- add one golden-path fixture test for offline export orchestration
- review the remaining skip inventory and keep only the ones that remain justified after engineering review

### Deliverables

- fewer skipped smoke/integration checks
- new orchestration-level tests
- explicit inventory of any intentionally deferred cases

### Success criteria

- known linearize debt is retired or explicitly tracked
- worker and main-thread execution agree on representative cases
- export routing decisions are covered above helper level
- skipped tests become exceptional again

### Status

Substantially complete, with a smaller justified skip tail remaining.

Landed:

- stale linearize skip debt was retired for `Channel separation`, `Jitter`, and `Scanline`
- share-state encoding round-trips are covered
- `SaveAs` offline timeline and audio reconciliation logic are covered
- the browser WASM path now has a dedicated Playwright smoke test
- React/Vitest warning noise and WASM fallback spam were removed from the normal test path

Still open:

- the remaining smoke skips in `test/smoke/filters.test.ts` still need either targeted fixes or explicit long-term justification
- representative worker/main-thread parity coverage could still be improved

### Why now

This phase becomes more effective once the surrounding code is easier to type and reason about. It is about depth in the right places, not raw test count.

## Workstream 5 - Standards ratchet

### Objective

Raise the steady-state quality bar in a way the team can actually keep.

### Scope

- promote selected ESLint rules from warning to error
- complete the stricter TypeScript transition started in Workstream 2
- rely on enforcement in code, tests, and CI rather than adding contributor-process documentation

### Deliverables

- tighter lint/type rules
- explicit enforced quality bar in code and CI

### Success criteria

- stricter rules land without emergency cleanup churn
- the higher bar is maintained by defaults, not memory
- quality expectations are discoverable from the repo's enforced checks

### Status

Partially complete.

Landed:

- the enforced repo bar is now discoverable and executable through `npm run check`
- the codebase is materially more type-safe at the critical seams than it was at audit time

Still open:

- promote additional lint rules once the remaining `any` inventory is lower
- complete the TypeScript strictness ratchet so `noImplicitAny` and `strict` can be enforced without destabilizing the repo

### Why last

Standards are easiest to ratchet once the architecture and tooling have already been prepared for them.

## Alternatives considered

### Alternative A - Turn on full strictness immediately

Rejected for now.

Why:

- high churn
- low focus
- likely to produce a long cleanup tail
- does not by itself address monoliths or duplicated logic

### Alternative B - Decompose large files first

Rejected for now.

Why:

- large untyped extractions are riskier than typed extractions
- without stronger gates, it is easier to regress behavior while splitting

### Alternative C - Focus only on more tests

Rejected as the primary strategy.

Why:

- tests help, but they do not replace typed seams and aligned automation
- the repo already has strong breadth; the bigger win is targeted structural safety

## Resolved decisions

### 1. Coverage is in scope to enforce, not just observe

- this initiative should drive coverage upward as part of the quality bar
- the plan should optimize for achieving the desired coverage state, not for preserving a low starting threshold

### 2. Strictness is part of this initiative

- stricter TypeScript settings are part of the plan, not a future maybe
- the work should move the repo to the stricter baseline needed for sustained quality

### 3. Registry correctness should be enforced in code and typecheck

- registration drift should be caught by compile-time and code-level checks
- process and memory are not the control mechanism

### 4. Filter exports are the source of truth for capability metadata

- runtime execution, export logic, and validation should derive from filter-export metadata
- duplicated capability name lists should be removed

### 5. `SaveAs` decomposition is not a primary goal

- do not pursue broad `SaveAs` decomposition for its own sake
- extract only where it materially improves correctness, typing, or testability

### 6. Skip retention is an engineering judgment inside this effort

- retire the skips that can be retired
- keep only the skips that remain justified after review

### 7. Do not add contributor-process documentation

- quality should be enforced through code, tests, and CI
- this plan does not add new contributor checklist or process docs

### 8. Sequencing is real, but parallel execution is allowed

- the workstreams remain ordered for clarity
- they are not hard blockers when multiple tranches can advance safely in parallel

## Rollout plan

This section now serves as an execution record rather than a proposal.

### Tranche 1

- add `npm run check`
- add `npm run typecheck` to CI
- lint `test/` and `scripts/`
- enforce coverage as part of the quality bar

Status: complete

### Tranche 2

- type `FilterContext`
- type `useFilter`
- define shared context/reducer/worker contracts
- move the repo to the stricter TypeScript baseline required by this initiative

Status: partially complete

### Tranche 3

- replace `SaveAs` hard-coded temporal filter logic with shared metadata
- enforce registry correctness in code and typecheck
- extract `FilterContext` helpers only where it improves correctness or testability

Status: complete for the intended quality outcomes

### Tranche 4

- remove the known linearize skip list
- add worker/main-thread parity and export-routing integration tests

Status: partially complete

### Tranche 5

- promote stable lint rules
- finish any remaining strictness cleanup needed for the enforced baseline

Status: not complete

## Execution order

1. Workstream 1
2. Workstream 2
3. Workstream 3
4. Workstream 4
5. Workstream 5

## Resourcing model

This work can be done incrementally alongside feature delivery.

- Workstream 1 fits comfortably in a small foundational PR
- Workstream 2 is best handled as a focused infra tranche
- Workstream 3 should be split into multiple PRs by module boundary
- Workstream 4 can proceed in parallel once the relevant seams stabilize
- Workstream 5 should happen only after the earlier work has settled

## Risks and mitigations

### Risk: type work becomes noisy churn

Mitigation:

- type boundary-first, not repo-wide
- move strictness upward as part of the initiative in controlled tranches
- keep strictness ratchets incremental even if the destination is part of this plan

### Risk: decomposition adds abstraction but not clarity

Mitigation:

- split by behavior and ownership
- extract only where a stable seam becomes clearer
- prefer plain helpers over generic frameworks

### Risk: coverage goals drive low-value tests

Mitigation:

- use modest floors
- focus coverage expectations on infrastructure, not every filter
- prioritize orchestration tests over superficial snapshots

### Risk: duplicated metadata survives in edge paths

Mitigation:

- centralize capability helpers on filter exports
- use tests to verify runtime/export parity for representative cases

## Success metrics

This plan is working if:

- CI enforces the same primary validation command used locally
- type errors catch real orchestration regressions before runtime
- new temporal filters do not require duplicated export/runtime bookkeeping
- common changes touch fewer giant files
- skip lists shrink instead of growing

## Implementation checklist

### Immediate

- [x] add `check` script
- [x] expand lint scope
- [x] add typecheck to CI
- [x] enforce coverage as part of the quality bar

### Near-term

- [x] define shared core types
- [x] type `FilterContext`
- [x] type `useFilter`
- [x] type worker RPC payloads
- [ ] move the repo to the stricter TypeScript baseline required by this initiative

### Mid-term

- [x] replace hard-coded temporal capability lists with shared metadata
- [x] enforce registry correctness in code and typecheck
- [x] split `FilterContext` helpers where it improves correctness or testability
- [x] reduce registry maintenance burden in `src/filters/index.ts` through stronger code-level enforcement

### Later

- [~] retire linearize skip debt
- [~] add parity and export-routing integration tests
- [ ] promote selected lint rules
- [ ] finish any remaining strictness cleanup needed for the enforced baseline

Legend:

- `[x]` complete
- `[~]` partially complete
- `[ ]` still open

## Notes

- This plan intentionally favors infrastructure quality over exhaustive, high-fidelity verification for all ~160 filters.
- The filter library already has good breadth coverage; the bigger opportunity is correctness around state, workers, serialization, export, and runtime capability decisions.
- The stricter TypeScript baseline is part of this initiative, but it should still be reached through staged preparation rather than a single giant flip.
- The major remaining work is now a follow-on strictness tranche rather than a broad quality-foundations effort.
