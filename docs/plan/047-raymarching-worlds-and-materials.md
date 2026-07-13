# 047 - Raymarching worlds and optical materials

## Goal

Add ten WebGL2 filters that extend the image-driven raymarching family into
volumetric worlds, physically inspired materials, non-Euclidean spaces, and a
navigable procedural maze. Every filter must use the source image as geometry,
density, emission, material, or environment data.

## Filters

1. **Luminance Caverns** — fly through a tunnel whose walls and mineral color
   are derived from source luminance and color.
2. **Black Hole Lens** — bend image rays around a gravity well and render a
   source-colored accretion disc.
3. **Thin-Film Iridescence** — apply wavelength-dependent interference to
   luminance-derived surface normals.
4. **Subsurface Wax** — approximate transmitted and diffused light through a
   source-derived translucent material.
5. **Cone-Traced AO** — horizon/cone trace across a luminance heightfield to
   darken creases and contact regions.
6. **Chromatic Prism Tracer** — trace separate red, green, and blue rays through
   an adjustable triangular prism.
7. **Portal Hall** — raymarch a repeated corridor with non-Euclidean portal
   recursion and source-textured walls.
8. **Image Fossil** — turn source structure into layered sediment, cracks,
   mineral veins, and embedded relief.
9. **Volumetric Cloud Sculpture** — integrate source-driven density and color
   through an animated 3D cloud volume.
10. **Raymarched Maze** — navigate a deterministic procedural maze with
    source-textured walls, floor, fog, and a visible exit beacon.

## Implementation

1. Keep each shader and its controls in a self-contained filter module and use
   `src/utils/glSinglePass.ts` only for generic source-backed draw plumbing.
2. Use compile-time bounded loops with uniform-controlled early exits. Mark
   animated/fly-through effects temporal and auto-animating.
3. Give every control a description, support palette post-processing, declare
   every module `requiresGL: true`, and register all ten under `Advanced`.
4. Add a suite contract test for registry resolution, GL metadata, control
   descriptions, and temporal classification.
5. Update README and the raymarching architecture notes with the new family.

## Verification and release

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run test:gl`

Commit only plan-047 work, fast-forward `master`, and wait for both CI and the
GitHub Pages deployment for that exact commit to pass.
