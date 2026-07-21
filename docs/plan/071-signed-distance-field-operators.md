# 071 — Signed-distance-field operators

## Objective

Turn the existing SDF support into a reusable, correct image-space field and
add three effects that expose different strengths of the representation:

1. **SDF Boolean Sculpt** — combine a source-derived silhouette with an
   analytic primitive using union, intersection, subtraction, and smooth
   union.
2. **SDF Medial Axis** — reveal the silhouette skeleton from discontinuities
   in the nearest-boundary feature transform.
3. **SDF Flow Warp** — use the field gradient and its perpendicular tangent as
   a source-aware vector field for normal, tangent, and vortex displacement.

## Research basis

- Rong and Tan's jump-flood algorithm computes approximate Voronoi diagrams
  and distance transforms in parallel on the GPU with logarithmically stepped
  neighbourhood propagation.
- Green's distance-field texture work demonstrates that one stored scalar
  field can support threshold offsets, outlines, soft edges, glow, and other
  programmable-shader effects.
- Euclidean distance transforms and their feature transforms provide the
  nearest boundary origins used to detect medial-axis loci.
- Signed distance conventions make Boolean composition direct: minimum for
  union, maximum for intersection, and maximum with a negated operand for
  subtraction.

Primary references:

- <https://www.comp.nus.edu.sg/~tants/jfa/i3d06-submitted.pdf>
- <https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf>
- <https://perso.liris.cnrs.fr/david.coeurjolly/publication/dcoeurjo-pami-rdma/>
- <https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-34-signed-distance-fields-using-single-pass-gpu>

## Implementation

1. Replace the unsigned, foreground-seeded `SDF Stylize` intermediate with a
   shared boundary-seeded jump-flood feature transform in renderable RGBA16F.
   Preserve nearest-boundary coordinates and derive a signed distance from the
   current pixel's mask classification.
2. Migrate `SDF Stylize` to the shared field so inside distances, offsets, and
   bevels are geometrically meaningful.
3. Implement Boolean sculpting against circle, rounded-box, diamond, and
   capsule primitives with hard and smooth field operators.
4. Implement an approximate medial-axis renderer by detecting competing,
   sufficiently separated nearest-boundary sites inside the silhouette, with
   radius-based pruning and source-aware coloring.
5. Implement normal/tangent/vortex source warps from finite differences of the
   signed field, with edge-range attenuation and optional animation.
6. Register all three filters, regenerate selective catalog artifacts, and add
   registry/option contracts plus real-browser shader validation.

## Acceptance gates

- The JFA stores an explicit invalid sentinel in a signed float render target;
  uniform foreground regions do not collapse to zero interior distance.
- Every new filter is WebGL2-only, worker-resolvable, and has descriptions for
  every option.
- All Boolean operations and primitive branches compile and draw.
- The medial-axis default produces finite, opaque, non-flat output for a
  nontrivial silhouette.
- All flow modes compile; zero strength is an identity mapping and finite
  parameter extremes remain valid.
- Focused tests, generated-registry checks, typecheck, lint, production build,
  and the complete Chromium GL gate pass.

## Outcome

Implemented the shared RGBA16F boundary feature transform with JFA+1
refinement, migrated SDF Stylize away from its unsigned foreground-seed
approximation, and shipped Boolean Sculpt, Medial Axis, and Flow Warp as three
distinct WebGL2 consumers. A real-app visual review on the Lenna fixture led to
a gentler Flow Warp default while retaining a clearly visible contour-driven
effect.

The release gate now includes a signed-interior regression check: a solid
foreground's center must measure farther from its implicit canvas boundary than
an edge pixel. Final verification passed 1,871 unit/integration tests, 2,547
Chromium GPU profiles across 704 shader compiles and 8,308 draws, plus lint,
typecheck, generated-registry verification, and the production bundle budget.
