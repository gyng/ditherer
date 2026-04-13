## 035 — Auto Viz Patch Panel

### Goal

Add an `Auto Viz` workflow to the shared audio patch panel so users can quickly generate musical modulation routings without manually patching every metric and parameter.

### Scope

- Add a few curated auto-mapping modes.
- Generate explicit patch-panel connections with randomized weights and light variation.
- Reuse the same auto-mapping UI for filter-level, chain-level, and screensaver audio patch panels.
- Keep generated mappings constrained to a small number of visually meaningful parameter targets.

### Modes

- `Balanced` — one transient, one low-end, one tonal, one optional tempo motion.
- `Punchy` — beat-focused, with stronger transient and bass mappings.
- `Flow` — smoother tempo and tone-driven modulation.
- `Chaotic` — more onset/flux/percussive motion and occasional inversions.
