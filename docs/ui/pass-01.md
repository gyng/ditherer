# Pass 01 — foundation (in progress)

Evidence: `screenshots/00-baseline.png`, `01-system-foundation.png`,
`01-compose.png`; Chromium 1440×1000. Screens are a first implementation
milestone, not a completed fidelity audit.

Adopted pinned 98.css 0.1.21 in a low-priority cascade layer. Existing modules
retain layout responsibility. Added pixel font, teal desktop, gray primary
faces, sunken status fields, system sliders and less decorative typography.
Kept native wrapped checkboxes because upstream expects adjacent input/label
markup; this needs a full control audit before removing the compatibility rule.

Validation: project typecheck and lint passed. All 10 existing ux-workbench and
workspace-layout browser tests passed (desktop, phone targets, search keyboard
navigation, dialogs and layout). Production build crashed with a native
segmentation fault twice, including outside the sandbox; investigate before
claiming build verification.

## Open findings

| Issue                                                                                 | Severity   | Next action                                                    |
| ------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| Upstream select styles and module backgrounds conflict, obscuring dropdown affordance | 2          | Adapt a single shared select primitive and verify all variants |
| Some action buttons intentionally remove shadow, becoming flat after border adoption  | 2          | Audit borderless versus command button semantics               |
| Pixel font is dense; mixed headings and uppercase parameter labels persist            | 2          | Define role typography, evaluate laptop/mobile readability     |
| Many modal surfaces still use custom interaction handling                             | Unassessed | Inventory and audit focus/escape/recovery; adapt Radix         |
| Default floating preview overlaps source                                              | 2          | Evaluate initial docked workspace and comparison task          |

Next pass: investigate production build, resolve control styling conflicts,
then evaluate all four workflow steps at three viewports and keyboard-only.
Do not declare diminishing returns from the foundation pass.

## Follow-up

The build crash and shared-control conflicts were investigated and resolved in
[pass 02](pass-02.md). The dependency upgrade preceded the retained compiler
fallback. The app-wide design-system audit remains queued after UX iteration.
