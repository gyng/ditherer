# 015 — Preset Consolidation

## Why

The built-in chain preset list in `src/components/ChainList/index.tsx` has grown enough that a few problems are showing up:

- some presets are very close to each other in visual intent
- some presets share the same base filter stack and differ only by small option changes
- preset identity/matching is still mostly based on filter display-name order, not option-aware equivalence
- this makes cleanup harder and can produce misleading descriptions when two chains use the same filter names but different options

This pass should reduce picker clutter, keep the strongest preset ideas, and make preset matching more accurate.

## Current Redundancy Buckets

These are the main clusters worth auditing first:

- Motion-analysis family
  - `Motion Compass`
  - `Optical Flow`
  - `Traffic Trails`
  - `Vector Blueprint`
  - `Heat Vision`
  - `Activity Map`
  - `Frame Diff`
- Temporal-exposure family
  - `Ghost`
  - `Light Painting`
  - `Lucid Dream`
  - `Shutter Smear`
- Scene-separation family
  - `Empty Room`
  - `Living Photo`
  - `Virtual Greenscreen`
- VHS / retro-monitor family
  - `Retro TV`
  - `VHS Pause`
  - `Glitch VHS`
  - `Retro Monitor`
  - `Surveillance`
- Bloom-plus-chromatic stylization family
  - `Neon`
  - `Night City`
  - `Cyberpunk`
  - `Rainbow Vortex`
  - `Psychedelic`

Not all of these are duplicates, but they are the highest-value places to trim overlap and sharpen naming.

## Goals

- remove exact duplicate presets
- reduce near-duplicate presets that land on almost the same look
- keep one canonical preset per strong visual idea
- preserve genuinely different presets even when they share a base filter family
- make built-in preset description matching option-aware
- add regression protection so duplicate presets do not quietly return later

## Plan

### 1. Normalize preset data

Convert `CHAIN_PRESETS` to a fully object-based representation:

```ts
type PresetFilterEntry = {
  name: string;
  options?: Record<string, unknown>;
};
```

Even presets with no custom options should use `{ name: "Bloom" }` rather than a bare string. This gives us a single consistent shape for comparison, matching, and future metadata.

### 2. Add canonical preset signatures

Create a small helper near the preset definitions, or in a tiny shared utility, that:

- normalizes every entry to `{ name, options }`
- sorts option keys recursively into a stable form
- serializes a chain into a canonical signature

Example behavior:

- same filters, same options, same order => same signature
- same filters, different options => different signature
- same filters, different order => different signature

This signature becomes the basis for:

- duplicate detection
- preset lookup for description display
- future validation tooling

### 3. Improve preset matching

Replace the current built-in preset matcher in `ChainList` with a signature-based matcher.

Today it only checks:

- chain length
- display-name order

It should instead compare:

- normalized filter names
- normalized option payloads

This prevents a custom `Motion Vectors` chain from being mislabeled as `Motion Compass` just because the display-name sequence matches.

### 4. Audit and merge exact duplicates

Use the new signature helper to detect:

- exact duplicate built-in presets
- exact duplicates hiding under different names/categories

For each exact duplicate set:

- keep the strongest name
- delete the weaker duplicate
- preserve the better description

### 5. Trim near-duplicates by family

Review the high-overlap clusters and keep a smaller set of presets with clearly distinct intent.

Recommended consolidation direction:

- Motion-analysis family
  - keep distinct presets for `arrows`, `trails`, `heat`, and `difference`
  - likely keep: `Motion Compass`, `Traffic Trails`, `Heat Vision`, `Frame Diff`
  - likely fold or rename: `Optical Flow`, `Vector Blueprint`, `Activity Map`
- Temporal-exposure family
  - keep one canonical ghost/trail preset and one canonical shutter/max-light preset
  - likely keep: `Ghost`, `Shutter Smear`
  - likely fold: `Light Painting`
  - likely keep `Lucid Dream` only if it remains visually distinct enough from `Ghost`
- Scene-separation family
  - keep one preset per mode because these are genuinely different user intents
  - keep: `Empty Room`, `Living Photo`, `Virtual Greenscreen`
- VHS / retro-monitor family
  - keep separate presets only if each owns a clearly different story:
    - degraded tape playback
    - CRT persistence
    - surveillance feed
  - likely keep: `VHS Pause`, `Retro TV`, `Surveillance`
  - likely fold or rename: `Glitch VHS`, `Retro Monitor`

These recommendations should be validated visually during implementation, but they provide a strong first cut.

Refined first implementation cut:

- remove `Optical Flow` as a top-level preset and keep `Motion Compass` + `Traffic Trails` as the motion-vector showcase presets
- remove `Light Painting` as a separate top-level preset and keep `Ghost` + `Shutter Smear` as the clearer temporal-exposure anchors
- remove `Glitch VHS` as a separate top-level preset and keep `VHS Pause` + `Retro TV` as the stronger tape-display stories
- defer deeper visual pruning in the neon / cyberpunk cluster until after the signature-based matcher lands, since those are stylistically close but still use different filter structures

### 6. Tighten naming and descriptions

After merging, rewrite surviving preset names/descriptions so each one communicates a distinct outcome quickly.

Guidelines:

- avoid multiple presets that all read as “retro glitch screen”
- avoid names that describe implementation rather than appearance
- prefer one memorable preset per look over several minor variants

### 7. Add tests

Add a focused test file for preset helpers, covering:

- canonical signature stability
- option-aware preset matching
- duplicate detection guard for built-in presets

At minimum, the duplicate guard should fail if two presets produce the same canonical signature.

## Implementation Order

1. add normalization + canonical signature helpers
2. migrate preset matching to signatures
3. add tests for signature and matching
4. prune exact duplicates
5. prune near-duplicates and rename survivors
6. run `npm run lint`, `npm run typecheck`, and targeted Vitest coverage

## Success Criteria

- built-in preset descriptions are matched by names plus options, not names alone
- exact duplicate presets are removed
- the preset list is shorter and easier to scan
- each remaining preset has a distinct user-facing visual story
- automated tests prevent duplicate signatures from being introduced again
