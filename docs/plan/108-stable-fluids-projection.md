# 108 — Stable Fluids Divergence Projection

Status: Complete

## Objective

Repair Stable Fluids, which explicitly skips the divergence-projection step
that defines Jos Stam's method. Without projection the velocity field is not
divergence-free, so it is not an incompressible fluid: mass is not conserved
and the characteristic rolling vortices cannot form. Add the pressure
projection (divergence → Poisson solve → gradient subtraction) after advection
each step so the simulation is genuinely incompressible.

## Evidence

- The filter header states it outright: "We skip the divergence-projection
  step." The per-step velocity update is advection + viscous damping + gradient
  forcing only (`vel = advected.rg*(1-viscosity) + force*dt`). Calling it
  "Stam-style" while omitting the one step Stam is known for is the defect.

## References

- J. Stam, "Stable Fluids," SIGGRAPH 1999 — advect → diffuse → **project**; the
  projection makes the velocity field divergence-free (Helmholtz–Hodge
  decomposition) via a pressure Poisson solve.
- J. Stam, "Real-Time Fluid Dynamics for Games," GDC 2003 — the standard
  Gauss–Seidel/Jacobi relaxation used for the Poisson solve (~20 iterations).

## Implementation

1. Add a framework-free reference `fluidProjection.ts` exporting the projection
   math (divergence via central differences, Jacobi pressure relaxation solving
   ∇²p = div, and velocity correction v ← v − ∇p) plus a divergence measure.
   Unit-test that projection drives the field's divergence toward zero.
2. Add three GLSL passes mirroring that math — divergence, a Jacobi iteration,
   and gradient subtraction — and run them after the velocity advection each
   step (divergence → N Jacobi iterations on a ping-pong pressure texture →
   subtract the pressure gradient), so the density is advected by the
   divergence-free velocity. Expose the Jacobi iteration count as a control.
3. Normalise sparse/malformed options; keep the render modes, palette, and
   temporal state.
4. Add a real-browser GL-smoke contract that the filter stays finite and live
   with projection enabled, plus the projection-math unit tests.
5. Run the full unit, Chromium/WebGL, lint, type, catalog, package, and app
   gates.

## Outcome

- A framework-free, unit-tested reference (`fluidProjection.ts`) now backs the
  projection: central-difference divergence, Jacobi relaxation of ∇²p = div, the
  velocity correction v ← v − ∇p, and an interior-divergence measure. Tests show
  projection removes >85% of a compatible field's divergence, converges
  monotonically with iterations, solves the Poisson equation at a zero-sum
  dipole source, and leaves a divergence-free field unchanged.
- Stable Fluids now runs three mirrored GLSL passes after the velocity
  advection each step — divergence, N Jacobi pressure iterations on a
  ping-pong pressure texture (cleared each step for determinism), and gradient
  subtraction — so the density is advected by a divergence-free velocity and
  real rolling vortices form. A `pressureIterations` control (default 20, 0
  disables projection for the legacy look) exposes the incompressibility/speed
  trade-off. Options are normalised; render modes, palette, and temporal state
  are preserved; velocity stays CFL-clamped for stability.
- Two adversarial reviews (GL pipeline; projection math and tests) found no
  correctness bugs: no texture feedback, correct ping-pong parity for every
  iteration count, no uninitialised reads, bounded stability, and an exact
  GLSL↔reference match with a consistent Poisson sign. Three low-severity
  test-strengthening notes were applied (a boundary-inclusive divergence
  assertion, a zero-sum dipole Poisson bound, and a note on the GL-only clamp).
- Verified with the projection unit tests (+6, 2,244 total), a real-browser
  GL-smoke `simulation` suite (projection stays finite and live over 8 frames;
  the no-projection path still renders), lint, typecheck, catalog, and build.

Status: Complete
