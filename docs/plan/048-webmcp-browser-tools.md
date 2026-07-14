# 048 - WebMCP browser tools

## Goal

Expose Ditherer's live browser state and core image-processing actions as
discoverable WebMCP tools, make support visible in the interface, and verify
the real tool lifecycle in a WebMCP-enabled Chrome build.

## Requirements

- Prefer the current `document.modelContext` API while retaining a temporary
  `navigator.modelContext` fallback for older experimental Chrome builds.
- Await tool registration, use `AbortSignal` lifecycle cleanup, and surface
  unsupported, registering, ready, partial, and failed states to the UI.
- Keep the tool set focused and non-overlapping: discover filters/presets,
  inspect and mutate the chain, load media, and export image/video output.
- Validate mutation inputs against the current chain and declared filter
  options so agents receive actionable failures rather than silent no-ops.
- Add a compact WebMCP badge beside the footer links with a keyboard-accessible
  tooltip explaining support state and registered tool count.
- Drive tool discovery and at least one read plus one UI-visible mutation in
  Chrome 150 with WebMCP testing enabled.

## Verification

- Unit contracts for current and legacy registration, cleanup, partial failure,
  strict input validation, and representative tool results.
- Browser coverage for unsupported and enabled badge states.
- A real Chrome WebMCP smoke test using `getTools()` and `executeTool()`.
- Typecheck, lint, production build, and diff integrity checks.
