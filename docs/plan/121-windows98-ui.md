# Windows 98 UI adoption and iterative evaluation

## Objective and sequence

Adopt a faithful Windows 98 design system, research and apply a repeatable
UI/UX evaluation framework, and show screenshots at major milestones.
After improvements reach diminishing returns, audit all app surfaces for design
system consistency and fix deviations, then review and improve the app generally.

## System selection

Choose [98.css](https://jdan.github.io/98.css/), an MIT-licensed CSS-only system
with semantic controls, title bars, group boxes, tabs, status bars and pixel fonts.
Its documentation explicitly supports React and custom spacing. Compared with
[Windows 98 Bootstrap theme](https://github.com/hello-jason/windows-98-bootstrap-theme),
it avoids introducing Bootstrap conventions into the existing atomic React UI.
Keep the dependency local and pinned. Adapt its primitives to existing tokens
and CSS modules rather than inventing another approximate retro theme.

## Milestones

1. Capture untouched baseline; adopt controls, typography and desktop chrome.
2. Evaluate source → compose → preview → export on desktop, laptop and mobile;
   fix the highest severity issues and capture representative screens.
3. Repeat evaluation until two consecutive passes reveal no severity 3/4 issues
   and only low-impact changes; record evidence, not assumed user-test results.
4. Audit every UI surface against the system inventory, including dialogs,
   library, controls, audio, VJ, errors, empty states and selected/disabled states.
5. General app review: correctness, accessibility, resilience and performance;
   reproduce and fix concrete findings with appropriate regression tests.

## Verification

Use real Chromium screenshots and existing workflow/browser tests. Run build,
lint and project typecheck for implementation changes. Keep faithful desktop
chrome while retaining larger touch targets and responsive layouts. No fake
window actions. Document adaptations and limitations. Screenshots go in
`docs/ui/screenshots/`; evaluations in `docs/ui/`.

## Visual style versus interaction model

Windows 98 fidelity applies to appearance, not historical UX restrictions.
Research a complementary modern interaction system; retain searchable discovery,
responsive task navigation, accessible dialogs, keyboard shortcuts and recovery.
Evaluate Radix (already used) and task-oriented systems before selecting patterns.

## Build dependency upgrade (user requested)

Before retaining a compiler fallback, upgrade dependencies within their declared
compatibility ranges, update the formatter to its patched release, and retry
Vite's default minification. Verify the native minifier independently on a
one-rule stylesheet. Keep the supported esbuild CSS path only if the updated
stack still reproduces the crash. Run build, typecheck, lint, unit and relevant
browser checks against the resulting lockfile.

## Completion and release queue

After both queued audits are complete and verified, commit with this plan
referenced, push to origin, and check CI/Pages release status for that commit.
The user explicitly authorized these final actions. Do not create a filter
package release unless the final implementation changes its release surface.

## Completed implementation

Six rubric passes reached the stopping rule. The subsequent app-wide audit and
general review are recorded in `docs/ui/design-system-audit.md` and
`docs/ui/general-review.md`, with milestone screenshots through `08-*`.
98.css supplies the visuals; Radix supplies modern dialog/tab interaction.
Dependencies were upgraded before retaining the verified CSS compiler fallback.
Node 24 checks, complete browser contracts and merged coverage pass; final
remote CI/Pages verification follows the authorized commit/push.
