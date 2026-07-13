# 045 - Raymarching and ray-tracing filter suite

## Goal

Add nine WebGL2 filters that use bounded ray marching, grid traversal,
distance-field rendering, screen-space ray queries, or progressive stochastic
sampling to turn a source image into a 2.5D material rather than an unrelated
shader demo.

## Filters

1. **Heightfield Raymarch** — intersect a camera ray with a luminance height
   field and shade the displaced surface with directional light and shadows.
2. **Silhouette Extrusion** — turn a luminance/alpha mask into a bevelled,
   raymarched slab with configurable depth and material response.
3. **Voxel Landscape** — traverse a luminance-derived column grid with a DDA
   ray and render the first visible coloured block face.
4. **Glass Surface** — march through a procedural/source-driven glass
   heightfield, refract the source, and add Fresnel and dispersion.
5. **Relief Reflections** — reflect rays across a luminance-derived normal and
   march for a screen-space heightfield hit, falling back to a sky gradient.
6. **Volumetric Light** — integrate density along a bounded screen-space ray
   toward a user-positioned emitter, with image occlusion and animated noise.
7. **SDF Melt** — approximate distance to a luminance silhouette, distort the
   boundary with animated noise, and shade the inflated/melting surface.
8. **Fractal Portal** — sphere-trace a Mandelbulb/Julia-style distance field and
   use the source image as its material/environment.
9. **Path-Traced Diorama** — progressively accumulate stochastic soft lighting,
   reflection, and depth-of-field samples for an image plane in a simple room.

## Implementation

1. Add a small generic single-pass WebGL helper under `src/utils/`; keep shader
   source, uniforms, controls, and product behavior in each filter module.
2. Give every filter complete `optionTypes` descriptions, bounded shader loops,
   palette post-pass compatibility, and `requiresGL: true` metadata.
3. Mark animated filters as temporal/auto-animating where motion or progressive
   accumulation is part of the default effect. Feed Path-Traced Diorama from
   `_prevOutput` so each chain entry owns its accumulation history.
4. Import, export, and list all filters in `src/filters/index.ts`; rely on the
   derived `filterIndex` for worker and saved-state resolution.
5. Add registry/metadata contract tests for the suite. Use the existing real
   browser GL sweep as the shader compilation, draw, enum-branch, output-size,
   and non-transparent-output release gate.
6. Update README feature documentation and the agent architecture notes so the
   new raymarching family and its verification expectations remain discoverable.

## Verification

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run test:gl`

The GL gate must show every new `requiresGL` filter issuing a real draw in
Chromium, with no shader compile/link errors or console errors.
