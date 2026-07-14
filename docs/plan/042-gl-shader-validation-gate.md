# 042 - General WebGL shader validation gate

## Goal

Make real-browser WebGL shader validation a required CI check for every filter
that actually takes a GPU path, including filters with an optional CPU/WASM
fallback. Detect compile/link failures, silent fallback in GL-only filters,
black/transparent output, size drift, and broken enum shader branches.

## Plan

1. Generalize the browser harness to force WebGL acceleration across the whole
   filter registry, discover actual GPU execution from draw calls, and require
   every `requiresGL` filter to issue a draw.
2. Exercise default, linear-light, and alternate enum branches for each
   discovered GL filter, initialize temporal filters through frames 0/1 before
   validation, and use an edge-bearing signal fixture that can distinguish a
   broken black frame from legitimate flat stylized output. Retain the focused
   worker and VHS dynamic-range assertions.
3. Add a dedicated package command and required GitHub Actions job that installs
   Chromium and runs the real-browser GL suite; only deploy the exact commit
   after that complete CI workflow succeeds.
4. Validate the gate locally with TypeScript, lint, production build, and the
   focused Playwright suite.

## Result

- The browser gate currently discovers 250 GPU-backed filters, including 133
  `requiresGL` filters, and validates 830 default/linear/enum modes. The suite
  discovers new registry entries automatically and holds these totals as a
  reviewed coverage floor so a disappearing GPU path cannot pass silently.
- WebGL2 absence, compile/link errors, missing required draws, size drift,
  transparency, opaque-black output, and VHS dynamic-range collapse all fail.
- The stronger output contract found and fixed Solarize's always-black default:
  threshold 96 followed by the inherited 2-level palette mapped every channel
  to zero. Its default palette is now the 256-level identity.
- CI runs the browser gate before deployment; Pages checks out the exact SHA of
  the successful CI workflow.
