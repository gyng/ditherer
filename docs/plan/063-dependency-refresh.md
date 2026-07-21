# 063 - Dependency refresh

## Goal

Bring every root and workspace dependency to the latest version reported by
the npm registry on 2026-07-21, preserve the local workspace link, and retain
the `brace-expansion` security patch from Dependabot alert 353.

## Inventory

`npm outdated --workspaces --include-workspace-root` reports one outdated
direct dependency:

- `fflate`: 0.8.2 → 0.8.3, used by both the root application and
  `@gyng/ditherer-filters` workspace.

All other direct production and development dependencies are already at their
latest published versions. The root `@gyng/ditherer-filters@0.2.0` dependency
resolves to the local workspace and is not an external package to upgrade.

## Implementation

1. Raise both `fflate` declarations from `^0.8.2` to `^0.8.3`.
2. Regenerate the workspace lockfile and installed dependency tree.
3. Verify the lockfile retains patched `brace-expansion@5.0.7`.

## Verification

- npm reports no outdated direct dependencies across the root and workspace.
- `npm audit` reports zero vulnerabilities.
- TypeScript, ESLint, Vitest, production build, and packed-library consumer
  validation pass.
- `git diff --check` passes.

## Result

- Root and workspace manifests now require `fflate@^0.8.3`; the installed and
  locked graph deduplicates both consumers to `fflate@0.8.3`.
- Patched `brace-expansion@5.0.7` remains in the lockfile, resolving GitHub
  Dependabot alert 353 once the change reaches the default branch.
- `npm outdated --workspaces --include-workspace-root` returns no packages and
  `npm audit` reports zero vulnerabilities.
- TypeScript, ESLint, 1,775 Vitest tests, the production build and chunk budget,
  package generation/type emission/tarball install/selective-bundle checks,
  and the packed consumer Chromium smoke test all pass.
